use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, State};

// ── State ────────────────────────────────────────────────────────────
struct AppState {
    ocr_pid: Mutex<Option<u32>>,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    level: String,   // "info", "success", "warning", "error"
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
    source_type: String,    // "window" | "camera"
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
    WindowRegion { left: 0, top: 0, width: 530, height: 193 }
}

#[derive(Serialize, Deserialize, Clone)]
struct WindowInfo {
    hwnd: i64,
    title: String,
}


#[derive(Serialize, Deserialize, Clone)]
struct ServerConfig {
    url: String,
    method: String,
    headers: serde_json::Value,
    timeout: u32,
    retry_count: u32,
    retry_delay: f64,
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
    interval_seconds: u32,
    save_debug_screenshots: bool,
    debug_screenshot_dir: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    input_source: InputSource,
    server: ServerConfig,
    ocr: OcrConfig,
    capture: CaptureConfig,
}

// ── Helpers ──────────────────────────────────────────────────────────

const APP_DATA_SUBDIR: &str = "EfinityFaceCam";

/// Returns %APPDATA%\EfinityFaceCam — the writable user-data directory.
fn get_app_data_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join(APP_DATA_SUBDIR);
    }
    // Fallback: next to the exe
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Create default config.json and Players Name.txt if they don't exist.
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
    "url": "http://localhost:3000/api/player",
    "method": "POST",
    "headers": {},
    "timeout": 5,
    "retry_count": 3,
    "retry_delay": 1.0
  },
  "ocr": {
    "language": "en",
    "confidence_threshold": 0.6,
    "fuzzy_match_threshold": 80,
    "use_gpu": false
  },
  "capture": {
    "interval_seconds": 2,
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

/// Get the directory where config.json and Players Name.txt live.
/// Search order: dev repo root → AppData (production / first run)
fn get_facecam_dir() -> PathBuf {
    let mut search_dirs = Vec::new();

    // Dev: exe is inside app/src-tauri/target/debug — walk up to FaceCam/
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            search_dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd.clone());
        search_dirs.push(cwd.join("..").join(".."));
    }
    // Production: AppData
    search_dirs.push(get_app_data_dir());

    for dir in &search_dirs {
        if dir.join("config.json").exists() {
            return dir.to_path_buf();
        }
    }

    // No config found anywhere — bootstrap defaults in AppData
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

/// Returns (program, prefix_args) for the Python backend.
/// Also sets FACECAM_DATA_DIR so the backend knows where to find config/players.
fn get_backend_command() -> (String, Vec<String>) {
    // Production: FaceCam_Backend.exe is placed next to the main exe by Tauri's externalBin.
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let backend = parent.join("FaceCam_Backend.exe");
            if backend.exists() {
                return (backend.to_string_lossy().to_string(), vec![]);
            }
        }
    }

    // Dev fallback: use Python + facecam_backend.py
    let python = if Command::new("python")
        .arg("--version")
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        "python".to_string()
    } else {
        "python3".to_string()
    };

    // Search for facecam_backend.py independently of the data dir.
    // In dev, the Tauri exe is at app/src-tauri/target/debug/ so we walk up,
    // and cwd is typically app/ so cwd/.. = FaceCam/.
    let mut script_dirs: Vec<PathBuf> = vec![];
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(p) = exe_path.parent() {
            // debug/  ->  target/  ->  src-tauri/  ->  app/  ->  FaceCam/
            script_dirs.push(p.join("..").join("..").join("..").join(".."));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        script_dirs.push(cwd.join(".."));  // app/ -> FaceCam/
        script_dirs.push(cwd.clone());
    }

    let script = script_dirs
        .iter()
        .map(|d| d.join("facecam_backend.py"))
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "facecam_backend.py".to_string());

    (python, vec![script])
}

/// Returns the directory that contains facecam_backend.py (used as cwd when
/// spawning Python so that sibling imports like `ocr_engine` resolve correctly).
/// In production this is the same as the exe dir; in dev it's the FaceCam/ root.
fn get_script_dir() -> PathBuf {
    let (_, args) = get_backend_command();
    if let Some(script) = args.first() {
        if let Some(parent) = PathBuf::from(script).parent() {
            return parent.to_path_buf();
        }
    }
    // Production: exe dir (FaceCam_Backend.exe has no script arg)
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

// ── Config Commands ──────────────────────────────────────────────────

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = get_config_path();
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    Ok(config)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<CommandResult, String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(CommandResult {
        success: true,
        message: "Configuration saved".into(),
    })
}

#[tauri::command]
fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let data_dir = get_facecam_dir();
    let script_dir = get_script_dir();
    let (program, mut args) = get_backend_command();
    args.push("--list-windows".to_string());

    let output = Command::new(&program)
        .args(&args)
        .current_dir(&script_dir)
        .env("FACECAM_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .env("PYTHONIOENCODING", "utf-8")
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("cmd={} {:?} — {}", program, args, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // If the process failed entirely, surface the error
    if !output.status.success() && stdout.trim().is_empty() {
        return Err(format!("Backend exited {:?}\nstderr: {}", output.status.code(), stderr));
    }

    // Find the JSON array line (the last line that starts with '[')
    let json_line = stdout.lines()
        .filter(|l| l.trim_start().starts_with('['))
        .last()
        .unwrap_or("[]");

    serde_json::from_str::<Vec<WindowInfo>>(json_line)
        .map_err(|e| format!(
            "JSON parse failed: {}\ncmd: {} {:?}\nstdout: {}\nstderr: {}",
            e, program, args, stdout, stderr
        ))
}


// ── Player Name Commands ─────────────────────────────────────────────

#[tauri::command]
fn load_players() -> Result<Vec<String>, String> {
    let path = get_players_path();
    if !path.exists() {
        // Create the file if missing
        let _ = fs::write(&path, "");
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read players file: {}", e))?;
    let names: Vec<String> = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    Ok(names)
}

#[tauri::command]
fn save_players(players: Vec<String>) -> Result<CommandResult, String> {
    let path = get_players_path();
    let content = players.join("\n");
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write players file: {}", e))?;
    Ok(CommandResult {
        success: true,
        message: format!("Saved {} player name(s)", players.len()),
    })
}

#[tauri::command]
fn add_player(name: String) -> Result<CommandResult, String> {
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
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write players file: {}", e))?;
    
    Ok(CommandResult {
        success: true,
        message: format!("Added '{}'", trimmed),
    })
}

#[tauri::command]
fn remove_player(name: String) -> Result<CommandResult, String> {
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
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write players file: {}", e))?;
    
    Ok(CommandResult {
        success: true,
        message: format!("Removed '{}'", name),
    })
}

// ── Window Region Selector ───────────────────────────────────────────

#[tauri::command]
async fn open_window_region_selector(app: tauri::AppHandle, hwnd: i64) -> Result<CommandResult, String> {
    let data_dir = get_facecam_dir();
    let script_dir = get_script_dir();
    let (program, mut args) = get_backend_command();
    args.push("--region-select".to_string());
    if hwnd != 0 {
        args.push("--hwnd".to_string());
        args.push(hwnd.to_string());
    }

    let _ = app.emit("log", LogEvent {
        level: "info".into(),
        message: "Opening region selector...".into(),
    });

    let output = Command::new(&program)
        .args(&args)
        .current_dir(&script_dir)
        .env("FACECAM_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .env("PYTHONIOENCODING", "utf-8")
        .creation_flags(0x00000000)  // Allow window for region selector
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                let _ = app.emit("log", LogEvent {
                    level: "success".into(),
                    message: "Region selection complete!".into(),
                });
                Ok(CommandResult { success: true, message: "Region saved".into() })
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                Ok(CommandResult { success: false, message: format!("Selector failed: {}", stderr) })
            }
        }
        Err(e) => Err(format!("Failed to start region selector: {}", e)),
    }
}

// ── OCR Capture Commands ─────────────────────────────────────────────

#[tauri::command]
async fn start_ocr(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let data_dir = get_facecam_dir();
    let script_dir = get_script_dir();
    let (program, prefix_args) = get_backend_command();

    let _ = app.emit("log", LogEvent {
        level: "info".into(),
        message: "Starting OCR capture...".into(),
    });

    let child = Command::new(&program)
        .args(&prefix_args)
        .current_dir(&script_dir)
        .env("FACECAM_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn();

    match child {
        Ok(mut process) => {
            {
                let mut pid = state.ocr_pid.lock().unwrap();
                *pid = Some(process.id());
            }

            if let Some(stdout) = process.stdout.take() {
                let app_handle = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let (level, msg) = parse_log_line(&line);
                            let _ = app_handle.emit("log", LogEvent { level, message: msg });
                        }
                    }
                });
            }

            if let Some(stderr) = process.stderr.take() {
                let app_handle = app.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let _ = app_handle.emit("log", LogEvent {
                                level: "error".into(),
                                message: line,
                            });
                        }
                    }
                });
            }

            // Wait in background thread
            let app_handle = app.clone();
            std::thread::spawn(move || {
                match process.wait() {
                    Ok(status) => {
                        if status.success() {
                            let _ = app_handle.emit("log", LogEvent {
                                level: "success".into(),
                                message: "OCR process completed".into(),
                            });
                        }
                        let _ = app_handle.emit("ocr_stopped", ());
                    }
                    Err(e) => {
                        let _ = app_handle.emit("log", LogEvent {
                            level: "error".into(),
                            message: format!("OCR process error: {}", e),
                        });
                        let _ = app_handle.emit("ocr_stopped", ());
                    }
                }
            });

            Ok(CommandResult {
                success: true,
                message: "OCR capture started".into(),
            })
        }
        Err(e) => {
            let _ = app.emit("log", LogEvent {
                level: "error".into(),
                message: format!("Failed to start OCR: {}", e),
            });
            Err(format!("Failed to start OCR process: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_ocr(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let pid = {
        let mut pid_lock = state.ocr_pid.lock().unwrap();
        pid_lock.take()
    };

    if let Some(pid) = pid {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .output();

        let _ = app.emit("log", LogEvent {
            level: "warning".into(),
            message: "OCR capture stopped by user".into(),
        });

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
fn check_backend() -> Result<CommandResult, String> {
    let (program, prefix_args) = get_backend_command();

    if prefix_args.is_empty() {
        return Ok(CommandResult {
            success: true,
            message: format!("Backend: {} (bundled)", program),
        });
    }

    match Command::new(&program)
        .arg("--version")
        .creation_flags(0x08000000)
        .output()
    {
        Ok(output) => {
            let version = String::from_utf8_lossy(&output.stdout).to_string();
            Ok(CommandResult {
                success: true,
                message: format!("{} (dev mode)", version.trim()),
            })
        }
        Err(_) => Ok(CommandResult {
            success: false,
            message: "Python not found and no bundled backend available".into(),
        }),
    }
}

// ── Log parser ───────────────────────────────────────────────────────
fn parse_log_line(line: &str) -> (String, String) {
    if line.starts_with("[SUCCESS]") {
        ("success".into(), line.replacen("[SUCCESS] ", "", 1))
    } else if line.starts_with("[ERROR]") {
        ("error".into(), line.replacen("[ERROR] ", "", 1))
    } else if line.starts_with("[WARNING]") || line.starts_with("[WARN]") {
        ("warning".into(), line.replacen("[WARNING] ", "", 1).replacen("[WARN] ", "", 1))
    } else if line.starts_with("[PREVIEW]") {
        ("preview".into(), line.replacen("[PREVIEW] ", "", 1))
    } else if line.starts_with("[STATUS]") || line.starts_with("[OCR]") || line.starts_with("[Server]") {
        ("info".into(), line.to_string())
    } else {
        ("info".into(), line.to_string())
    }
}

// ── App entry ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            ocr_pid: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_windows,
            open_window_region_selector,
            load_players,
            save_players,
            add_player,
            remove_player,
            start_ocr,
            stop_ocr,
            check_backend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
