// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Write crash info to a log file so users can report startup errors
    let result = std::panic::catch_unwind(|| {
        app_lib::run();
    });

    if let Err(e) = result {
        let msg = if let Some(s) = e.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = e.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };

        let log_path = std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .map(|p| p.join("crash.log"))
            .unwrap_or_else(|| std::path::PathBuf::from("crash.log"));

        let _ = std::fs::write(&log_path, format!(
            "FaceCam crashed at startup:\n{}\n\nTimestamp: {:?}\n",
            msg,
            std::time::SystemTime::now()
        ));

        // Also show a message box on Windows
        #[cfg(windows)]
        {
            use std::ffi::CString;
            let text = CString::new(format!(
                "FaceCam failed to start:\n\n{}\n\nA crash log has been saved to:\n{}",
                msg,
                log_path.display()
            )).unwrap_or_default();
            let title = CString::new("FaceCam - Startup Error").unwrap_or_default();
            unsafe {
                extern "system" {
                    fn MessageBoxA(hwnd: *mut std::ffi::c_void, text: *const i8, caption: *const i8, utype: u32) -> i32;
                }
                MessageBoxA(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10);
            }
        }
    }
}
