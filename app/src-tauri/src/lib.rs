//! Efinity FaceCam — PCOB debugger-based observer utility.
//!
//! The legacy OCR pipeline has been fully removed. The backend now detects the
//! Free Fire debugger folder, watches the latest debugger file, parses observer
//! log lines into normalized state, and streams updates to the frontend. It also
//! owns persistent settings and the multi-observer configuration model.

pub mod debugger;
pub mod vmix;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use debugger::detector::{self, FolderValidation};
use debugger::parser::ObserverParser;
use debugger::state::{CurrentObserverState, ObserverUpdate};
use debugger::watcher::{EmitFn, WatchManager};

// ── Persistent settings model (spec §7, §11) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObserverConnectionType {
    Local,
    NetworkShare,
    RemoteAgent,
    CloudRelay,
}

impl Default for ObserverConnectionType {
    fn default() -> Self {
        ObserverConnectionType::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverConfig {
    pub id: String,
    pub display_name: String,
    #[serde(rename = "type")]
    pub conn_type: ObserverConnectionType,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_debugger_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_share_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    #[serde(default = "default_true")]
    pub animations: bool,
    #[serde(default)]
    pub compact_cards: bool,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            animations: true,
            compact_cards: false,
        }
    }
}

/// What an observer should send to vMix (spec §4).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VmixSendMode {
    Uid,
    Name,
    Disabled,
}

impl Default for VmixSendMode {
    fn default() -> Self {
        VmixSendMode::Disabled
    }
}

/// Per-observer vMix output mapping (spec §4, §5, §15).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverVmixConfig {
    pub observer_id: String,
    #[serde(default)]
    pub send_mode: VmixSendMode,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub layer: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmixConfig {
    #[serde(default = "default_vmix_ip")]
    pub ip: String,
    #[serde(default = "default_vmix_port")]
    pub port: u16,
    #[serde(default)]
    pub observers: Vec<ObserverVmixConfig>,
}

fn default_vmix_ip() -> String {
    "127.0.0.1".into()
}
fn default_vmix_port() -> u16 {
    8099
}

impl Default for VmixConfig {
    fn default() -> Self {
        Self {
            ip: default_vmix_ip(),
            port: default_vmix_port(),
            observers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlayerRole {
    Main,
    Sub,
}

impl Default for PlayerRole {
    fn default() -> Self {
        PlayerRole::Main
    }
}

/// One player slot within a team.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPlayer {
    pub id: String,
    #[serde(default)]
    pub player_name: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub player_id: String,
    #[serde(default)]
    pub role: PlayerRole,
}

/// A team — the per-tournament source of truth (4 main + 1 substitute players).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub players: Vec<TeamPlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debugger_folder: Option<String>,
    #[serde(default)]
    pub observers: Vec<ObserverConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_selected_observer: Option<String>,
    #[serde(default)]
    pub debug_logging: bool,
    #[serde(default)]
    pub ui: UiPreferences,
    #[serde(default)]
    pub vmix: VmixConfig,
    #[serde(default)]
    pub teams: Vec<Team>,
}

// ── App state ────────────────────────────────────────────────────────

struct AppState {
    settings: Mutex<AppSettings>,
    watch: Arc<WatchManager>,
    /// Last runtime update per observer id (for snapshot queries).
    runtime: Arc<Mutex<HashMap<String, ObserverUpdate>>>,
    /// Active vMix TCP connection (if connected).
    vmix_conn: Mutex<Option<std::net::TcpStream>>,
    vmix_connected: AtomicBool,
    /// Cache of vMix input titles + when last refreshed (for the existence check).
    vmix_inputs: Mutex<(std::time::Instant, std::collections::HashSet<String>)>,
}

#[derive(Serialize)]
struct CommandResult {
    success: bool,
    message: String,
}

#[derive(Serialize)]
struct DetectionResult {
    detected: Option<String>,
    candidates: Vec<String>,
}

// ── Paths / persistence ──────────────────────────────────────────────

const APP_DATA_SUBDIR: &str = "EfinityFaceCam";

fn app_data_dir() -> PathBuf {
    if let Some(base) = dirs::data_dir() {
        return base.join(APP_DATA_SUBDIR);
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn settings_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

fn load_settings_from_disk() -> AppSettings {
    let path = settings_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            eprintln!("[WARN] Corrupted settings.json ({e}); starting fresh.");
            AppSettings::default()
        }),
        Err(_) => AppSettings::default(),
    }
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let dir = app_data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create settings dir: {e}"))?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize settings: {e}"))?;
    std::fs::write(settings_path(), content)
        .map_err(|e| format!("Cannot write settings: {e}"))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ── Settings commands ────────────────────────────────────────────────

#[tauri::command]
fn load_settings(state: tauri::State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    Ok(state.settings.lock().unwrap().clone())
}

#[tauri::command]
fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    persist_settings(&settings)?;
    *state.settings.lock().unwrap() = settings;
    Ok(CommandResult {
        success: true,
        message: "Settings saved".into(),
    })
}

// ── Debugger folder commands (spec §3.2, §4) ─────────────────────────

#[tauri::command]
fn detect_debugger_folder() -> Result<DetectionResult, String> {
    let detected = detector::auto_detect().map(|p| p.to_string_lossy().to_string());
    let candidates = detector::candidate_paths()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    Ok(DetectionResult {
        detected,
        candidates,
    })
}

#[tauri::command]
fn validate_debugger_folder(path: String) -> Result<FolderValidation, String> {
    Ok(detector::validate(&PathBuf::from(path)))
}

#[tauri::command]
fn set_debugger_folder(
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<FolderValidation, String> {
    let validation = detector::validate(&PathBuf::from(&path));
    if !validation.valid {
        return Err("Selected folder is not a valid, readable directory".into());
    }
    {
        let mut s = state.settings.lock().unwrap();
        s.debugger_folder = Some(path);
        persist_settings(&s)?;
    }
    Ok(validation)
}

// ── Observer CRUD (spec §7) ──────────────────────────────────────────

#[tauri::command]
fn list_observers(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<ObserverConfig>, String> {
    Ok(state.settings.lock().unwrap().observers.clone())
}

#[tauri::command]
fn upsert_observer(
    mut observer: ObserverConfig,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ObserverConfig, String> {
    let mut s = state.settings.lock().unwrap();

    // Reject duplicate display names (spec §13).
    if s.observers
        .iter()
        .any(|o| o.id != observer.id && o.display_name.eq_ignore_ascii_case(&observer.display_name))
    {
        return Err(format!(
            "An observer named '{}' already exists",
            observer.display_name
        ));
    }

    observer.updated_at = now_iso();
    match s.observers.iter_mut().find(|o| o.id == observer.id) {
        Some(existing) => {
            observer.created_at = existing.created_at.clone();
            *existing = observer.clone();
        }
        None => {
            if observer.created_at.is_empty() {
                observer.created_at = now_iso();
            }
            s.observers.push(observer.clone());
        }
    }
    persist_settings(&s)?;
    Ok(observer)
}

#[tauri::command]
fn delete_observer(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    state.watch.stop(&id);
    state.runtime.lock().unwrap().remove(&id);
    {
        let mut s = state.settings.lock().unwrap();
        let before = s.observers.len();
        s.observers.retain(|o| o.id != id);
        if s.observers.len() == before {
            return Err(format!("Observer '{id}' not found"));
        }
        persist_settings(&s)?;
    }
    Ok(CommandResult {
        success: true,
        message: "Observer deleted".into(),
    })
}

// ── Watch control ────────────────────────────────────────────────────

fn make_emit(app: AppHandle, runtime: Arc<Mutex<HashMap<String, ObserverUpdate>>>) -> EmitFn {
    Arc::new(move |update: ObserverUpdate| {
        runtime
            .lock()
            .unwrap()
            .insert(update.observer_id.clone(), update.clone());
        let _ = app.emit("observer_update", &update);
    })
}

fn resolve_local_folder(cfg: &ObserverConfig, settings: &AppSettings) -> Option<PathBuf> {
    match cfg.conn_type {
        ObserverConnectionType::Local => cfg
            .local_debugger_path
            .clone()
            .or_else(|| settings.debugger_folder.clone())
            .map(PathBuf::from),
        ObserverConnectionType::NetworkShare => cfg.network_share_path.clone().map(PathBuf::from),
        _ => None,
    }
}

#[tauri::command]
fn start_observer(
    id: String,
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    let (cfg, folder) = {
        let s = state.settings.lock().unwrap();
        let cfg = s
            .observers
            .iter()
            .find(|o| o.id == id)
            .cloned()
            .ok_or_else(|| format!("Observer '{id}' not found"))?;
        let folder = resolve_local_folder(&cfg, &s);
        (cfg, folder)
    };

    if !cfg.enabled {
        return Err("Observer is disabled".into());
    }

    match cfg.conn_type {
        ObserverConnectionType::Local | ObserverConnectionType::NetworkShare => {
            let folder = folder.ok_or_else(|| {
                "No debugger folder configured for this observer".to_string()
            })?;
            let emit = make_emit(app, state.runtime.clone());
            state.watch.start(id.clone(), folder, emit);
            Ok(CommandResult {
                success: true,
                message: format!("Watching debugger folder for '{}'", cfg.display_name),
            })
        }
        ObserverConnectionType::RemoteAgent | ObserverConnectionType::CloudRelay => {
            // Remote sources are driven by the frontend WebSocket client; the
            // backend does not watch a local folder for them.
            Ok(CommandResult {
                success: true,
                message: "Remote observer is handled by the frontend transport".into(),
            })
        }
    }
}

#[tauri::command]
fn stop_observer(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    state.watch.stop(&id);
    Ok(CommandResult {
        success: true,
        message: "Observer stopped".into(),
    })
}

#[tauri::command]
fn start_all_observers(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    let observers = state.settings.lock().unwrap().observers.clone();
    let mut started = 0;
    for cfg in observers.iter().filter(|o| o.enabled) {
        let folder = {
            let s = state.settings.lock().unwrap();
            resolve_local_folder(cfg, &s)
        };
        if matches!(
            cfg.conn_type,
            ObserverConnectionType::Local | ObserverConnectionType::NetworkShare
        ) {
            if let Some(folder) = folder {
                let emit = make_emit(app.clone(), state.runtime.clone());
                state.watch.start(cfg.id.clone(), folder, emit);
                started += 1;
            }
        }
    }
    Ok(CommandResult {
        success: true,
        message: format!("Started {started} local observer(s)"),
    })
}

#[tauri::command]
fn stop_all_observers(state: tauri::State<'_, Arc<AppState>>) -> Result<CommandResult, String> {
    state.watch.stop_all();
    Ok(CommandResult {
        success: true,
        message: "All observers stopped".into(),
    })
}

#[tauri::command]
fn get_observer_states(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<ObserverUpdate>, String> {
    Ok(state.runtime.lock().unwrap().values().cloned().collect())
}

#[tauri::command]
fn app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchedPlayer {
    uid: String,
    name: String,
    player_id: String,
}

/// Parse the latest debugger file and return every player resolved to a uid,
/// so the Team Info roster can be auto-built (spec: Fetch Players).
#[tauri::command]
fn fetch_players_from_debugger(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<FetchedPlayer>, String> {
    let folder = state
        .settings
        .lock()
        .unwrap()
        .debugger_folder
        .clone()
        .ok_or("No debugger folder configured. Set it in Debugger Source first.")?;

    let latest = detector::latest_file(&PathBuf::from(&folder))
        .ok_or("No debugger file found in the folder yet.")?;
    let file_name = latest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("debugger")
        .to_string();
    let content = std::fs::read_to_string(&latest)
        .map_err(|e| format!("Cannot read debugger file: {e}"))?;

    let mut parser = ObserverParser::new(file_name);
    for line in content.lines() {
        parser.process_line(line);
    }

    let mut players: Vec<FetchedPlayer> = parser
        .known_players()
        .into_iter()
        .map(|(uid, player_id, name)| FetchedPlayer {
            uid,
            name,
            player_id,
        })
        .collect();
    // Sort by numeric playerId so squads/slots come out in order.
    players.sort_by_key(|p| p.player_id.parse::<u64>().unwrap_or(u64::MAX));
    Ok(players)
}

// ── vMix Panel (TCP output) ──────────────────────────────────────────

#[derive(Clone, Serialize)]
struct VmixLog {
    level: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VmixStatus {
    connected: bool,
    ip: String,
    port: u16,
}

fn vmix_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "vmix_log",
        VmixLog {
            level: level.into(),
            message: message.into(),
        },
    );
}

fn emit_vmix_status(app: &AppHandle, state: &AppState) {
    let cfg = state.settings.lock().unwrap().vmix.clone();
    let _ = app.emit(
        "vmix_status",
        VmixStatus {
            connected: state.vmix_connected.load(Ordering::SeqCst),
            ip: cfg.ip,
            port: cfg.port,
        },
    );
}

#[tauri::command]
fn vmix_connect(
    app: AppHandle,
    ip: String,
    port: u16,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let ip = ip.trim().to_string();
    if ip.is_empty() {
        return Err("Please enter a valid vMix IP address.".into());
    }
    if port == 0 {
        return Err("Please enter a valid TCP port.".into());
    }

    // Persist ip/port immediately so they survive restarts.
    {
        let mut s = state.settings.lock().unwrap();
        s.vmix.ip = ip.clone();
        s.vmix.port = port;
        persist_settings(&s)?;
    }

    let addr = format!("{ip}:{port}");
    let socket = addr
        .to_socket_addrs()
        .map_err(|_| "Please enter a valid vMix IP address.".to_string())?
        .next()
        .ok_or("Please enter a valid vMix IP address.")?;

    vmix_log(&app, "info", format!("Connecting to vMix at {addr}…"));
    match TcpStream::connect_timeout(&socket, Duration::from_secs(4)) {
        Ok(stream) => {
            let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
            // Read timeout so we can capture vMix's reply / XML state.
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            *state.vmix_conn.lock().unwrap() = Some(stream);
            state.vmix_connected.store(true, Ordering::SeqCst);
            // Force an input-list refresh on next send.
            {
                let mut cache = state.vmix_inputs.lock().unwrap();
                cache.0 = std::time::Instant::now() - std::time::Duration::from_secs(3600);
            }
            vmix_log(&app, "success", format!("vMix TCP connected at {addr}"));
            emit_vmix_status(&app, &state);
            Ok(CommandResult {
                success: true,
                message: "Connected".into(),
            })
        }
        Err(e) => {
            state.vmix_connected.store(false, Ordering::SeqCst);
            emit_vmix_status(&app, &state);
            let msg = format!("Failed to connect to vMix: {e}");
            vmix_log(&app, "error", msg.clone());
            Err(msg)
        }
    }
}

#[tauri::command]
fn vmix_disconnect(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    *state.vmix_conn.lock().unwrap() = None;
    state.vmix_connected.store(false, Ordering::SeqCst);
    vmix_log(&app, "info", "vMix disconnected");
    emit_vmix_status(&app, &state);
    Ok(CommandResult {
        success: true,
        message: "Disconnected".into(),
    })
}

#[tauri::command]
fn vmix_get_status(state: tauri::State<'_, Arc<AppState>>) -> Result<VmixStatus, String> {
    let cfg = state.settings.lock().unwrap().vmix.clone();
    Ok(VmixStatus {
        connected: state.vmix_connected.load(Ordering::SeqCst),
        ip: cfg.ip,
        port: cfg.port,
    })
}

/// Low-level write helper. Sends `payload` and returns vMix's reply line
/// (e.g. `FUNCTION OK` or `FUNCTION ER ...`). Drops the connection on a write
/// failure so the UI reflects a real disconnect instead of silently failing.
fn vmix_write(app: &AppHandle, state: &AppState, payload: &str) -> Result<String, String> {
    use std::io::Read;

    let mut guard = state.vmix_conn.lock().unwrap();
    let stream = guard.as_mut().ok_or("vMix is not connected.")?;

    if let Err(e) = vmix::send(stream, payload) {
        *guard = None;
        drop(guard);
        state.vmix_connected.store(false, Ordering::SeqCst);
        emit_vmix_status(app, state);
        vmix_log(app, "error", format!("Failed to send data to vMix. {e}"));
        return Err(format!("Failed to send data to vMix. {e}"));
    }

    // Capture vMix's response (best-effort; empty on read timeout).
    let mut buf = [0u8; 512];
    let reply = match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).trim().to_string(),
        _ => String::new(),
    };
    Ok(reply)
}

#[tauri::command]
fn vmix_test(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    if !state.vmix_connected.load(Ordering::SeqCst) {
        return Err("vMix is not connected.".into());
    }
    // TALLY is a harmless vMix TCP API query with a short reply ("TALLY OK …").
    let reply = vmix_write(&app, &state, "TALLY\r\n")?;
    let short = reply.lines().next().unwrap_or("").to_string();
    vmix_log(
        &app,
        "success",
        format!("Test OK — vMix responded: {}", if short.is_empty() { "(no reply)" } else { &short }),
    );
    Ok(CommandResult {
        success: true,
        message: "Data sent to vMix successfully.".into(),
    })
}

/// Send a resolved observer's UID/Name to vMix according to its per-observer
/// config. No-op when not connected, observer disabled, or value missing.
#[tauri::command]
fn vmix_send_observer(
    app: AppHandle,
    observer_id: String,
    observer: CurrentObserverState,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    if !state.vmix_connected.load(Ordering::SeqCst) {
        return Ok(CommandResult {
            success: false,
            message: "vMix is not connected.".into(),
        });
    }

    // Resolve config, observer display name, and the roster entry for this UID.
    let (cfg, display, roster_entry, team_name) = {
        let s = state.settings.lock().unwrap();
        let cfg = s
            .vmix
            .observers
            .iter()
            .find(|o| o.observer_id == observer_id)
            .cloned();
        let display = s
            .observers
            .iter()
            .find(|o| o.id == observer_id)
            .map(|o| o.display_name.clone())
            .unwrap_or_else(|| observer_id.clone());
        let uid = observer.uid.clone().unwrap_or_default();
        let mut roster_entry = None;
        let mut team_name = String::new();
        if !uid.is_empty() {
            'outer: for t in &s.teams {
                for p in &t.players {
                    if p.uid == uid {
                        roster_entry = Some(p.clone());
                        team_name = t.name.clone();
                        break 'outer;
                    }
                }
            }
        }
        (cfg, display, roster_entry, team_name)
    };

    let cfg = match cfg {
        Some(c) if c.send_mode != VmixSendMode::Disabled => c,
        _ => {
            return Ok(CommandResult {
                success: false,
                message: "Observer disabled".into(),
            })
        }
    };

    // Determine the vMix input name to route from the send mode: the player
    // name (roster name preferred) or the UID.
    let kind = match cfg.send_mode {
        VmixSendMode::Name => "Name",
        _ => "UID",
    };
    let input_name = match cfg.send_mode {
        VmixSendMode::Name => roster_entry
            .as_ref()
            .map(|p| p.player_name.clone())
            .filter(|n| !n.is_empty())
            .or_else(|| observer.name.clone())
            .unwrap_or_default(),
        _ => observer.uid.clone().unwrap_or_default(),
    };
    let player_label = roster_entry
        .as_ref()
        .map(|p| {
            if team_name.is_empty() {
                p.player_name.clone()
            } else {
                format!("{} · {}", team_name, p.player_name)
            }
        })
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| input_name.clone());

    if input_name.is_empty() {
        return Ok(CommandResult {
            success: false,
            message: "No value to send".into(),
        });
    }
    if cfg.source_name.trim().is_empty() {
        let msg = "Please enter the vMix source name.".to_string();
        vmix_log(&app, "error", msg.clone());
        return Err(msg);
    }

    // ── Single locked section: refresh input cache, verify, then send ──
    let mut guard = state.vmix_conn.lock().unwrap();
    let stream = match guard.as_mut() {
        Some(s) => s,
        None => return Err("vMix is not connected.".into()),
    };

    // Refresh the cached input list at most every 3s.
    {
        let mut cache = state.vmix_inputs.lock().unwrap();
        if cache.0.elapsed() > std::time::Duration::from_secs(3) {
            if let Ok(titles) = vmix::query_input_titles(stream) {
                *cache = (std::time::Instant::now(), titles);
            }
        }
        // Safety net: if we have an input list and the target isn't in it, the
        // player has no vMix input yet — report instead of silently doing nothing.
        if !cache.1.is_empty() && !cache.1.contains(&input_name) {
            drop(cache);
            drop(guard);
            vmix_log(
                &app,
                "error",
                format!(
                    "[{display}] No vMix input named \"{input_name}\" — add that input in vMix or set a vMix Input in Team Info."
                ),
            );
            return Ok(CommandResult {
                success: false,
                message: format!("No vMix input named \"{input_name}\""),
            });
        }
    }

    let payload = vmix::build_payload(&cfg.source_name, cfg.layer, &input_name);
    let reply = match vmix::send_command(stream, &payload) {
        Ok(r) => r,
        Err(e) => {
            *guard = None;
            drop(guard);
            state.vmix_connected.store(false, Ordering::SeqCst);
            emit_vmix_status(&app, &state);
            vmix_log(&app, "error", format!("Failed to send data to vMix. {e}"));
            return Err(format!("Failed to send data to vMix. {e}"));
        }
    };
    drop(guard);

    if reply.contains("ER") {
        vmix_log(
            &app,
            "error",
            format!(
                "[{display}] vMix rejected: {reply} — check Source Name \"{}\" and Layer {}.",
                cfg.source_name, cfg.layer
            ),
        );
        return Ok(CommandResult {
            success: false,
            message: format!("vMix rejected: {reply}"),
        });
    }

    vmix_log(
        &app,
        "success",
        format!(
            "[{display}] {kind} {player_label} → {} Layer {} (input \"{input_name}\")",
            cfg.source_name, cfg.layer
        ),
    );
    Ok(CommandResult {
        success: true,
        message: "Data sent to vMix successfully.".into(),
    })
}

// ── LAN discovery (spec §8.1 — easy pairing) ─────────────────────────

const DISCOVERY_PORT: u16 = 8788;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Beacon {
    facecam: String,
    #[serde(default)]
    agent_id: String,
    #[serde(default)]
    machine_name: String,
    #[serde(default)]
    ws_port: u16,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiscoveredAgent {
    agent_id: String,
    machine_name: String,
    host: String,
    ws_port: u16,
    token: Option<String>,
    status: Option<String>,
}

/// Listen for agent discovery beacons on the LAN for `duration_ms` and return
/// the unique agents found. Each agent's IP comes from the UDP packet source,
/// so the operator never types a host/port/token.
#[tauri::command]
async fn scan_observers(duration_ms: Option<u64>) -> Result<Vec<DiscoveredAgent>, String> {
    let dur = duration_ms.unwrap_or(3000).clamp(500, 15000);
    tokio::task::spawn_blocking(move || scan_blocking(dur))
        .await
        .map_err(|e| format!("scan task failed: {e}"))?
}

fn scan_blocking(duration_ms: u64) -> Result<Vec<DiscoveredAgent>, String> {
    use std::net::UdpSocket;
    use std::time::{Duration, Instant};

    let socket = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT))
        .map_err(|e| format!("Cannot listen on UDP {DISCOVERY_PORT} (is another scan running?): {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(400)))
        .map_err(|e| format!("Cannot set socket timeout: {e}"))?;

    let deadline = Instant::now() + Duration::from_millis(duration_ms);
    let mut found: HashMap<String, DiscoveredAgent> = HashMap::new();
    let mut buf = [0u8; 2048];

    while Instant::now() < deadline {
        match socket.recv_from(&mut buf) {
            Ok((n, src)) => {
                if let Ok(b) = serde_json::from_slice::<Beacon>(&buf[..n]) {
                    if b.facecam == "observer-agent" && !b.agent_id.is_empty() {
                        found.insert(
                            b.agent_id.clone(),
                            DiscoveredAgent {
                                agent_id: b.agent_id,
                                machine_name: b.machine_name,
                                host: src.ip().to_string(),
                                ws_port: b.ws_port,
                                token: b.token,
                                status: b.status,
                            },
                        );
                    }
                }
            }
            Err(_) => continue, // read timeout — keep waiting until the deadline
        }
    }

    Ok(found.into_values().collect())
}

// ── App entry ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();

    let app_state = Arc::new(AppState {
        settings: Mutex::new(settings),
        watch: Arc::new(WatchManager::new()),
        runtime: Arc::new(Mutex::new(HashMap::new())),
        vmix_conn: Mutex::new(None),
        vmix_connected: AtomicBool::new(false),
        vmix_inputs: Mutex::new((
            std::time::Instant::now() - std::time::Duration::from_secs(3600),
            std::collections::HashSet::new(),
        )),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state.clone())
        .setup(move |app| {
            // First run: seed a default local observer pointing at the
            // auto-detected debugger folder so the app is immediately usable.
            let state = app.state::<Arc<AppState>>();
            let mut s = state.settings.lock().unwrap();
            if s.debugger_folder.is_none() {
                if let Some(found) = detector::auto_detect() {
                    s.debugger_folder = Some(found.to_string_lossy().to_string());
                }
            }
            if s.observers.is_empty() {
                s.observers.push(ObserverConfig {
                    id: "local-main".into(),
                    display_name: "This PC".into(),
                    conn_type: ObserverConnectionType::Local,
                    enabled: true,
                    local_debugger_path: None,
                    network_share_path: None,
                    remote_host: None,
                    remote_port: None,
                    auth_token: None,
                    created_at: now_iso(),
                    updated_at: now_iso(),
                });
            }
            let _ = persist_settings(&s);
            drop(s);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            detect_debugger_folder,
            validate_debugger_folder,
            set_debugger_folder,
            list_observers,
            upsert_observer,
            delete_observer,
            start_observer,
            stop_observer,
            start_all_observers,
            stop_all_observers,
            get_observer_states,
            app_version,
            fetch_players_from_debugger,
            scan_observers,
            vmix_connect,
            vmix_disconnect,
            vmix_get_status,
            vmix_test,
            vmix_send_observer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
