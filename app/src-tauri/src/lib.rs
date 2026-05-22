mod capture;
mod matcher;
mod ocr;

use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval, Duration};

// ── State ────────────────────────────────────────────────────────────

struct OcrState {
    running: AtomicBool,
    /// Monotonically increasing generation — each start_ocr() bumps this.
    /// Stale loops detect the bump and exit without touching shared state.
    loop_generation: AtomicU64,
    matcher: Mutex<matcher::FuzzyMatcher>,
    /// Last camera input name sent to vMix (dedup — only send on change).
    last_sent_camera: Mutex<Option<String>>,
}

/// Holds captured image data for the region selector overlay window.
struct RegionSelectorState {
    image_b64: Mutex<Option<String>>,
    original_width: Mutex<u32>,
    original_height: Mutex<u32>,
    source_type: Mutex<String>,
    source_hwnd: Mutex<i64>,
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
struct VmixConfig {
    #[serde(default = "default_vmix_ip")]
    ip: String,
    #[serde(default = "default_vmix_port")]
    port: u16,
    #[serde(default = "default_vmix_layer")]
    layer: u32,
    /// vMix input names that are the "target sources" (e.g. "Gameplay", "OB 1").
    /// SetLayer is fired on every checked source simultaneously.
    #[serde(default)]
    target_sources: Vec<String>,
    /// Milliseconds a detection must be stable before vMix is called.
    #[serde(default = "default_debounce_ms")]
    debounce_ms: u64,
    /// Milliseconds of blank/no-match before the layer is cleared (SetLayer → None).
    #[serde(default = "default_clear_timeout_ms")]
    clear_timeout_ms: u64,
}

fn default_vmix_ip() -> String { "192.168.1.100".into() }
fn default_vmix_port() -> u16 { 8088 }
fn default_vmix_layer() -> u32 { 7 }
fn default_debounce_ms() -> u64 { 1500 }
fn default_clear_timeout_ms() -> u64 { 5000 }

impl Default for VmixConfig {
    fn default() -> Self {
        VmixConfig {
            ip: default_vmix_ip(),
            port: default_vmix_port(),
            layer: default_vmix_layer(),
            target_sources: Vec::new(),
            debounce_ms: default_debounce_ms(),
            clear_timeout_ms: default_clear_timeout_ms(),
        }
    }
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
    #[serde(default)]
    vmix: VmixConfig,
    /// Maps matched player name (e.g. "RHK.BLADE") to vMix camera input name (e.g. "Camera 1").
    #[serde(default)]
    player_camera_map: std::collections::HashMap<String, String>,
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
  "vmix": {
    "ip": "192.168.1.100",
    "port": 8088,
    "layer": 7,
    "target_sources": [],
    "debounce_ms": 1500,
    "clear_timeout_ms": 5000
  },
  "player_camera_map": {},
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
    fn has_models(dir: &PathBuf) -> bool {
        dir.join("det.onnx").exists()
            && dir.join("rec.onnx").exists()
            && dir.join("en_dict.txt").exists()
    }

    let mut checked: Vec<String> = Vec::new();

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

    if let Ok(exe_path) = std::env::current_exe() {
        let exe_path = exe_path.canonicalize().unwrap_or(exe_path);
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join("models");
            checked.push(format!("exe_dir/models: {}", candidate.display()));
            if has_models(&candidate) {
                println!("[MODELS] Found next to exe: {}", candidate.display());
                return Some(candidate);
            }

            let candidate_dev = exe_dir.join("..").join("..").join("models");
            checked.push(format!("dev(../../models): {}", candidate_dev.display()));
            if has_models(&candidate_dev) {
                println!("[MODELS] Found in dev path: {}", candidate_dev.display());
                return Some(candidate_dev);
            }

            let candidate_dev2 = exe_dir
                .join("..").join("..").join("..").join("..").join("models");
            checked.push(format!("dev(../../../../models): {}", candidate_dev2.display()));
            if has_models(&candidate_dev2) {
                println!("[MODELS] Found in repo root: {}", candidate_dev2.display());
                return Some(candidate_dev2);
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("models");
        checked.push(format!("cwd/models: {}", candidate.display()));
        if has_models(&candidate) {
            println!("[MODELS] Found in CWD: {}", candidate.display());
            return Some(candidate);
        }
    }

    let appdata_models = get_app_data_dir().join("models");
    checked.push(format!("appdata/models: {}", appdata_models.display()));
    if has_models(&appdata_models) {
        println!("[MODELS] Found in AppData: {}", appdata_models.display());
        return Some(appdata_models);
    }

    eprintln!("[WARN] ONNX models not found. Checked paths:");
    for p in &checked {
        eprintln!("  - {}", p);
    }
    None
}

// ── vMix API ─────────────────────────────────────────────────────────

/// Fire SetLayer for every target source in parallel.
/// `camera_input` = None sends `Value=[layer],None` to clear the layer.
async fn call_vmix_set_layer(
    ip: &str,
    port: u16,
    layer: u32,
    target_sources: &[String],
    camera_input: Option<&str>,
) -> Vec<Result<(), String>> {
    if target_sources.is_empty() {
        return vec![];
    }

    let value = match camera_input {
        Some(cam) => format!("{},{}", layer, cam),
        None => format!("{},None", layer),
    };

    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let mut handles = Vec::new();
    for source in target_sources {
        let url = format!(
            "http://{}:{}/api/?Function=SetLayer&Input={}&Value={}",
            ip,
            port,
            urlencoded(source),
            urlencoded(&value),
        );
        let c = client.clone();
        handles.push(tokio::spawn(async move {
            match c.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => Ok(()),
                Ok(resp) => Err(format!("vMix returned {}", resp.status())),
                Err(e) => Err(format!("vMix request failed: {e}")),
            }
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        results.push(h.await.unwrap_or_else(|e| Err(format!("Task panicked: {e}"))));
    }
    results
}

fn urlencoded(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                vec![c]
            }
            ' ' => vec!['+'],
            c => {
                let mut buf = [0u8; 4];
                let bytes = c.encode_utf8(&mut buf).as_bytes().to_vec();
                bytes.iter().flat_map(|b| {
                    format!("%{:02X}", b).chars().collect::<Vec<_>>()
                }).collect()
            }
        })
        .collect()
}

/// Ping the vMix API root to verify connectivity.
#[tauri::command]
async fn test_vmix_connection() -> Result<CommandResult, String> {
    let config = load_config()?;
    let url = format!("http://{}:{}/api/", config.vmix.ip, config.vmix.port);
    let client = HttpClient::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => Ok(CommandResult {
            success: true,
            message: format!("vMix reachable at {}:{}", config.vmix.ip, config.vmix.port),
        }),
        Ok(resp) => Ok(CommandResult {
            success: false,
            message: format!("vMix returned HTTP {}", resp.status()),
        }),
        Err(e) => Ok(CommandResult {
            success: false,
            message: format!("Cannot reach vMix: {e}"),
        }),
    }
}

/// Manually clear the vMix layer on all target sources (sends Value=[layer],None).
#[tauri::command]
async fn send_vmix_layer_clear(
    app: AppHandle,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    let config = load_config()?;
    let results = call_vmix_set_layer(
        &config.vmix.ip,
        config.vmix.port,
        config.vmix.layer,
        &config.vmix.target_sources,
        None,
    ).await;

    // Reset dedup so next detection fires immediately
    if let Ok(mut last) = state.last_sent_camera.lock() {
        *last = None;
    }

    let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
    if errors.is_empty() {
        let _ = app.emit("log", LogEvent {
            level: "success".into(),
            message: format!("[vMix] Layer {} cleared on {} source(s)", config.vmix.layer, config.vmix.target_sources.len()),
        });
        Ok(CommandResult { success: true, message: "Layer cleared".into() })
    } else {
        Ok(CommandResult {
            success: false,
            message: format!("Partial failure: {:?}", errors),
        })
    }
}

// ── Config Commands ───────────────────────────────────────────────────

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

// ── Window Enumeration ───────────────────────────────────────────────

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
    let ds_devices = enumerate_directshow_video_devices().unwrap_or_default();
    if !ds_devices.is_empty() {
        return Ok(ds_devices);
    }

    let mf_devices = enumerate_mf_video_devices().unwrap_or_default();
    if !mf_devices.is_empty() {
        return Ok(mf_devices);
    }

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
                            result.push(CameraInfo { index: i, name });
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
                                devices.push(CameraInfo { index, name: name_str });
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

// ── Player Name Commands ──────────────────────────────────────────────

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
    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(names);
    }
    Ok(CommandResult { success: true, message: format!("Added '{}'", trimmed) })
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
        return Ok(CommandResult { success: false, message: format!("'{}' not found", name) });
    }
    let content = names.join("\n");
    fs::write(&path, content).map_err(|e| format!("Failed to write players file: {}", e))?;
    if let Ok(mut m) = state.matcher.lock() {
        m.update_players(names);
    }
    Ok(CommandResult { success: true, message: format!("Removed '{}'", name) })
}

#[tauri::command]
fn rename_player(
    old_name: String,
    new_name: String,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    let path = get_players_path();
    let mut names = load_players().unwrap_or_default();
    let trimmed_new = new_name.trim().to_uppercase();
    if trimmed_new.is_empty() {
        return Ok(CommandResult { success: false, message: "New name cannot be empty".into() });
    }
    let pos = names.iter().position(|n| n.to_uppercase() == old_name.to_uppercase());
    match pos {
        None => Ok(CommandResult { success: false, message: format!("'{}' not found", old_name) }),
        Some(idx) => {
            if names.iter().enumerate().any(|(i, n)| i != idx && n.to_uppercase() == trimmed_new) {
                return Ok(CommandResult {
                    success: false,
                    message: format!("'{}' already exists", trimmed_new),
                });
            }
            names[idx] = trimmed_new.clone();
            let content = names.join("\n");
            fs::write(&path, content)
                .map_err(|e| format!("Failed to write players file: {}", e))?;
            if let Ok(mut m) = state.matcher.lock() {
                m.update_players(names);
            }
            Ok(CommandResult {
                success: true,
                message: format!("Renamed '{}' → '{}'", old_name, trimmed_new),
            })
        }
    }
}

// ── OCR Commands ─────────────────────────────────────────────────────

#[tauri::command]
async fn start_ocr(
    app: AppHandle,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("OCR already running".into());
    }

    let state_arc = state.inner().clone();

    let my_gen = state_arc.loop_generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut last) = state_arc.last_sent_camera.lock() {
        *last = None;
    }

    let app_ocr = app.clone();
    tokio::spawn(async move {
        run_ocr_loop(app_ocr, state_arc, my_gen).await;
    });

    Ok(CommandResult {
        success: true,
        message: "OCR capture started".into(),
    })
}

async fn run_ocr_loop(app: AppHandle, state: Arc<OcrState>, my_gen: u64) {
    let is_current = |s: &Arc<OcrState>| s.loop_generation.load(Ordering::SeqCst) == my_gen;

    let config: AppConfig = match load_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("log", LogEvent { level: "error".into(), message: format!("Failed to load config: {e}") });
            if is_current(&state) {
                state.running.store(false, Ordering::SeqCst);
                let _ = app.emit("ocr_stopped", ());
            }
            return;
        }
    };

    let capture_interval = config.capture.interval_seconds.max(0.1);
    let confidence_threshold = config.ocr.confidence_threshold as f32;
    let debounce = Duration::from_millis(config.vmix.debounce_ms);
    let clear_timeout = Duration::from_millis(config.vmix.clear_timeout_ms);
    let vmix = config.vmix.clone();
    let cam_map = config.player_camera_map.clone();

    let _ = app.emit("log", LogEvent { level: "info".into(), message: "OCR engine started (Rust native ONNX)".into() });

    // Local debounce state — no mutex needed, all in this async task
    let mut pending_name: Option<String> = None;
    let mut pending_since: Option<std::time::Instant> = None;
    let mut blank_since: Option<std::time::Instant> = None;

    let mut ticker = interval(Duration::from_secs_f64(capture_interval));

    while state.running.load(Ordering::SeqCst) && is_current(&state) {
        ticker.tick().await;

        let region = &config.input_source.window_region;
        let img_result = if config.input_source.source_type == "window" {
            let hwnd = config.input_source.window_hwnd as isize;
            if hwnd == 0 {
                capture::capture_screen_region(region.left, region.top, region.width.max(0) as u32, region.height.max(0) as u32)
            } else {
                capture::capture_window_region(hwnd, region.left, region.top, region.width.max(0) as u32, region.height.max(0) as u32)
            }
        } else {
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
                let _ = app.emit("log", LogEvent { level: "error".into(), message: format!("Capture failed: {e}") });
                continue;
            }
        };

        let preview_b64 = capture::image_to_base64_jpeg(&img).unwrap_or_default();
        let preprocessed = capture::preprocess_for_ocr(&img);
        let ocr_results = tokio::task::spawn_blocking(move || ocr::run_ocr(&preprocessed)).await;

        let results = match ocr_results {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                let _ = app.emit("log", LogEvent { level: "error".into(), message: format!("OCR failed: {e}") });
                send_preview(&app, &preview_b64, &[]);
                continue;
            }
            Err(e) => {
                let _ = app.emit("log", LogEvent { level: "error".into(), message: format!("OCR task panicked: {e}") });
                continue;
            }
        };

        let detections = {
            let matcher_guard = state.matcher.lock().unwrap();
            let mut dets = Vec::new();
            for result in &results {
                if result.confidence >= confidence_threshold {
                    let matched = matcher_guard.find_match(&result.text, result.confidence as f64);
                    dets.push(matched);
                }
            }
            dets
        };

        send_preview(&app, &preview_b64, &detections);

        // Find best matched name
        let best_name: Option<String> = detections
            .iter()
            .filter(|d| d.matched_name.is_some())
            .max_by(|a, b| a.match_score.partial_cmp(&b.match_score).unwrap_or(std::cmp::Ordering::Equal))
            .and_then(|d| d.matched_name.clone());

        let now = std::time::Instant::now();

        if let Some(ref name) = best_name {
            // Player detected — reset blank timer
            blank_since = None;

            if pending_name.as_deref() == Some(name.as_str()) {
                // Same name as pending — check if debounce window elapsed
                if let Some(since) = pending_since {
                    if now.duration_since(since) >= debounce {
                        // Stable — look up vMix camera input
                        let camera_input = cam_map.iter()
                            .find(|(k, _)| k.to_uppercase() == name.to_uppercase())
                            .map(|(_, v)| v.clone());

                        if let Some(ref cam) = camera_input {
                            let changed = {
                                let last = state.last_sent_camera.lock().unwrap();
                                last.as_deref() != Some(cam.as_str())
                            };
                            if changed {
                                let det = detections.iter().find(|d| d.matched_name.as_deref() == Some(name.as_str()));
                                let raw = det.map(|d| d.raw_text.as_str()).unwrap_or("—");
                                let conf = det.map(|d| d.confidence).unwrap_or(0.0);
                                let fuzz = det.map(|d| d.match_score).unwrap_or(0.0);
                                let _ = app.emit("log", LogEvent {
                                    level: "success".into(),
                                    message: format!("\"{}\" → {} (conf: {:.0}%, fuzz: {:.0}%)", raw, name, conf * 100.0, fuzz),
                                });

                                if !vmix.target_sources.is_empty() {
                                    let cam_clone = cam.clone();
                                    let vmix_clone = vmix.clone();
                                    let app_clone = app.clone();
                                    let results = call_vmix_set_layer(
                                        &vmix_clone.ip,
                                        vmix_clone.port,
                                        vmix_clone.layer,
                                        &vmix_clone.target_sources,
                                        Some(&cam_clone),
                                    ).await;
                                    let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
                                    if errors.is_empty() {
                                        let _ = app_clone.emit("log", LogEvent {
                                            level: "info".into(),
                                            message: format!("[vMix] → {} on {} source(s) — Layer {}", cam_clone, vmix_clone.target_sources.len(), vmix_clone.layer),
                                        });
                                        let _ = app_clone.emit("vmix_action", serde_json::json!({
                                            "player": name,
                                            "camera": cam_clone,
                                            "layer": vmix_clone.layer,
                                            "cleared": false
                                        }));
                                    } else {
                                        for e in &errors {
                                            let _ = app_clone.emit("log", LogEvent { level: "error".into(), message: format!("[vMix] {e}") });
                                        }
                                    }
                                } else {
                                    let _ = app.emit("log", LogEvent {
                                        level: "warning".into(),
                                        message: "[vMix] No target sources configured — add sources in Settings".into(),
                                    });
                                }

                                if let Ok(mut last) = state.last_sent_camera.lock() {
                                    *last = Some(cam.clone());
                                }
                            }
                        } else {
                            // Name matched but not in mapping table
                            let changed = state.last_sent_camera.lock()
                                .map(|l| l.is_some())
                                .unwrap_or(false);
                            if changed {
                                let _ = app.emit("log", LogEvent {
                                    level: "warning".into(),
                                    message: format!("[vMix] \"{}\" matched but has no camera mapping — configure in Mapping tab", name),
                                });
                            }
                        }
                        // Keep pending so we don't re-log on every tick
                    }
                }
            } else {
                // New name — start debounce window
                pending_name = Some(name.clone());
                pending_since = Some(now);
            }
        } else {
            // No match
            pending_name = None;
            pending_since = None;

            // Check clear-timeout
            let last_sent_is_some = state.last_sent_camera.lock()
                .map(|l| l.is_some())
                .unwrap_or(false);

            if last_sent_is_some {
                if blank_since.is_none() {
                    blank_since = Some(now);
                } else if now.duration_since(blank_since.unwrap()) >= clear_timeout {
                    // Clear the layer
                    if !vmix.target_sources.is_empty() {
                        let vmix_clone = vmix.clone();
                        let app_clone = app.clone();
                        let results = call_vmix_set_layer(
                            &vmix_clone.ip,
                            vmix_clone.port,
                            vmix_clone.layer,
                            &vmix_clone.target_sources,
                            None,
                        ).await;
                        let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
                        if errors.is_empty() {
                            let _ = app_clone.emit("log", LogEvent {
                                level: "info".into(),
                                message: format!("[vMix] Layer {} cleared (blank timeout)", vmix_clone.layer),
                            });
                            let _ = app_clone.emit("vmix_action", serde_json::json!({
                                "player": null,
                                "camera": null,
                                "layer": vmix_clone.layer,
                                "cleared": true
                            }));
                        } else {
                            for e in &errors {
                                let _ = app_clone.emit("log", LogEvent { level: "error".into(), message: format!("[vMix] {e}") });
                            }
                        }
                    }
                    if let Ok(mut last) = state.last_sent_camera.lock() {
                        *last = None;
                    }
                    blank_since = None;
                }
            }
        }
    }

    if is_current(&state) {
        let _ = app.emit("log", LogEvent { level: "warning".into(), message: "OCR capture stopped".into() });
    }
}

fn send_preview(app: &AppHandle, image_b64: &str, detections: &[matcher::MatchResult]) {
    let preview_json = serde_json::json!({
        "image": image_b64,
        "detections": detections
    });
    let _ = app.emit("log", LogEvent {
        level: "preview".into(),
        message: preview_json.to_string(),
    });
}

#[tauri::command]
fn is_ocr_running(state: tauri::State<'_, Arc<OcrState>>) -> bool {
    state.running.load(Ordering::SeqCst)
}

#[tauri::command]
async fn stop_ocr(
    app: AppHandle,
    state: tauri::State<'_, Arc<OcrState>>,
) -> Result<CommandResult, String> {
    if state.running.swap(false, Ordering::SeqCst) {
        let _ = app.emit("ocr_stopped", ());
        Ok(CommandResult { success: true, message: "OCR capture stopped".into() })
    } else {
        Ok(CommandResult { success: false, message: "No OCR process is running".into() })
    }
}

#[tauri::command]
fn check_backend(app: AppHandle) -> Result<CommandResult, String> {
    if ocr::is_initialized() {
        return Ok(CommandResult { success: true, message: "Rust native OCR (ONNX Runtime)".into() });
    }
    match find_models_dir(&app) {
        Some(dir) => {
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

// ── Region Selectors ─────────────────────────────────────────────────

#[tauri::command]
async fn open_window_region_selector(
    app: AppHandle,
    hwnd: i64,
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<CommandResult, String> {
    let _ = app.emit("log", LogEvent {
        level: "info".into(),
        message: format!("Capturing window (HWND {hwnd}) for region selection..."),
    });

    let img = capture::capture_window_region(hwnd as isize, 0, 0, 0, 0)
        .map_err(|e| format!("Failed to capture window: {e}"))?;
    let b64 = capture::image_to_base64_jpeg(&img)
        .map_err(|e| format!("Failed to encode image: {e}"))?;

    *rs_state.original_width.lock().unwrap() = img.width();
    *rs_state.original_height.lock().unwrap() = img.height();
    *rs_state.image_b64.lock().unwrap() = Some(b64);
    *rs_state.source_type.lock().unwrap() = "window".into();
    *rs_state.source_hwnd.lock().unwrap() = hwnd;

    open_region_selector_window(&app)?;
    Ok(CommandResult { success: true, message: "Region selector opened".into() })
}

#[tauri::command]
async fn open_camera_region_selector(
    app: AppHandle,
    _camera_index: u32,
    rs_state: tauri::State<'_, Arc<RegionSelectorState>>,
) -> Result<CommandResult, String> {
    let _ = app.emit("log", LogEvent {
        level: "info".into(),
        message: format!("Capturing frame from camera {} for region selection...", _camera_index),
    });

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
    Ok(CommandResult { success: true, message: "Region selector opened".into() })
}

fn open_region_selector_window(app: &AppHandle) -> Result<(), String> {
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
    Ok(serde_json::json!({ "image": image, "original_width": w, "original_height": h }))
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
    let mut config = load_config()?;
    let source_type = rs_state.source_type.lock().unwrap().clone();
    config.input_source.window_region = WindowRegion { left, top, width, height };
    save_config(config)?;

    let _ = app.emit("log", LogEvent {
        level: "success".into(),
        message: format!("Region saved: ({}, {}) {}x{} [{}]", left, top, width, height, source_type),
    });
    let _ = app.emit("region-saved", ());
    *rs_state.image_b64.lock().unwrap() = None;
    Ok(CommandResult {
        success: true,
        message: format!("Region saved: ({}, {}) {}x{}", left, top, width, height),
    })
}

// ── App Entry ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
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
                eprintln!("[WARN] ONNX models directory not found.");
                false
            };

            let players: Vec<String> = load_players().unwrap_or_default();
            let threshold = match load_config() {
                Ok(c) => c.ocr.fuzzy_match_threshold as f64,
                Err(_) => 70.0,
            };

            app.manage(Arc::new(OcrState {
                running: AtomicBool::new(false),
                loop_generation: AtomicU64::new(0),
                matcher: Mutex::new(matcher::FuzzyMatcher::new(players, threshold)),
                last_sent_camera: Mutex::new(None),
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
                println!("[INFO] Efinity FaceCam ready — OCR models not loaded");
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
            rename_player,
            start_ocr,
            stop_ocr,
            is_ocr_running,
            check_backend,
            test_vmix_connection,
            send_vmix_layer_clear,
            get_region_selector_image,
            save_selected_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
