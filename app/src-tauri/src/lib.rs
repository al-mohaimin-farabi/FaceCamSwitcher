//! Efinity FaceCam — PCOB debugger-based observer utility.
//!
//! The legacy OCR pipeline has been fully removed. The backend now detects the
//! Free Fire debugger folder, watches the latest debugger file, parses observer
//! log lines into normalized state, and streams updates to the frontend. It also
//! owns persistent settings and the multi-observer configuration model.

pub mod debugger;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use debugger::detector::{self, FolderValidation};
use debugger::state::ObserverUpdate;
use debugger::watcher::{EmitFn, WatchManager};

// ── Persistent settings model (spec §7, §11) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ObserverConnectionType {
    #[default]
    Local,
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
    /// Which vMix output slot ("01"/"02"/"03") this PC's detections report
    /// into — a per-PC identity, not a network setting, since every real
    /// deployment is one observer PC permanently paired to one slot.
    #[serde(default = "default_source_id")]
    pub source_id: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

fn default_source_id() -> String {
    "01".into()
}

/// Central server bridge configuration (spec §4.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSyncConfig {
    #[serde(default = "default_api_base_url")]
    pub api_base_url: String,
    #[serde(default = "default_socket_url")]
    pub socket_url: String,
    #[serde(default)]
    pub tournament_id: String,
    #[serde(default)]
    pub secret_key: String,
}

fn default_api_base_url() -> String {
    "https://facecamapi.ecube.gg".into()
}
fn default_socket_url() -> String {
    "wss://facecamapi.ecube.gg".into()
}

impl Default for NetworkSyncConfig {
    fn default() -> Self {
        Self {
            api_base_url: default_api_base_url(),
            socket_url: default_socket_url(),
            tournament_id: String::new(),
            secret_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PlayerRole {
    #[default]
    Main,
    Sub,
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
    /// Resolved database player id (matched by name against a Fetch Players
    /// database sync) — set for pre-match QA visibility, not used for
    /// switch-time resolution, which matches by name directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_player_id: Option<String>,
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
    #[serde(default)]
    pub network_sync: NetworkSyncConfig,
    #[serde(default)]
    pub teams: Vec<Team>,
}

// ── App state ────────────────────────────────────────────────────────

struct AppState {
    settings: Mutex<AppSettings>,
    watch: Arc<WatchManager>,
    /// Last runtime update per observer id (for snapshot queries).
    runtime: Arc<Mutex<HashMap<String, ObserverUpdate>>>,
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
    // Combine the fast user-profile candidates with a full scan of every drive
    // so the Free Fire debugger folder is found wherever the game is installed.
    let mut all = detector::candidate_paths();
    all.extend(detector::scan_drives());
    let mut seen = std::collections::HashSet::new();
    all.retain(|p| seen.insert(p.clone()));

    let detected = detector::pick_best(&all).map(|p| p.to_string_lossy().to_string());
    let candidates = all
        .iter()
        .filter(|p| detector::validate(p).valid)
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
    cfg.local_debugger_path
        .clone()
        .or_else(|| settings.debugger_folder.clone())
        .map(PathBuf::from)
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

    let folder = folder
        .ok_or_else(|| "No debugger folder configured for this observer".to_string())?;
    let emit = make_emit(app, state.runtime.clone());
    state.watch.start(id.clone(), folder, emit);
    Ok(CommandResult {
        success: true,
        message: format!("Watching debugger folder for '{}'", cfg.display_name),
    })
}

#[tauri::command]
fn stop_observer(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    state.watch.stop(&id);
    // Drop the last-detected player along with the watcher — otherwise a
    // stopped observer's stale state can be handed back to the frontend by
    // get_observer_states() (e.g. on a webview reload) as if it were live.
    state.runtime.lock().unwrap().remove(&id);
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
        if let Some(folder) = folder {
            let emit = make_emit(app.clone(), state.runtime.clone());
            state.watch.start(cfg.id.clone(), folder, emit);
            started += 1;
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
    state.runtime.lock().unwrap().clear();
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

// ── Database player fetch (Network Sync) ────────────────────────────

/// A player as recorded in the FaceCam tournament database — this is now the
/// single source Team Info builds its roster from (previously built from the
/// live debugger log; replaced since the database already has real team
/// grouping and the correct registered `uid`/`ign`, no guessing needed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlayer {
    pub id: String,
    pub ign: String,
    #[serde(default)]
    pub uid: String,
    /// False for a registered substitute — they have no stream key, so they
    /// can never actually be switched to on the output page regardless of
    /// whether they're detected.
    #[serde(default = "default_true")]
    pub is_active: bool,
    #[serde(default)]
    pub player_number: Option<i32>,
    #[serde(default)]
    pub team_id: String,
    #[serde(default)]
    pub team_name: String,
}

#[derive(Deserialize)]
struct FetchDbPlayersResponse {
    players: Vec<DbPlayer>,
}

/// Fetch the tournament's registered player list from the FaceCam server —
/// `GET {api_base_url}/api/ocr/tournament/{tournament_id}`, Bearer
/// `secret_key`. Same endpoint and shape `localized-input`/`OCR` already use.
/// Stateless: the frontend caches the result, this command is a plain
/// pass-through so there's one source of truth for the list.
#[tauri::command]
async fn fetch_players_from_server(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<DbPlayer>, String> {
    let (api_base_url, tournament_id, secret_key) = {
        let s = state.settings.lock().unwrap();
        let n = &s.network_sync;
        (
            n.api_base_url.clone(),
            n.tournament_id.clone(),
            n.secret_key.clone(),
        )
    };

    if api_base_url.is_empty() || tournament_id.is_empty() || secret_key.is_empty() {
        return Err("API URL, Tournament ID, and Secret Key are all required.".into());
    }

    let url = format!(
        "{}/api/ocr/tournament/{}",
        api_base_url.trim_end_matches('/'),
        tournament_id
    );

    let client = HttpClient::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {secret_key}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let data: FetchDbPlayersResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    Ok(data.players)
}

/// Ping `/api/health` on the configured API server via Rust `reqwest` — kept
/// server-side (not a frontend `fetch()`) to sidestep any CORS question
/// entirely, same reasoning `localized-input`/`OCR` use for the same check.
#[tauri::command]
async fn check_server_health(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    let api_base_url = state.settings.lock().unwrap().network_sync.api_base_url.clone();
    if api_base_url.is_empty() {
        return Ok(CommandResult {
            success: false,
            message: "API URL not configured".into(),
        });
    }

    let url = format!("{}/api/health", api_base_url.trim_end_matches('/'));
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => Ok(CommandResult {
            success: true,
            message: "Server online".into(),
        }),
        Ok(resp) => Ok(CommandResult {
            success: false,
            message: format!("Server returned {}", resp.status()),
        }),
        Err(e) => Ok(CommandResult {
            success: false,
            message: format!("Unreachable: {e}"),
        }),
    }
}

// ── App entry ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings_from_disk();

    let app_state = Arc::new(AppState {
        settings: Mutex::new(settings),
        watch: Arc::new(WatchManager::new()),
        runtime: Arc::new(Mutex::new(HashMap::new())),
    });

    tauri::Builder::default()
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
                    source_id: default_source_id(),
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
            start_observer,
            stop_observer,
            start_all_observers,
            stop_all_observers,
            get_observer_states,
            app_version,
            fetch_players_from_server,
            check_server_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
