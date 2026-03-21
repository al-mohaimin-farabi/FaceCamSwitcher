mod capture;
mod matcher;
mod ocr;

use futures_util::{SinkExt, StreamExt};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval, Duration};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

// ── State ────────────────────────────────────────────────────────────

/// A player fetched from the server API (replaces Players Name.txt when server sync is enabled).
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Player {
    id: String,
    ign: String,
    #[serde(rename = "playerNumber")]
    player_number: Option<i32>,
}

struct OcrState {
    running: AtomicBool,
    matcher: Mutex<matcher::FuzzyMatcher>,
    /// Players fetched from server API — used for WebSocket player ID lookup.
    fetched_players: Mutex<Vec<Player>>,
    /// Channel sender to push messages into the active WebSocket connection.
    ws_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
}

/// Holds captured image data for the region selector overlay window.
struct RegionSelectorState {
    image_b64: Mutex<Option<String>>,
    original_width: Mutex<u32>,
    original_height: Mutex<u32>,
    /// Which source opened the selector: "window" or "camera"
    source_type: Mutex<String>,
    /// HWND of the window being selected (for window mode)
    source_hwnd: Mutex<i64>,
    /// Camera index (for camera mode)
    source_camera: Mutex<u32>,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    level: String,
    message: String,
}

#[derive(Serialize)]
struct CommandResult {
    success: bool,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct WindowRegion {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

#[derive(Serialize, Deserialize, Clone)]
struct InputSource {
    #[serde(rename = "type")]
    source_type: String,
    #[serde(default)]
    window_hwnd: i64,
    #[serde(default)]
    window_title: String,
    #[serde(default = "default_window_region")]
    window_region: WindowRegion,
    #[serde(default)]
    camera_index: u32,
}

fn default_window_region() -> WindowRegion {
    WindowRegion {
        left: 0,
        top: 0,
        width: 530,
        height: 193,
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct WindowInfo {
    hwnd: i64,
    title: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct CameraInfo {
    index: u32,
    name: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ServerConfig {
    #[serde(default)]
    enabled: bool,
    /// Legacy field — kept so old config.json files still deserialize without error.
    #[serde(default)]
    url: String,
    /// Base URL of the FaceCam API server (e.g. https://facecamapi.ecube.gg).
    #[serde(default)]
    api_url: String,
    /// WebSocket URL for the OCR bridge (e.g. wss://facecamapi.ecube.gg).
    #[serde(default)]
    ws_url: String,
    /// Tournament ID to load players from.
    #[serde(default)]
    tournament_id: String,
    /// OCR_SECRET_KEY from the server .env — used for API auth and WS auth.
    #[serde(default)]
    secret_key: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct OcrConfig {
    language: String,
    confidence_threshold: f64,
    fuzzy_match_threshold: u32,
    use_gpu: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct CaptureConfig {
    interval_seconds: f64,
    save_debug_screenshots: bool,
    debug_screenshot_dir: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    input_source: InputSource,
    server: ServerConfig,
    ocr: OcrConfig,
    capture: CaptureConfig,
    #[serde(default)]
    saved_regions: std::collections::HashMap<String, WindowRegion>,
}

// ── Helpers ──────────────────────────────────────────────────────────

const APP_DATA_SUBDIR: &str = "EfinityFaceCam";

fn get_app_data_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join(APP_DATA_SUBDIR);
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn ensure_default_config(dir: &PathBuf) {
    let config_path = dir.join("config.json");
    if !config_path.exists() {
        let default_config = r#"{
  "input_source": {
    "type": "window",
    "window_hwnd": 0,
    "window_title": "",
    "window_region": { "left": 0, "top": 0, "width": 530, "height": 193 },
    "camera_index": 0
  },
  "server": {
    "enabled": false,
    "url": "",
    "api_url": "https://facecamapi.ecube.gg",
    "ws_url": "wss://facecamapi.ecube.gg",
    "tournament_id": "",
    "secret_key": ""
  },
  "ocr": {
    "language": "en",
    "confidence_threshold": 0.6,
    "fuzzy_match_threshold": 80,
    "use_gpu": false
  },
  "capture": {
    "interval_seconds": 0.1,
    "save_debug_screenshots": false,
    "debug_screenshot_dir": ""
  }
}"#;
        let _ = fs::write(&config_path, default_config);
    }

    let players_path = dir.join("Players Name.txt");
    if !players_path.exists() {
        let _ = fs::write(&players_path, "# Add player names below, one per line\n");
    }
}

fn get_facecam_dir() -> PathBuf {
    let mut search_dirs = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            search_dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd.clone());
        search_dirs.push(cwd.join("..").join(".."));
    }
    search_dirs.push(get_app_data_dir());

    for dir in &search_dirs {
        if dir.join("config.json").exists() {
            return dir.to_path_buf();
        }
    }

    let data_dir = get_app_data_dir();
    let _ = fs::create_dir_all(&data_dir);
    ensure_default_config(&data_dir);
    data_dir
}

fn get_config_path() -> PathBuf {
    get_facecam_dir().join("config.json")
}

fn get_players_path() -> PathBuf {
    get_facecam_dir().join("Players Name.txt")
}

fn find_models_dir(app: &AppHandle) -> Option<PathBuf> {
    // Helper: check if a directory contains the required model files
    fn has_models(dir: &PathBuf) -> bool {
        dir.join("det.onnx").exists()
            && dir.join("rec.onnx").exists()
            && dir.join("en_dict.txt").exists()
    }

    let mut checked: Vec<String> = Vec::new();

    // 1. Tauri resource directory (official bundle path)
    if let Ok(res_dir) = app.path().resource_dir() {
        let models_sub = res_dir.join("models");
        checked.push(format!("resource_dir/models: {}", models_sub.display()));
        if has_models(&models_sub) {
            println!("[MODELS] Found at Tauri resource_dir: {}", models_sub.display());
            return Some(models_sub);
        }
        checked.push(format!("resource_dir: {}", res_dir.display()));
        if has_models(&res_dir) {
            println!("[MODELS] Found at Tauri resource_dir root: {}", res_dir.display());
            return Some(res_dir);
        }
    }

    // 2. Next to the executable (NSIS installs put models/ next to .exe)
    if let Ok(exe_path) = std::env::current_exe() {
        // Canonicalize to resolve symlinks/junctions and \\?\ prefixes
        let exe_path = exe_path.canonicalize().unwrap_or(exe_path);
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join("models");
            checked.push(format!("exe_dir/models: {}", candidate.display()));
            if has_models(&candidate) {
                println!("[MODELS] Found next to exe: {}", candidate.display());
                return Some(candidate);
            }

            // Dev: target/debug -> src-tauri/models
            let candidate_dev = exe_dir.join("..").join("..").join("models");
            checked.push(format!("dev(../../models): {}", candidate_dev.display()));
            if has_models(&candidate_dev) {
                println!("[MODELS] Found in dev path: {}", candidate_dev.display());
                return Some(candidate_dev);
            }

            // Dev: deeper repo root
            let candidate_dev2 = exe_dir
                .join("..").join("..").join("..").join("..").join("models");
            checked.push(format!("dev(../../../../models): {}", candidate_dev2.display()));
            if has_models(&candidate_dev2) {
                println!("[MODELS] Found in repo root: {}", candidate_dev2.display());
                return Some(candidate_dev2);
            }
        }
    }

    // 3. CWD-relative
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("models");
        checked.push(format!("cwd/models: {}", candidate.display()));
        if has_models(&candidate) {
            println!("[MODELS] Found in CWD: {}", candidate.display());
            return Some(candidate);
        }
    }

    // 4. AppData
    let appdata_models = get_app_data_dir().join("models");
    checked.push(format!("appdata/models: {}", appdata_models.display()));
    if has_models(&appdata_models) {
        println!("[MODELS] Found in AppData: {}", appdata_models.display());
        return Some(appdata_models);
    }

    // Log all checked paths for debugging
    eprintln!("[WARN] ONNX models not found. Checked paths:");
    for p in &checked {
        eprintln!("  - {}", p);
    }

    None
}

// ── Config Commands ──────────────────────────────────────────────────

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = get_config_path();
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: AppConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
    Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<CommandResult, String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(CommandResult {
        success: true,
        message: "Configuration saved".into(),
    })
}

// ── Window Enumeration (native via xcap) ────────────────────────────

#[tauri::command]
fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = capture::list_all_windows()?;
    Ok(windows
        .into_iter()
        .map(|(hwnd, title)| WindowInfo {
            hwnd: hwnd as i64,
            title,
        })
        .collect())
}

#[tauri::command]
fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    // Use DirectShow enumeration for the complete list of devices
    // (including virtual cameras like OBS, vMix, NDI).
    // DirectShow indices match the order that nokhwa/MF uses on Windows.
    let ds_devices = enumerate_directshow_video_devices().unwrap_or_default();

    if !ds_devices.is_empty() {
        return Ok(ds_devices);
    }

    // Fallback: MF enumeration
    let mf_devices = enumerate_mf_video_devices().unwrap_or_default();
    if !mf_devices.is_empty() {
        return Ok(mf_devices);
    }

    // Last resort: nokhwa
    use nokhwa::utils::CameraIndex;
    let cameras = nokhwa::query(nokhwa::utils::ApiBackend::Auto)
        .map_err(|e| format!("Failed to enumerate cameras: {e}"))?;
    Ok(cameras
        .into_iter()
        .map(|cam| {
            let index = match cam.index() {
                CameraIndex::Index(i) => *i,
                CameraIndex::String(_) => 0,
            };
            CameraInfo {
                index,
                name: cam.human_name().to_string(),
            }
        })
        .collect())
}

/// Enumerate video devices using Media Foundation's MFEnumDeviceSources.
/// This matches the indices used by capture_camera_frame.
fn enumerate_mf_video_devices() -> Result<Vec<CameraInfo>, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::*;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)
            .map_err(|e| format!("MFStartup failed: {e}"))?;

        let mut attributes: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attributes, 1)
            .map_err(|e| format!("MFCreateAttributes failed: {e}"))?;
        let attributes = attributes.ok_or("MFCreateAttributes returned null")?;

        attributes.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        ).map_err(|e| format!("SetGUID failed: {e}"))?;

        let mut devices_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;
        MFEnumDeviceSources(&attributes, &mut devices_ptr, &mut count)
            .map_err(|e| format!("MFEnumDeviceSources failed: {e}"))?;

        let mut result = Vec::new();

        if count > 0 && !devices_ptr.is_null() {
            let devices = std::slice::from_raw_parts(devices_ptr, count as usize);
            for i in 0..count {
                if let Some(ref activate) = devices[i as usize] {
                    let mut name_ptr = windows::core::PWSTR::null();
                    let mut name_len = 0u32;
                    if activate.GetAllocatedString(
                        &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                        &mut name_ptr,
                        &mut name_len,
                    ).is_ok() {
                        let name = name_ptr.to_string().unwrap_or_default();
                        if !name.is_empty() {
                            result.push(CameraInfo {
                                index: i,
                                name,
                            });
                        }
                        CoTaskMemFree(Some(name_ptr.as_ptr() as *const _));
                    }
                }
            }
            CoTaskMemFree(Some(devices_ptr as *const _));
        }

        MFShutdown().ok();
        Ok(result)
    }
}

/// Enumerate video input devices using DirectShow's ICreateDevEnum COM interface.
/// This sees all registered video capture devices including virtual cameras.
fn enumerate_directshow_video_devices() -> Result<Vec<CameraInfo>, String> {
    use windows::Win32::Media::DirectShow::ICreateDevEnum;
    use windows::Win32::Media::MediaFoundation::{
        CLSID_SystemDeviceEnum, CLSID_VideoInputDeviceCategory,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IEnumMoniker, IMoniker,
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Com::StructuredStorage::IPropertyBag;
    use windows::core::VARIANT;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let dev_enum: ICreateDevEnum = CoCreateInstance(
            &CLSID_SystemDeviceEnum,
            None,
            CLSCTX_INPROC_SERVER,
        )
        .map_err(|e| format!("CoCreateInstance failed: {e}"))?;

        let mut enum_moniker: Option<IEnumMoniker> = None;
        dev_enum
            .CreateClassEnumerator(
                &CLSID_VideoInputDeviceCategory,
                &mut enum_moniker,
                0,
            )
            .map_err(|e| format!("CreateClassEnumerator failed: {e}"))?;

        let enum_moniker = match enum_moniker {
            Some(e) => e,
            None => {
                CoUninitialize();
                return Ok(Vec::new());
            }
        };

        let mut devices = Vec::new();
        let mut moniker_array: [Option<IMoniker>; 1] = [None];
        let mut fetched = 0u32;
        let mut index = 0u32;

        loop {
            let hr = enum_moniker.Next(&mut moniker_array, Some(&mut fetched));
            if hr.is_err() || fetched == 0 {
                break;
            }

            if let Some(ref moniker) = moniker_array[0] {
                let bag: Result<IPropertyBag, _> = moniker.BindToStorage(None, None);
                if let Ok(bag) = bag {
                    let mut var = VARIANT::default();
                    let prop_name = windows::core::BSTR::from("FriendlyName");
                    if bag.Read(&prop_name, &mut var, None).is_ok() {
                        if let Ok(name) = windows::core::BSTR::try_from(&var) {
                            let name_str = name.to_string();
                            if !name_str.is_empty() {
                                devices.push(CameraInfo {
                                    index,
                                    name: name_str,
                                });
                                index += 1;
                            }
                        }
                    }
                }
            }

            moniker_array[0] = None;
        }

        CoUninitialize();
        Ok(devices)
    }
}

// ── Player Name Commands ─────────────────────────────────────────────

#[tauri::command]
fn load_players() -> Result<Vec<String>, String> {
    let path = get_players_path();
    if !path.exists() {
        let _ = fs::write(&path, "");
        return Ok(vec![]);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read players file: {}", e))?;
    let names: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    Ok(names)
}

#[tauri::command]
fn save_players(
    players: Vec<String>,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    let path = get_players_path();
    let content = players.join("\n");
    fs::write(&path, content).map_err(|e| format!("Failed to write players file: {}", e))?;
    // Update the live matcher
    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(players.clone());
    }
    Ok(CommandResult {
        success: true,
        message: format!("Saved {} player name(s)", players.len()),
    })
}

#[tauri::command]
fn add_player(
    name: String,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    let path = get_players_path();
    let mut names = load_players().unwrap_or_default();

    let trimmed = name.trim().to_uppercase();
    if trimmed.is_empty() {
        return Ok(CommandResult {
            success: false,
            message: "Player name cannot be empty".into(),
        });
    }

    if names.iter().any(|n| n.to_uppercase() == trimmed) {
        return Ok(CommandResult {
            success: false,
            message: format!("'{}' already exists", trimmed),
        });
    }

    names.push(trimmed.clone());
    let content = names.join("\n");
    fs::write(&path, content).map_err(|e| format!("Failed to write players file: {}", e))?;

    // Update live matcher
    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(names);
    }

    Ok(CommandResult {
        success: true,
        message: format!("Added '{}'", trimmed),
    })
}

#[tauri::command]
fn remove_player(
    name: String,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    let path = get_players_path();
    let mut names = load_players().unwrap_or_default();

    let before = names.len();
    names.retain(|n| n.to_uppercase() != name.to_uppercase());

    if names.len() == before {
        return Ok(CommandResult {
            success: false,
            message: format!("'{}' not found", name),
        });
    }

    let content = names.join("\n");
    fs::write(&path, content).map_err(|e| format!("Failed to write players file: {}", e))?;

    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(names);
    }

    Ok(CommandResult {
        success: true,
        message: format!("Removed '{}'", name),
    })
}

// ── Server Integration ───────────────────────────────────────────────

#[derive(Deserialize)]
struct FetchPlayersResponse {
    players: Vec<Player>,
}

/// Fetch tournament player list from the server API.
/// Updates the FuzzyMatcher and stores players for WebSocket ID lookup.
/// Call this once before starting OCR (via the Settings "Fetch Players" button).
#[tauri::command]
async fn fetch_players_from_server(
    app: AppHandle,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<Vec<Player>, String> {
    let config = load_config()?;

    if !config.server.enabled {
        return Err("Server sync is disabled. Enable it in Settings.".into());
    }
    if config.server.api_url.is_empty()
        || config.server.tournament_id.is_empty()
        || config.server.secret_key.is_empty()
    {
        return Err("API URL, Tournament ID, and Secret Key are all required.".into());
    }

    let url = format!(
        "{}/api/ocr/tournament/{}",
        config.server.api_url.trim_end_matches('/'),
        config.server.tournament_id
    );

    let client = HttpClient::new();
    let resp = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", config.server.secret_key),
        )
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let data: FetchPlayersResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Store fetched players for WebSocket ID lookups
    {
        let mut fp = state.fetched_players.lock().unwrap();
        *fp = data.players.clone();
    }

    // Update the live FuzzyMatcher with the new IGN list
    let igns: Vec<String> = data.players.iter().map(|p| p.ign.clone()).collect();
    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(igns.clone());
    }

    // Write to Players Name.txt so the Players page reflects the server list
    let players_path = get_players_path();
    let content = igns.join("\n");
    fs::write(&players_path, &content)
        .map_err(|e| format!("Failed to write Players Name.txt: {e}"))?;

    let _ = app.emit(
        "log",
        LogEvent {
            level: "success".into(),
            message: format!(
                "Loaded {} players from server (tournament: {})",
                data.players.len(),
                config.server.tournament_id
            ),
        },
    );

    Ok(data.players)
}

// ── OCR Commands (native Rust) ──────────────────────────────────────

#[tauri::command]
async fn start_ocr(
    app: AppHandle,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("OCR already running".into());
    }

    let config = match load_config() {
        Ok(c) => c,
        Err(e) => {
            state.running.store(false, Ordering::SeqCst);
            return Err(format!("Failed to load config: {e}"));
        }
    };

    let state_arc = state.inner().clone();

    // If server sync is enabled, connect WebSocket before starting OCR loop
    if config.server.enabled && !config.server.ws_url.is_empty() {
        let ws_url = format!(
            "{}/ocr-ws",
            config.server.ws_url.trim_end_matches('/')
        );
        let state_ws = state_arc.clone();
        let app_ws = app.clone();
        let tournament_id = config.server.tournament_id.clone();
        let secret_key = config.server.secret_key.clone();
        tokio::spawn(async move {
            run_ws_loop(app_ws, state_ws, ws_url, tournament_id, secret_key).await;
        });
    }

    let app_ocr = app.clone();
    tokio::spawn(async move {
        run_ocr_loop(app_ocr, state_arc).await;
    });

    Ok(CommandResult {
        success: true,
        message: "OCR capture started (Rust native)".into(),
    })
}

/// Maintains a persistent WebSocket connection to the server OCR bridge.
/// Authenticates on connect, then forwards messages from the OCR loop.
/// Reconnects automatically if the connection drops while OCR is running.
async fn run_ws_loop(
    app: AppHandle,
    state: Arc<OcrState>,
    ws_url: String,
    tournament_id: String,
    secret_key: String,
) {
    let reconnect_delay = Duration::from_secs(5);

    while state.running.load(Ordering::SeqCst) {
        let _ = app.emit(
            "log",
            LogEvent {
                level: "info".into(),
                message: format!("Connecting to WebSocket: {ws_url}"),
            },
        );

        match connect_async(&ws_url).await {
            Ok((ws_stream, _)) => {
                let (mut write, mut read) = ws_stream.split();

                // Send auth message
                let auth_msg = serde_json::json!({
                    "type": "auth",
                    "secretKey": secret_key,
                    "tournamentId": tournament_id,
                })
                .to_string();

                if let Err(e) = write.send(Message::Text(auth_msg.into())).await {
                    let _ = app.emit(
                        "log",
                        LogEvent {
                            level: "error".into(),
                            message: format!("WS auth send failed: {e}"),
                        },
                    );
                    break;
                }

                // Create channel for OCR loop → WebSocket
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                {
                    let mut ws_tx = state.ws_tx.lock().unwrap();
                    *ws_tx = Some(tx);
                }

                let _ = app.emit("ws_status", serde_json::json!({ "connected": true }));
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: "success".into(),
                        message: "WebSocket connected to server".into(),
                    },
                );

                // Spawn write task: forwards OCR messages to WebSocket
                let write_task = tokio::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        if write.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                });

                // Read loop: handle auth response and keep-alive pings
                let mut auth_ok = false;
                while state.running.load(Ordering::SeqCst) {
                    match read.next().await {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                if v["type"] == "auth" {
                                    if v["success"] == false {
                                        let _ = app.emit(
                                            "log",
                                            LogEvent {
                                                level: "error".into(),
                                                message: format!(
                                                    "WS auth rejected: {}",
                                                    v["message"].as_str().unwrap_or("unknown")
                                                ),
                                            },
                                        );
                                        // Auth failed — don't reconnect
                                        state.running.store(false, Ordering::SeqCst);
                                        break;
                                    } else {
                                        auth_ok = true;
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Ping(data))) => {
                            // Pong is handled automatically by tungstenite
                            let _ = data;
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Err(e)) => {
                            let _ = app.emit(
                                "log",
                                LogEvent {
                                    level: "warning".into(),
                                    message: format!("WS read error: {e}"),
                                },
                            );
                            break;
                        }
                        _ => {}
                    }
                }

                let _ = auth_ok; // suppress unused warning

                // Cleanup
                write_task.abort();
                {
                    let mut ws_tx = state.ws_tx.lock().unwrap();
                    *ws_tx = None;
                }
                let _ = app.emit("ws_status", serde_json::json!({ "connected": false }));
            }
            Err(e) => {
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: "warning".into(),
                        message: format!("WS connect failed: {e}. Retrying in 5s..."),
                    },
                );
            }
        }

        if !state.running.load(Ordering::SeqCst) {
            break;
        }

        tokio::time::sleep(reconnect_delay).await;
    }

    // Final cleanup
    let mut ws_tx = state.ws_tx.lock().unwrap();
    *ws_tx = None;
}

async fn run_ocr_loop(app: AppHandle, state: Arc<OcrState>) {
    // Load config
    let config: AppConfig = match load_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                "log",
                LogEvent {
                    level: "error".into(),
                    message: format!("Failed to load config: {e}"),
                },
            );
            state.running.store(false, Ordering::SeqCst);
            let _ = app.emit("ocr_stopped", ());
            return;
        }
    };

    let capture_interval = config.capture.interval_seconds.max(0.1);
    let confidence_threshold = config.ocr.confidence_threshold as f32;

    let _ = app.emit(
        "log",
        LogEvent {
            level: "info".into(),
            message: "OCR engine started (Rust native ONNX)".into(),
        },
    );

    let mut ticker = interval(Duration::from_secs_f64(capture_interval));

    while state.running.load(Ordering::SeqCst) {
        ticker.tick().await;

        // Capture frame based on input source type
        let region = &config.input_source.window_region;
        let img_result = if config.input_source.source_type == "window" {
            let hwnd = config.input_source.window_hwnd as isize;
            if hwnd == 0 {
                // No window selected — capture screen region
                capture::capture_screen_region(
                    region.left,
                    region.top,
                    region.width.max(0) as u32,
                    region.height.max(0) as u32,
                )
            } else {
                capture::capture_window_region(
                    hwnd,
                    region.left,
                    region.top,
                    region.width.max(0) as u32,
                    region.height.max(0) as u32,
                )
            }
        } else {
            // Camera mode: capture frame from camera, then crop to region
            let cam_idx = config.input_source.camera_index;
            capture::capture_camera_frame(cam_idx).and_then(|full| {
                let rw = region.width.max(0) as u32;
                let rh = region.height.max(0) as u32;
                if rw == 0 || rh == 0 {
                    Ok(full)
                } else {
                    let cx = (region.left as u32).min(full.width().saturating_sub(1));
                    let cy = (region.top as u32).min(full.height().saturating_sub(1));
                    let cw = rw.min(full.width().saturating_sub(cx)).max(1);
                    let ch = rh.min(full.height().saturating_sub(cy)).max(1);
                    Ok(full.crop_imm(cx, cy, cw, ch))
                }
            })
        };

        let img = match img_result {
            Ok(img) => img,
            Err(e) => {
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: "error".into(),
                        message: format!("Capture failed: {e}"),
                    },
                );
                continue;
            }
        };

        // Encode preview image
        let preview_b64 = capture::image_to_base64_jpeg(&img).unwrap_or_default();

        // Run OCR (blocking work — run on blocking thread pool)
        let preprocessed = capture::preprocess_for_ocr(&img);
        let ocr_results = tokio::task::spawn_blocking(move || ocr::run_ocr(&preprocessed)).await;

        let results = match ocr_results {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: "error".into(),
                        message: format!("OCR failed: {e}"),
                    },
                );
                // Still send preview with no detections
                send_preview(&app, &preview_b64, &[]);
                continue;
            }
            Err(e) => {
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: "error".into(),
                        message: format!("OCR task panicked: {e}"),
                    },
                );
                continue;
            }
        };

        // Match results against player names
        let matcher_guard = state.matcher.lock().unwrap();
        let mut detections = Vec::new();

        for result in &results {
            if result.confidence >= confidence_threshold {
                let matched =
                    matcher_guard.find_match(&result.text, result.confidence as f64);

                let level = if matched.matched_name.is_some() {
                    "success"
                } else {
                    "info"
                };
                let _ = app.emit(
                    "log",
                    LogEvent {
                        level: level.into(),
                        message: format!(
                            "\"{}\" → {} (conf: {:.0}%, fuzz: {:.0})",
                            result.text,
                            matched
                                .matched_name
                                .as_deref()
                                .unwrap_or("No match"),
                            result.confidence * 100.0,
                            matched.match_score
                        ),
                    },
                );

                detections.push(matched);
            }
        }
        drop(matcher_guard);

        // Send preview with detections
        send_preview(&app, &preview_b64, &detections);

        // Send OCR result to server via WebSocket
        {
            let best_match = detections
                .iter()
                .filter(|d| d.matched_name.is_some())
                .max_by(|a, b| {
                    a.match_score
                        .partial_cmp(&b.match_score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

            if let Ok(ws_tx_guard) = state.ws_tx.lock() {
                if let Some(tx) = ws_tx_guard.as_ref() {
                    let msg = if let Some(det) = best_match {
                        // Look up player ID from fetched_players by IGN
                        let player_id = {
                            let fp = state.fetched_players.lock().unwrap();
                            fp.iter()
                                .find(|p| {
                                    p.ign.to_lowercase()
                                        == det
                                            .matched_name
                                            .as_deref()
                                            .unwrap_or("")
                                            .to_lowercase()
                                })
                                .map(|p| p.id.clone())
                        };
                        match player_id {
                            Some(pid) => serde_json::json!({
                                "type": "playerDetected",
                                "playerId": pid
                            })
                            .to_string(),
                            // IGN matched but player not in fetched list — send noMatch
                            None => serde_json::json!({ "type": "noMatch" }).to_string(),
                        }
                    } else {
                        serde_json::json!({ "type": "noMatch" }).to_string()
                    };
                    let _ = tx.send(msg);
                }
            }
        }
    }

    let _ = app.emit(
        "log",
        LogEvent {
            level: "warning".into(),
            message: "OCR capture stopped".into(),
        },
    );
    let _ = app.emit("ocr_stopped", ());
}

fn send_preview(app: &AppHandle, image_b64: &str, detections: &[matcher::MatchResult]) {
    let preview_json = serde_json::json!({
        "image": image_b64,
        "detections": detections
    });
    let _ = app.emit(
        "log",
        LogEvent {
            level: "preview".into(),
            message: preview_json.to_string(),
        },
    );
}

#[tauri::command]
async fn stop_ocr(state: tauri::State<'_, Arc<OcrState>>) -> Result<CommandResult, String> {
    if state.running.swap(false, Ordering::SeqCst) {
        Ok(CommandResult {
            success: true,
            message: "OCR capture stopped".into(),
        })
    } else {
        Ok(CommandResult {
            success: false,
            message: "No OCR process is running".into(),
        })
    }
}

#[tauri::command]
fn check_backend(app: AppHandle) -> Result<CommandResult, String> {
    if ocr::is_initialized() {
        return Ok(CommandResult {
            success: true,
            message: "Rust native OCR (ONNX Runtime)".into(),
        });
    }

    // OCR not initialized — try to find models and initialize now
    match find_models_dir(&app) {
        Some(dir) => {
            // Try to initialize OCR with the found models
            match ocr::init_ocr(&dir) {
                Ok(()) => {
                    println!("[INFO] OCR models lazy-loaded from: {}", dir.display());
                    Ok(CommandResult {
                        success: true,
                        message: format!("Rust native OCR (ONNX Runtime) — loaded from {}", dir.display()),
                    })
                }
                Err(e) => {
                    eprintln!("[ERROR] Failed to load OCR models from {}: {e}", dir.display());
                    Ok(CommandResult {
                        success: false,
                        message: format!("Models found at {} but failed to load: {}", dir.display(), e),
                    })
                }
            }
        }
        None => Ok(CommandResult {
            success: false,
            message: "ONNX models not found. Place det.onnx, rec.onnx, and en_dict.txt in a 'models' directory.".into(),
        }),
    }
}

// ── Region Selectors ────────────────────────────────────────────────

#[tauri::command]
async fn open_window_region_selector(
    app: AppHandle,
    hwnd: i64,
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<CommandResult, String> {
    let _ = app.emit(
        "log",
        LogEvent {
            level: "info".into(),
            message: format!("Capturing window (HWND {hwnd}) for region selection..."),
        },
    );

    // Capture the full window
    let img = capture::capture_window_region(hwnd as isize, 0, 0, 0, 0)
        .map_err(|e| format!("Failed to capture window: {e}"))?;

    let b64 = capture::image_to_base64_jpeg(&img)
        .map_err(|e| format!("Failed to encode image: {e}"))?;

    // Store in state
    *rs_state.original_width.lock().unwrap() = img.width();
    *rs_state.original_height.lock().unwrap() = img.height();
    *rs_state.image_b64.lock().unwrap() = Some(b64);
    *rs_state.source_type.lock().unwrap() = "window".into();
    *rs_state.source_hwnd.lock().unwrap() = hwnd;

    // Open the region selector window
    open_region_selector_window(&app)?;

    Ok(CommandResult {
        success: true,
        message: "Region selector opened".into(),
    })
}

#[tauri::command]
async fn open_camera_region_selector(
    app: AppHandle,
    _camera_index: u32,
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<CommandResult, String> {
    let _ = app.emit(
        "log",
        LogEvent {
            level: "info".into(),
            message: format!("Capturing frame from camera {} for region selection...", _camera_index),
        },
    );

    // Capture a live frame from the selected camera
    let img = capture::capture_camera_frame(_camera_index)
        .map_err(|e| format!("Failed to capture camera frame: {e}"))?;

    let b64 = capture::image_to_base64_jpeg(&img)
        .map_err(|e| format!("Failed to encode image: {e}"))?;

    *rs_state.original_width.lock().unwrap() = img.width();
    *rs_state.original_height.lock().unwrap() = img.height();
    *rs_state.image_b64.lock().unwrap() = Some(b64);
    *rs_state.source_type.lock().unwrap() = "camera".into();
    *rs_state.source_camera.lock().unwrap() = _camera_index;

    open_region_selector_window(&app)?;

    Ok(CommandResult {
        success: true,
        message: "Region selector opened".into(),
    })
}

fn open_region_selector_window(app: &AppHandle) -> Result<(), String> {
    // Close and destroy existing selector window if open
    if let Some(existing) = app.get_webview_window("region-selector") {
        let _ = existing.destroy();
    }

    let _win = tauri::WebviewWindowBuilder::new(
        app,
        "region-selector",
        tauri::WebviewUrl::App("region-selector.html".into()),
    )
    .title("Select Capture Region")
    .maximized(true)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to open region selector window: {e}"))?;

    Ok(())
}

#[tauri::command]
fn get_region_selector_image(
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<serde_json::Value, String> {
    let image = rs_state.image_b64.lock().unwrap();
    let image = image.as_ref().ok_or("No image available")?;
    let w = *rs_state.original_width.lock().unwrap();
    let h = *rs_state.original_height.lock().unwrap();

    Ok(serde_json::json!({
        "image": image,
        "original_width": w,
        "original_height": h,
    }))
}

#[tauri::command]
async fn save_selected_region(
    app: AppHandle,
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<CommandResult, String> {
    // Load current config
    let mut config = load_config()?;

    let source_type = rs_state.source_type.lock().unwrap().clone();

    // Update the region in config
    config.input_source.window_region = WindowRegion {
        left,
        top,
        width,
        height,
    };

    // Save config
    save_config(config)?;

    let _ = app.emit(
        "log",
        LogEvent {
            level: "success".into(),
            message: format!(
                "Region saved: ({}, {}) {}x{} [{}]",
                left, top, width, height, source_type
            ),
        },
    );

    // Notify frontend to reload config
    let _ = app.emit("region-saved", ());

    // Clear stored image to free memory
    *rs_state.image_b64.lock().unwrap() = None;

    Ok(CommandResult {
        success: true,
        message: format!("Region saved: ({}, {}) {}x{}", left, top, width, height),
    })
}

// ── App entry ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize ONNX models
            let models_initialized = if let Some(models_dir) = find_models_dir(app.handle()) {
                match ocr::init_ocr(&models_dir) {
                    Ok(()) => {
                        println!("[INFO] OCR models loaded from: {}", models_dir.display());
                        true
                    }
                    Err(e) => {
                        eprintln!("[WARN] Failed to load OCR models: {e}");
                        false
                    }
                }
            } else {
                eprintln!("[WARN] ONNX models directory not found. OCR will not be available until models are placed.");
                false
            };

            // Load player names
            let players: Vec<String> = load_players()
                .unwrap_or_default();

            let threshold = match load_config() {
                Ok(c) => c.ocr.fuzzy_match_threshold as f64,
                Err(_) => 70.0,
            };

            app.manage(Arc::new(OcrState {
                running: AtomicBool::new(false),
                matcher: Mutex::new(matcher::FuzzyMatcher::new(players, threshold)),
                fetched_players: Mutex::new(Vec::new()),
                ws_tx: Mutex::new(None),
            }));

            app.manage(Arc::new(RegionSelectorState {
                image_b64: Mutex::new(None),
                original_width: Mutex::new(0),
                original_height: Mutex::new(0),
                source_type: Mutex::new("window".into()),
                source_hwnd: Mutex::new(0),
                source_camera: Mutex::new(0),
            }));

            if models_initialized {
                println!("[INFO] Efinity FaceCam ready — Rust native OCR active");
            } else {
                println!("[INFO] Efinity FaceCam ready — OCR models not loaded (check 'models' directory)");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_windows,
            list_cameras,
            open_window_region_selector,
            open_camera_region_selector,
            load_players,
            save_players,
            add_player,
            remove_player,
            fetch_players_from_server,
            start_ocr,
            stop_ocr,
            check_backend,
            get_region_selector_image,
            save_selected_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
