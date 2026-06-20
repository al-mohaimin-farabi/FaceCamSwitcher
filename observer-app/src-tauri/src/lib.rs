//! FaceCam Observer — a small desktop app for observer PCs.
//!
//! Watches this machine's Free Fire debugger folder (user-selectable), parses
//! observer switches with the shared debugger engine, and streams normalized
//! updates to the FaceCam controller over an authenticated WebSocket. It also
//! announces itself on the LAN for one-click pairing.

mod debugger;
mod ws;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use debugger::detector::{self, FolderValidation};
use debugger::state::CurrentObserverState;
use debugger::watcher::{EmitFn, WatchManager};
use ws::Broadcaster;

// ── Config ───────────────────────────────────────────────────────────

const APP_DIR: &str = "FaceCamObserver";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default = "default_discovery_port")]
    discovery_port: u16,
    #[serde(default = "gen_token")]
    token: String,
    #[serde(default = "gen_agent_id")]
    agent_id: String,
    #[serde(default = "default_machine")]
    machine_name: String,
    #[serde(default = "default_true")]
    broadcast_token: bool,
}

fn default_port() -> u16 {
    8787
}
fn default_discovery_port() -> u16 {
    8788
}
fn default_true() -> bool {
    true
}
fn default_machine() -> String {
    hostname()
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            folder: None,
            port: default_port(),
            discovery_port: default_discovery_port(),
            token: gen_token(),
            agent_id: gen_agent_id(),
            machine_name: default_machine(),
            broadcast_token: true,
        }
    }
}

// ── Live (non-persisted) status ──────────────────────────────────────

#[derive(Debug, Clone, Default)]
struct LiveStatus {
    status: String,
    last_message: Option<String>,
    current: Option<CurrentObserverState>,
    client_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusSnapshot {
    running: bool,
    folder: Option<String>,
    port: u16,
    discovery_port: u16,
    token: String,
    machine_name: String,
    agent_id: String,
    broadcast_token: bool,
    status: String,
    last_message: Option<String>,
    current_observer: Option<CurrentObserverState>,
    client_count: usize,
}

struct AppState {
    config: Mutex<AgentConfig>,
    live: Mutex<LiveStatus>,
    broadcaster: Broadcaster,
    watch: Arc<WatchManager>,
    running: AtomicBool,
    ws_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    beacon_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    heartbeat_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Serialize)]
struct CommandResult {
    success: bool,
    message: String,
}

// ── Helpers ──────────────────────────────────────────────────────────

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if getrandom::getrandom(&mut buf).is_err() {
        // Fallback: time-seeded, good enough for a non-secret id.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:032x}").chars().take(bytes * 2).collect();
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn gen_token() -> String {
    random_hex(24)
}
fn gen_agent_id() -> String {
    format!("obs-{}", random_hex(4))
}
fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Observer-PC".into())
}

fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR)
}
fn config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

fn load_config() -> AgentConfig {
    match std::fs::read_to_string(config_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AgentConfig::default(),
    }
}
fn persist_config(cfg: &AgentConfig) {
    let _ = std::fs::create_dir_all(app_data_dir());
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(config_path(), s);
    }
}

fn build_snapshot(state: &AppState) -> StatusSnapshot {
    let cfg = state.config.lock().unwrap().clone();
    let live = state.live.lock().unwrap().clone();
    StatusSnapshot {
        running: state.running.load(Ordering::SeqCst),
        folder: cfg.folder,
        port: cfg.port,
        discovery_port: cfg.discovery_port,
        token: cfg.token,
        machine_name: cfg.machine_name,
        agent_id: cfg.agent_id,
        broadcast_token: cfg.broadcast_token,
        status: if live.status.is_empty() {
            "disabled".into()
        } else {
            live.status
        },
        last_message: live.last_message,
        current_observer: live.current,
        client_count: live.client_count,
    }
}

fn emit_status(app: &AppHandle, state: &AppState) {
    let _ = app.emit("status", build_snapshot(state));
}

fn wire_payload(machine: &str, live: &LiveStatus) -> String {
    serde_json::json!({
        "machineName": machine,
        "currentObserver": live.current,
        "status": if live.status.is_empty() { "waiting" } else { &live.status },
        "lastMessage": live.last_message,
    })
    .to_string()
}

// ── Start / stop ─────────────────────────────────────────────────────

fn make_emit(app: AppHandle, state: Arc<AppState>) -> EmitFn {
    Arc::new(move |update| {
        {
            let mut live = state.live.lock().unwrap();
            live.status = update.status.clone();
            live.last_message = update.last_message.clone();
            live.current = update.current_observer.clone();
            let machine = state.config.lock().unwrap().machine_name.clone();
            state.broadcaster.publish(wire_payload(&machine, &live));
        }
        emit_status(&app, &state);
    })
}

fn restart_ws(app: &AppHandle, state: &Arc<AppState>) {
    if let Some(h) = state.ws_handle.lock().unwrap().take() {
        h.abort();
    }
    let (port, token) = {
        let c = state.config.lock().unwrap();
        (c.port, c.token.clone())
    };
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    let bc = state.broadcaster.clone();

    let app_cb = app.clone();
    let state_cb = state.clone();
    let on_clients: Arc<dyn Fn(usize) + Send + Sync> = Arc::new(move |count| {
        state_cb.live.lock().unwrap().client_count = count;
        emit_status(&app_cb, &state_cb);
    });

    let handle = tauri::async_runtime::spawn(async move {
        let _ = ws::serve(addr, token, bc, on_clients).await;
    });
    *state.ws_handle.lock().unwrap() = Some(handle);
}

fn restart_beacon(state: &Arc<AppState>) {
    if let Some(h) = state.beacon_handle.lock().unwrap().take() {
        h.abort();
    }
    let cfg = state.config.lock().unwrap().clone();
    let state_b = state.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let socket = match std::net::UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => return,
        };
        let _ = socket.set_broadcast(true);
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            ticker.tick().await;
            let status = state_b.live.lock().unwrap().status.clone();
            let beacon = serde_json::json!({
                "facecam": "observer-agent",
                "v": 1,
                "agentId": cfg.agent_id,
                "machineName": cfg.machine_name,
                "wsPort": cfg.port,
                "token": if cfg.broadcast_token { serde_json::json!(cfg.token) } else { serde_json::Value::Null },
                "status": if status.is_empty() { "waiting" } else { &status },
            })
            .to_string();
            let _ = socket.send_to(
                beacon.as_bytes(),
                ("255.255.255.255", cfg.discovery_port),
            );
        }
    });
    *state.beacon_handle.lock().unwrap() = Some(handle);
}

/// Re-send the current state to connected controllers on an interval so an
/// idle (no-switch) connection never looks dead. Cheap keepalive.
fn restart_heartbeat(state: &Arc<AppState>) {
    if let Some(h) = state.heartbeat_handle.lock().unwrap().take() {
        h.abort();
    }
    let state_h = state.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            ticker.tick().await;
            let machine = state_h.config.lock().unwrap().machine_name.clone();
            let live = state_h.live.lock().unwrap().clone();
            state_h.broadcaster.publish(wire_payload(&machine, &live));
        }
    });
    *state.heartbeat_handle.lock().unwrap() = Some(handle);
}

fn restart_watch(app: &AppHandle, state: &Arc<AppState>) {
    state.watch.stop_all();
    let folder = state.config.lock().unwrap().folder.clone();
    match folder {
        Some(f) => {
            let path = PathBuf::from(&f);
            if detector::validate(&path).valid {
                let emit = make_emit(app.clone(), state.clone());
                state.watch.start("local".into(), path, emit);
            } else {
                let mut live = state.live.lock().unwrap();
                live.status = "error".into();
                live.last_message = Some("Debugger folder not found or unreadable".into());
            }
        }
        None => {
            let mut live = state.live.lock().unwrap();
            live.status = "waiting".into();
            live.last_message = Some("Select your Free Fire debugger folder to start".into());
        }
    }
}

fn do_start(app: &AppHandle, state: &Arc<AppState>) {
    restart_watch(app, state);
    restart_ws(app, state);
    restart_beacon(state);
    restart_heartbeat(state);
    state.running.store(true, Ordering::SeqCst);
    emit_status(app, state);
}

fn do_stop(app: &AppHandle, state: &Arc<AppState>) {
    state.watch.stop_all();
    if let Some(h) = state.ws_handle.lock().unwrap().take() {
        h.abort();
    }
    if let Some(h) = state.beacon_handle.lock().unwrap().take() {
        h.abort();
    }
    if let Some(h) = state.heartbeat_handle.lock().unwrap().take() {
        h.abort();
    }
    state.running.store(false, Ordering::SeqCst);
    {
        let mut live = state.live.lock().unwrap();
        live.status = "disabled".into();
        live.last_message = Some("Stopped".into());
        live.client_count = 0;
    }
    emit_status(app, state);
}

// ── Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_status(state: tauri::State<'_, Arc<AppState>>) -> Result<StatusSnapshot, String> {
    Ok(build_snapshot(&state))
}

#[tauri::command]
fn validate_folder(path: String) -> Result<FolderValidation, String> {
    Ok(detector::validate(&PathBuf::from(path)))
}

#[tauri::command]
fn set_folder(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<FolderValidation, String> {
    let validation = detector::validate(&PathBuf::from(&path));
    if !validation.valid {
        return Err("That folder doesn't exist or can't be read".into());
    }
    {
        let mut c = state.config.lock().unwrap();
        c.folder = Some(path);
        persist_config(&c);
    }
    let state = state.inner().clone();
    if state.running.load(Ordering::SeqCst) {
        restart_watch(&app, &state);
    }
    emit_status(&app, &state);
    Ok(validation)
}

#[tauri::command]
fn set_port(
    app: AppHandle,
    port: u16,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    if port < 1024 {
        return Err("Use a port number of 1024 or higher".into());
    }
    {
        let mut c = state.config.lock().unwrap();
        c.port = port;
        persist_config(&c);
    }
    let state = state.inner().clone();
    if state.running.load(Ordering::SeqCst) {
        restart_ws(&app, &state);
        restart_beacon(&state);
    }
    emit_status(&app, &state);
    Ok(CommandResult {
        success: true,
        message: format!("Port set to {port}"),
    })
}

#[tauri::command]
fn set_machine_name(
    app: AppHandle,
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    {
        let mut c = state.config.lock().unwrap();
        c.machine_name = name;
        persist_config(&c);
    }
    emit_status(&app, &state);
    Ok(CommandResult {
        success: true,
        message: "Name updated".into(),
    })
}

#[tauri::command]
fn set_broadcast_token(
    app: AppHandle,
    enabled: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    {
        let mut c = state.config.lock().unwrap();
        c.broadcast_token = enabled;
        persist_config(&c);
    }
    let state = state.inner().clone();
    if state.running.load(Ordering::SeqCst) {
        restart_beacon(&state);
    }
    emit_status(&app, &state);
    Ok(CommandResult {
        success: true,
        message: "Updated".into(),
    })
}

#[tauri::command]
fn regenerate_token(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let token = gen_token();
    {
        let mut c = state.config.lock().unwrap();
        c.token = token.clone();
        persist_config(&c);
    }
    let state = state.inner().clone();
    if state.running.load(Ordering::SeqCst) {
        restart_ws(&app, &state);
        restart_beacon(&state);
    }
    emit_status(&app, &state);
    Ok(token)
}

#[tauri::command]
fn start_sharing(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    let state = state.inner().clone();
    do_start(&app, &state);
    Ok(CommandResult {
        success: true,
        message: "Sharing started".into(),
    })
}

#[tauri::command]
fn stop_sharing(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<CommandResult, String> {
    let state = state.inner().clone();
    do_stop(&app, &state);
    Ok(CommandResult {
        success: true,
        message: "Sharing stopped".into(),
    })
}

#[tauri::command]
fn list_local_ips() -> Result<Vec<String>, String> {
    // Enumerate every non-loopback IPv4 address so the user can see (and copy)
    // the right one — LAN (192.168.x), ZeroTier (10.x / 172.x), etc. The
    // primary outbound IP is listed first.
    let mut primary: Option<String> = None;
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                primary = Some(addr.ip().to_string());
            }
        }
    }

    let mut ips: Vec<String> = Vec::new();
    if let Some(p) = &primary {
        ips.push(p.clone());
    }
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            let ip = iface.ip();
            if ip.is_ipv4() && !ip.is_loopback() {
                let s = ip.to_string();
                if !ips.contains(&s) {
                    ips.push(s);
                }
            }
        }
    }
    Ok(ips)
}

// ── Entry ────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut config = load_config();
    // Auto-detect the debugger folder on first run if not set.
    if config.folder.is_none() {
        if let Some(found) = detector::auto_detect() {
            config.folder = Some(found.to_string_lossy().to_string());
        }
    }
    persist_config(&config);

    let state = Arc::new(AppState {
        config: Mutex::new(config),
        live: Mutex::new(LiveStatus::default()),
        broadcaster: Broadcaster::new(),
        watch: Arc::new(WatchManager::new()),
        running: AtomicBool::new(false),
        ws_handle: Mutex::new(None),
        beacon_handle: Mutex::new(None),
        heartbeat_handle: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let st = app.state::<Arc<AppState>>().inner().clone();
            // Auto-start sharing so the observer just runs the app and it works.
            do_start(&handle, &st);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            validate_folder,
            set_folder,
            set_port,
            set_machine_name,
            set_broadcast_token,
            regenerate_token,
            start_sharing,
            stop_sharing,
            list_local_ips,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FaceCam Observer");
}
