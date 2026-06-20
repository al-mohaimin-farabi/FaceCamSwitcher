//! Debugger folder detection and latest-file resolution (spec §3.2, §3.3, §4).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The Free Fire data directory name and its debugger subfolder.
const DATA_DIR: &str = "Free Fire_64_Data";
const DEBUGGER_SUB: &str = "Debugger";

/// File extensions/names we treat as debugger log files.
const LOG_EXTENSIONS: &[&str] = &["log", "txt"];

/// Result of validating a candidate debugger folder.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderValidation {
    pub path: String,
    pub exists: bool,
    pub readable: bool,
    /// Whether the folder currently holds at least one debugger/log-like file.
    pub has_log_files: bool,
    /// Overall verdict — a folder is "valid" if it exists and is readable, even
    /// when empty (it can be watched for files the client creates later).
    pub valid: bool,
    pub file_count: usize,
}

/// Build the ordered list of candidate paths to probe for the Free Fire
/// debugger folder (spec §4). Order matters: most-likely first.
pub fn candidate_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    let mut push = |base: Option<PathBuf>| {
        if let Some(base) = base {
            out.push(base.join(DATA_DIR).join(DEBUGGER_SUB));
        }
    };

    push(dirs::home_dir());
    push(dirs::data_local_dir()); // %LOCALAPPDATA%
    push(dirs::data_dir()); // %APPDATA%
    push(dirs::desktop_dir());
    push(dirs::document_dir());

    // De-duplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out
}

/// Quick auto-detect from the well-known user-profile candidate list.
/// Used at startup so launch stays fast (no full-drive scan).
pub fn auto_detect() -> Option<PathBuf> {
    candidate_paths()
        .into_iter()
        .find(|p| validate(p).valid)
}

/// From a set of candidate debugger folders, pick the best one: prefer a
/// folder that already holds log files, otherwise the first valid one.
pub fn pick_best(paths: &[PathBuf]) -> Option<PathBuf> {
    paths
        .iter()
        .find(|p| validate(p).has_log_files)
        .cloned()
        .or_else(|| paths.iter().find(|p| validate(p).valid).cloned())
}

/// Roots to scan — every available drive on Windows, `/` elsewhere.
fn drive_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut v = Vec::new();
        for c in b'A'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", c as char));
            if root.is_dir() {
                v.push(root);
            }
        }
        v
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}

/// Directories that are large/system/irrelevant — skipped while scanning.
fn should_skip(name: &str) -> bool {
    if name.starts_with('$') {
        return true;
    }
    matches!(
        name.to_ascii_lowercase().as_str(),
        "windows"
            | "system volume information"
            | "recovery"
            | "perflogs"
            | "node_modules"
            | "windows.old"
            | ".git"
    )
}

/// Scan every drive for `…\Free Fire_64_Data\Debugger` folders, regardless of
/// which drive the game/emulator is installed on. Bounded by depth and a total
/// directory budget so it stays responsive even on large disks.
pub fn scan_drives() -> Vec<PathBuf> {
    const MAX_DEPTH: usize = 6;
    const MAX_TOTAL_DIRS: usize = 120_000;

    let mut out: Vec<PathBuf> = Vec::new();
    let mut budget = MAX_TOTAL_DIRS;

    for root in drive_roots() {
        let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
        queue.push_back((root, 0));

        while let Some((dir, depth)) = queue.pop_front() {
            if budget == 0 {
                break;
            }
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                if budget == 0 {
                    break;
                }
                // `file_type()` does not follow symlinks, avoiding loops.
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if !is_dir {
                    continue;
                }
                budget -= 1;
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if should_skip(&name) {
                    continue;
                }
                let path = entry.path();
                if name.eq_ignore_ascii_case(DATA_DIR) {
                    let dbg = path.join(DEBUGGER_SUB);
                    if dbg.is_dir() {
                        out.push(dbg);
                    }
                    // Don't descend further into the matched data dir.
                    continue;
                }
                if depth + 1 <= MAX_DEPTH {
                    queue.push_back((path, depth + 1));
                }
            }
        }
    }

    // De-duplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| seen.insert(p.clone()));
    out
}

/// Validate a folder path against the spec's criteria.
pub fn validate(path: &Path) -> FolderValidation {
    let exists = path.is_dir();
    let mut readable = false;
    let mut file_count = 0usize;
    let mut has_log_files = false;

    if exists {
        match std::fs::read_dir(path) {
            Ok(entries) => {
                readable = true;
                for entry in entries.flatten() {
                    if is_log_file(&entry.path()) {
                        file_count += 1;
                        has_log_files = true;
                    }
                }
            }
            Err(_) => readable = false,
        }
    }

    FolderValidation {
        path: path.to_string_lossy().to_string(),
        exists,
        readable,
        has_log_files,
        valid: exists && readable,
        file_count,
    }
}

/// Whether a path looks like a debugger/log file we should consider.
pub fn is_log_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => LOG_EXTENSIONS
            .iter()
            .any(|e| e.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

/// Find the most-recently-modified debugger file in a folder (spec §3.3).
pub fn latest_file(folder: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(folder).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_log_file(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &newest {
            Some((t, _)) if *t >= modified => {}
            _ => newest = Some((modified, path)),
        }
    }

    newest.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("facecam_test_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validate_missing_folder() {
        let v = validate(Path::new("Z:/definitely/not/here/xyz123"));
        assert!(!v.exists);
        assert!(!v.valid);
    }

    #[test]
    fn validate_empty_folder_is_valid() {
        let dir = temp_dir("empty");
        let v = validate(&dir);
        assert!(v.exists && v.readable && v.valid);
        assert!(!v.has_log_files);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn latest_file_picks_newest() {
        let dir = temp_dir("latest");
        let a = dir.join("debugger_a.log");
        let b = dir.join("debugger_b.log");
        fs::write(&a, "old").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        fs::write(&b, "new").unwrap();
        // Touch b again to guarantee it is newest.
        std::thread::sleep(Duration::from_millis(10));
        fs::write(&b, "newer").unwrap();

        let latest = latest_file(&dir).unwrap();
        assert_eq!(latest.file_name().unwrap().to_str().unwrap(), "debugger_b.log");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_non_log_files() {
        let dir = temp_dir("filter");
        fs::write(dir.join("notes.md"), "x").unwrap();
        fs::write(dir.join("image.png"), "x").unwrap();
        let v = validate(&dir);
        assert!(!v.has_log_files);
        assert!(latest_file(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
