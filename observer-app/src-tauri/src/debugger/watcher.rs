//! Folder watcher + incremental reader (spec §3.3, §6).
//!
//! Each watch runs on its own OS thread. It uses the `notify` crate for change
//! events but also polls on a short timeout so it stays correct even when an
//! event is missed, the file is momentarily locked by the game client, or a new
//! file is rotated in. Reading is incremental: we remember the byte offset of
//! the latest file and only read what was appended.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};

use super::detector;
use super::parser::{ObserverParser, ParseOutcome};
use super::state::{CurrentObserverState, ObserverStatus, ObserverUpdate};

/// Callback used to surface updates (decoupled from Tauri for testability).
pub type EmitFn = Arc<dyn Fn(ObserverUpdate) + Send + Sync + 'static>;

struct WatchHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl WatchHandle {
    fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Manages all active local folder watches, keyed by observer id.
#[derive(Default)]
pub struct WatchManager {
    watches: Mutex<HashMap<String, WatchHandle>>,
}

impl WatchManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start (or restart) watching `folder` for `observer_id`. Any existing
    /// watch for the same id is stopped first.
    pub fn start(&self, observer_id: String, folder: PathBuf, emit: EmitFn) {
        self.stop(&observer_id);

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let id = observer_id.clone();

        let join = std::thread::spawn(move || {
            watch_loop(id, folder, emit, stop_thread);
        });

        let mut map = self.watches.lock().unwrap();
        map.insert(
            observer_id,
            WatchHandle {
                stop,
                join: Some(join),
            },
        );
    }

    /// Stop watching for a single observer id.
    pub fn stop(&self, observer_id: &str) {
        let mut map = self.watches.lock().unwrap();
        if let Some(mut handle) = map.remove(observer_id) {
            handle.stop();
        }
    }

    /// Stop every active watch (used on shutdown).
    pub fn stop_all(&self) {
        let mut map = self.watches.lock().unwrap();
        for (_, mut handle) in map.drain() {
            handle.stop();
        }
    }

}

/// Internal per-thread watch state.
struct WatchState {
    parser: ObserverParser,
    current_file: Option<PathBuf>,
    offset: u64,
    /// Bytes read but not yet terminated by a newline (incomplete write).
    leftover: String,
    last_status: Option<ObserverStatus>,
}

impl WatchState {
    fn new() -> Self {
        Self {
            parser: ObserverParser::new(""),
            current_file: None,
            offset: 0,
            leftover: String::new(),
            last_status: None,
        }
    }
}

fn watch_loop(observer_id: String, folder: PathBuf, emit: EmitFn, stop: Arc<AtomicBool>) {
    let (tx, rx) = mpsc::channel::<()>();

    // notify watcher — pings the channel on any filesystem change.
    let mut fs_watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    }) {
        Ok(w) => Some(w),
        Err(_) => None, // fall back to pure polling
    };

    if let Some(w) = fs_watcher.as_mut() {
        // NonRecursive: the debugger folder is flat.
        let _ = w.watch(&folder, RecursiveMode::NonRecursive);
    }

    let mut state = WatchState::new();

    // How often to re-scan the directory for a newer/rotated file. New files are
    // rare (minutes apart), and re-scanning does the expensive readdir+stat, so
    // we throttle it. Appends to the *current* file are handled instantly on
    // every notify event via the hot path below — independent of this interval.
    const RESCAN_INTERVAL: Duration = Duration::from_millis(1000);
    // Fallback wake-up in case a notify event is missed.
    const FALLBACK_POLL: Duration = Duration::from_millis(500);

    emit_status_if_changed(&observer_id, &emit, &mut state, ObserverStatus::Watching, "Watching folder");

    // Initial directory scan to latch onto the latest file.
    rescan_latest(&observer_id, &folder, &emit, &mut state);
    let mut last_scan = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        // Wake immediately on any filesystem event, or after the fallback poll.
        let _ = rx.recv_timeout(FALLBACK_POLL);
        if stop.load(Ordering::SeqCst) {
            break;
        }

        // Hot path: read newly-appended bytes from the current file right away.
        // This is what makes observer switches appear with near-zero latency.
        if state.current_file.is_some() {
            read_current(&observer_id, &emit, &mut state);
        }

        // Throttled: look for a newer/renamed file (rotation / reshost). Forced
        // when we have no file yet so we latch on as soon as one appears.
        if state.current_file.is_none() || last_scan.elapsed() >= RESCAN_INTERVAL {
            rescan_latest(&observer_id, &folder, &emit, &mut state);
            last_scan = Instant::now();
        }
    }
}

/// Re-scan the folder for the latest debugger file, switching to it if it is
/// new/rotated (any filename — selection is by modified time). Then reads.
fn rescan_latest(observer_id: &str, folder: &Path, emit: &EmitFn, state: &mut WatchState) {
    let validation = detector::validate(folder);
    if !validation.valid {
        emit_status_if_changed(
            observer_id,
            emit,
            state,
            ObserverStatus::Error,
            "Debugger folder not found or not readable",
        );
        return;
    }

    let latest = match detector::latest_file(folder) {
        Some(p) => p,
        None => {
            emit_status_if_changed(
                observer_id,
                emit,
                state,
                ObserverStatus::Waiting,
                "Waiting for debugger file",
            );
            return;
        }
    };

    if state.current_file.as_deref() != Some(latest.as_path()) {
        let name = latest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        state.parser.set_source_file(name.clone());
        state.current_file = Some(latest);
        state.offset = 0;
        state.leftover.clear();
        emit_status_if_changed(
            observer_id,
            emit,
            state,
            ObserverStatus::Connected,
            &format!("Latest file detected: {}", name),
        );
    }

    read_current(observer_id, emit, state);
}

/// Read bytes appended to the current file since the last read and parse them.
/// Cheap (a single open/seek/read) — safe to call on every notify event.
fn read_current(observer_id: &str, emit: &EmitFn, state: &mut WatchState) {
    let path = match &state.current_file {
        Some(p) => p.clone(),
        None => return,
    };

    match read_new_lines(&path, &mut state.offset, &mut state.leftover) {
        Ok(lines) => {
            let mut switched = false;
            for line in lines {
                if state.parser.process_line(&line) == ParseOutcome::ObserverSwitched {
                    switched = true;
                }
            }
            if switched {
                emit_state(observer_id, emit, state, ObserverStatus::Connected, None);
            }
        }
        Err(msg) => {
            // Locked/permission/transient — keep the UI alive and retry next tick.
            emit_status_if_changed(observer_id, emit, state, ObserverStatus::Error, &msg);
        }
    }
}

/// Read bytes appended since `offset`, returning complete lines. Updates
/// `offset` and stashes any trailing partial line in `leftover`.
fn read_new_lines(
    path: &Path,
    offset: &mut u64,
    leftover: &mut String,
) -> Result<Vec<String>, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open debugger file (locked or removed): {e}"))?;

    let len = file
        .metadata()
        .map_err(|e| format!("Cannot read file metadata: {e}"))?
        .len();

    // File was truncated/rotated in place — restart from the beginning.
    if len < *offset {
        *offset = 0;
        leftover.clear();
    }

    if len == *offset {
        return Ok(Vec::new());
    }

    file.seek(SeekFrom::Start(*offset))
        .map_err(|e| format!("Seek failed: {e}"))?;

    let mut buf = Vec::new();
    let read = file
        .take(len - *offset)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Read failed: {e}"))?;
    *offset += read as u64;

    // Lossy decode is fine — debugger lines are ASCII-ish and we never crash.
    let chunk = String::from_utf8_lossy(&buf);
    let mut combined = std::mem::take(leftover);
    combined.push_str(&chunk);

    let mut lines: Vec<String> = Vec::new();
    let ends_with_newline = combined.ends_with('\n');
    let mut parts: Vec<&str> = combined.split('\n').collect();

    if !ends_with_newline {
        // Last element is an incomplete line — keep it for next time.
        *leftover = parts.pop().unwrap_or("").to_string();
    } else {
        // Trailing empty string from the final newline.
        parts.pop();
    }

    for p in parts {
        let line = p.trim_end_matches('\r');
        if !line.is_empty() {
            lines.push(line.to_string());
        }
    }

    Ok(lines)
}

fn emit_state(
    observer_id: &str,
    emit: &EmitFn,
    state: &mut WatchState,
    status: ObserverStatus,
    message: Option<&str>,
) {
    state.last_status = Some(status);
    let current: Option<CurrentObserverState> = state.parser.current().cloned();
    emit(ObserverUpdate::new(
        observer_id,
        status,
        current,
        message.map(|m| m.to_string()),
    ));
}

fn emit_status_if_changed(
    observer_id: &str,
    emit: &EmitFn,
    state: &mut WatchState,
    status: ObserverStatus,
    message: &str,
) {
    if state.last_status == Some(status) {
        return;
    }
    emit_state(observer_id, emit, state, status, Some(message));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use std::time::Instant;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("facecam_watch_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Collect updates emitted by a watch until a predicate is satisfied or we
    /// time out.
    fn wait_for<F: Fn(&[ObserverUpdate]) -> bool>(
        sink: &Arc<StdMutex<Vec<ObserverUpdate>>>,
        pred: F,
        timeout: Duration,
    ) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if pred(&sink.lock().unwrap()) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn watcher_switches_to_newer_file_and_parses() {
        let dir = temp_dir("switch");
        let sink: Arc<StdMutex<Vec<ObserverUpdate>>> = Arc::new(StdMutex::new(Vec::new()));
        let sink2 = sink.clone();
        let emit: EmitFn = Arc::new(move |u| sink2.lock().unwrap().push(u));

        let mgr = WatchManager::new();
        mgr.start("obs-1".into(), dir.clone(), emit);

        // First file with a resolvable switch.
        std::fs::write(
            dir.join("debugger_a.log"),
            "[InitTrackingPlayer] 16777217 -> noth3llfire\n@UIHud OnSwitchObserver 16777217\n",
        )
        .unwrap();

        let ok = wait_for(
            &sink,
            |ups| {
                ups.iter().any(|u| {
                    u.current_observer
                        .as_ref()
                        .and_then(|c| c.name.as_deref())
                        == Some("noth3llfire")
                })
            },
            Duration::from_secs(4),
        );
        assert!(ok, "expected observer resolved from first file");

        // A newer file appears with a different player.
        std::thread::sleep(Duration::from_millis(50));
        std::fs::write(
            dir.join("debugger_b.log"),
            "[InitTrackingPlayer] 16777218 -> themisuwu\n@UIHud OnSwitchObserver 16777218\n",
        )
        .unwrap();

        let ok2 = wait_for(
            &sink,
            |ups| {
                ups.iter().any(|u| {
                    u.current_observer
                        .as_ref()
                        .and_then(|c| c.name.as_deref())
                        == Some("themisuwu")
                })
            },
            Duration::from_secs(5),
        );
        assert!(ok2, "expected switch to newer file");

        mgr.stop_all();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
