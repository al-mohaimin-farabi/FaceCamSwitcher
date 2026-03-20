# Efinity FaceCam

Real-time OCR-based player name detection for Free Fire esports streams. Captures frames from a window or virtual camera, detects and recognizes text using ONNX models (PaddleOCR), and fuzzy-matches names against a player list.

Built with **Tauri v2** (Rust backend + React frontend).

---

## Architecture

```
FaceCam/
├── app/                          # Tauri + React application
│   ├── src/                      # React frontend (TypeScript)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Main control panel (capture, region, OCR)
│   │   │   ├── PlayerNames.tsx   # Player name management
│   │   │   └── Settings.tsx      # Configuration UI
│   │   ├── components/
│   │   │   └── LogViewer.tsx     # Live log viewer
│   │   ├── store/
│   │   │   ├── store.ts          # Redux store
│   │   │   └── appSlice.ts      # App state (config, logs, stats, preview)
│   │   ├── App.tsx               # Root component with routing
│   │   └── main.tsx              # React entry point
│   │
│   ├── src-tauri/                # Rust backend
│   │   ├── src/
│   │   │   ├── main.rs           # Entry point with crash handler
│   │   │   ├── lib.rs            # Tauri commands, state management, app setup
│   │   │   ├── capture.rs        # Screen/window/camera frame capture
│   │   │   ├── ocr.rs            # ONNX model loading & inference pipeline
│   │   │   └── matcher.rs        # Fuzzy string matching with OCR error correction
│   │   ├── models/               # ONNX model files (not in git — too large)
│   │   │   ├── det.onnx          # PaddleOCR text detection (~88 MB)
│   │   │   ├── rec.onnx          # PaddleOCR text recognition (~7.8 MB)
│   │   │   └── en_dict.txt       # Character dictionary
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   │
│   ├── post_build.js             # Copies exe, DLLs, and models to project root
│   ├── clean_builds.js           # Kills running processes, cleans old bundles
│   └── package.json
│
├── config.json                   # Runtime configuration
├── Players Name.txt              # Player names for fuzzy matching
├── models/                       # ONNX models (copied here by post_build.js)
├── FaceCam.exe                   # Built application (not in git)
└── DirectML.dll                  # ONNX Runtime GPU library (not in git)
```

---

## Prerequisites

- **Node.js** >= 18
- **Rust** stable toolchain — install via [rustup.rs](https://rustup.rs)
- **NSIS** — for building the Windows installer (`winget install NSIS.NSIS`)
- **ONNX Models** — place `det.onnx`, `rec.onnx`, and `en_dict.txt` in `app/src-tauri/models/`

Tauri CLI is included as a dev dependency — no global install needed.

---

## Setup

```bash
cd app
npm install
```

Then place the ONNX model files in `app/src-tauri/models/`:

| File | Size | Description |
|------|------|-------------|
| `det.onnx` | ~88 MB | PaddleOCR DBNet text detection model |
| `rec.onnx` | ~7.8 MB | PaddleOCR CRNN text recognition model |
| `en_dict.txt` | ~1.4 KB | Character dictionary for decoding |

---

## Development

```bash
cd app
npm run tauri dev
```

This starts:
1. **Vite dev server** on `http://localhost:5173` with hot reload
2. **Tauri window** pointing to the dev server
3. **Rust backend** compiled in debug mode

Frontend changes hot-reload instantly. Rust changes trigger a recompile (~10-20s).

---

## Building for Release

```bash
cd app
npm run tauri build
```

### Build pipeline

1. **`clean_builds.js`** — kills any running FaceCam processes, removes old bundle artifacts
2. **`npm run build`** — compiles TypeScript and bundles React via Vite into `dist/`
3. **`cargo build --release`** — compiles the Rust backend (OCR, capture, matcher)
4. **`post_build.js`** — copies `efinity-facecam.exe`, `DirectML.dll`, and `models/` to the project root
5. **NSIS** — produces the installer at `app/src-tauri/target/release/bundle/nsis/FaceCam_0.1.0_x64-setup.exe`

### Build outputs

| File | Location | Purpose |
|------|----------|---------|
| Standalone exe | `FaceCam.exe` (project root) | Run directly for development |
| DirectML library | `DirectML.dll` (project root) | Required by ONNX Runtime |
| NSIS installer | `app/src-tauri/target/release/bundle/nsis/FaceCam_0.1.0_x64-setup.exe` | Distribute to users |

> **Important:** Always use `npm run tauri build` — not `cargo build --release` alone. The frontend must be bundled into the Tauri binary.

---

## Tech Stack

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19 | UI framework |
| Redux Toolkit | 2.11 | State management |
| React Router | 7 | Page routing |
| Tailwind CSS | 4 | Utility-first styling |
| Radix UI | 1.4 | Headless UI primitives |
| Lucide React | 0.577 | Icon library |
| Vite | 7 | Build tool & dev server |

### Backend (Rust)

| Crate | Version | Purpose |
|-------|---------|---------|
| tauri | 2 | Desktop app framework + IPC |
| ort | 2.0.0-rc.12 | ONNX Runtime (statically linked + DirectML GPU) |
| image | 0.25 | Image processing & format conversion |
| xcap | 0.0.14 | Screen and window capture |
| nokhwa | 0.10 | Camera capture (Media Foundation backend) |
| windows | 0.58 | Win32 API: DirectShow, COM, Media Foundation |
| ndarray | 0.17 | N-dimensional arrays for tensor operations |
| strsim | 0.11 | Fuzzy string matching (Levenshtein distance) |
| base64 | 0.22 | Image encoding for frontend preview |

---

## How It Works

### OCR Pipeline

```
Frame Capture → Region Crop → Detection (det.onnx) → Recognition (rec.onnx) → Fuzzy Match → Results
```

1. **Capture** — grabs a frame from the selected window (via HWND + xcap) or camera (via DirectShow/MF)
2. **Crop** — extracts the user-defined region
3. **Detection** — runs DBNet (`det.onnx`) to find text bounding boxes in the image
4. **Recognition** — runs CRNN (`rec.onnx`) on each detected text region
5. **Matching** — fuzzy-matches recognized text against the player name list using normalized Levenshtein distance with OCR error correction
6. **Output** — emits results to the frontend via Tauri events

### Camera Capture (`capture.rs`)

Supports physical webcams and virtual cameras (OBS, vMix). Uses a 4-level fallback strategy:

1. **MF name-matched** — gets the device name from DirectShow, finds the matching Media Foundation device by name
2. **MF direct** — tries Media Foundation with the same device index
3. **Pure DirectShow** — for devices only visible to DirectShow (virtual cameras). Runs in a dedicated STA thread with a COM message pump. Handles NV12, I420, YV12, BGR24, and BGRA32 pixel formats with YUV→RGB conversion
4. **nokhwa** — last resort fallback via the nokhwa crate

> Virtual cameras (OBS, vMix) typically only expose DirectShow interfaces, not Media Foundation. The DirectShow path is essential for these devices.

### Fuzzy Matching (`matcher.rs`)

- Normalized Levenshtein distance scored 0–100
- OCR character confusion groups: `(0/O/o)`, `(1/l/I/i)`, `(5/S/s)`, `(8/B)`, `(2/Z/z)`, `(6/G)`
- Multi-stage: direct match → corrected match → accept/reject based on configurable threshold

---

## Tauri Commands (Frontend ↔ Backend IPC)

### Config & State

| Command | Returns | Description |
|---------|---------|-------------|
| `load_config()` | `AppConfig` | Load config.json |
| `save_config(config)` | — | Save config.json |
| `check_backend()` | `CommandResult` | Check if ONNX models are loaded |

### Device Enumeration

| Command | Returns | Description |
|---------|---------|-------------|
| `list_windows()` | `Vec<WindowInfo>` | All visible windows (HWND + title) |
| `list_cameras()` | `Vec<CameraInfo>` | All cameras (DirectShow primary, MF + nokhwa fallback) |

### Player Names

| Command | Returns | Description |
|---------|---------|-------------|
| `load_players()` | `Vec<String>` | Load from `Players Name.txt` |
| `save_players(names)` | — | Save to file |
| `add_player(name)` | — | Add a single name |
| `remove_player(name)` | — | Remove a name |

### OCR Control

| Command | Returns | Description |
|---------|---------|-------------|
| `start_ocr()` | — | Start the capture/OCR loop (runs in tokio task) |
| `stop_ocr()` | — | Stop the loop |

### Region Selection

| Command | Returns | Description |
|---------|---------|-------------|
| `open_window_region_selector(hwnd)` | — | Open selector with window screenshot |
| `open_camera_region_selector(cameraIndex)` | — | Open selector with camera frame |
| `get_region_selector_image()` | `String` (base64) | Get captured image for the selector UI |
| `save_selected_region(left, top, width, height)` | — | Save selected region to config |

### Events (Backend → Frontend)

| Event | Payload | Description |
|-------|---------|-------------|
| `log` | `{ level, message }` | Log messages (info, warn, error, success) |
| `preview` | `{ image, detections }` | OCR results with base64 image |
| `ocr_stopped` | — | OCR loop has stopped |
| `region-saved` | — | Region selection confirmed (triggers config reload) |

---

## Configuration

`config.json` in the project root (auto-created on first run):

```jsonc
{
  "input_source": {
    "type": "window",              // "window" or "camera"
    "window_hwnd": 0,              // Target window handle
    "window_title": "",            // For display only
    "window_region": {             // OCR crop region (set via region selector)
      "left": 0, "top": 0,
      "width": 0, "height": 0
    },
    "camera_index": 0              // DirectShow device index
  },
  "server": {
    "enabled": false,              // Send results to an external API
    "url": "http://localhost:3000/api/facecam",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer YOUR_API_KEY_HERE"
    },
    "timeout": 5,
    "retry_count": 3,
    "retry_delay": 0.5
  },
  "ocr": {
    "language": "en",
    "confidence_threshold": 0.6,   // Min OCR confidence (0.0–1.0)
    "fuzzy_match_threshold": 70,   // Min match score (0–100)
    "use_gpu": false
  },
  "capture": {
    "interval_seconds": 0.1        // Capture frequency in seconds
  }
}
```

---

## Distributing to Users

### Via NSIS Installer (recommended)

1. Run `cd app && npm run tauri build`
2. Share `app/src-tauri/target/release/bundle/nsis/FaceCam_0.1.0_x64-setup.exe`
3. The installer bundles everything: exe, DirectML.dll, ONNX models, and auto-installs WebView2

### Standalone (without installer)

Ship these files together in one folder:

```
FaceCam/
├── FaceCam.exe
├── DirectML.dll          # Must be next to the exe
├── models/
│   ├── det.onnx
│   ├── rec.onnx
│   └── en_dict.txt
└── Players Name.txt
```

### User Requirements

- Windows 10/11 (x64)
- WebView2 Runtime (bundled with Windows 11; installer handles Windows 10)

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| App opens and immediately closes | Missing `DirectML.dll` or models | Ensure `DirectML.dll` is next to the exe and `models/` folder exists with all 3 files |
| "ONNX models not found" | Models not in expected location | Place `det.onnx`, `rec.onnx`, `en_dict.txt` in `models/` next to the exe |
| "localhost refused to connect" | Frontend not bundled | Use `npm run tauri build`, not `cargo build --release` alone |
| Virtual cameras not listed | MF doesn't see DirectShow-only devices | Already handled — DirectShow enumeration is the primary method |
| Gray camera preview | Camera outputs NV12/I420 format | Already handled — YUV→RGB conversion in `capture.rs` |
| `crash.log` appears | Startup panic | Read `crash.log` next to the exe for the error message |
| App flashes on other PCs | Test binary was built instead of main app | Ensure `src/bin/` directory does not exist (no extra binary targets) |

---

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build frontend (TypeScript + Vite) |
| `npm run tauri dev` | Development mode (frontend + Tauri window) |
| `npm run tauri build` | Full release build + NSIS installer |
| `npm run lint` | Run ESLint |

---

## Adding a New Tauri Command

1. Define the function in `app/src-tauri/src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<String, String> {
       Ok(format!("Hello {arg}"))
   }
   ```

2. Register it in the `invoke_handler` array in `lib.rs` → `run()`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       // ... existing commands
       my_command,
   ])
   ```

3. Call from the frontend:
   ```typescript
   import { invoke } from "@tauri-apps/api/core";
   const result = await invoke<string>("my_command", { arg: "world" });
   ```

---

## Key Design Decisions

- **ONNX Runtime (ort) is statically linked** — no separate ONNX DLL needed. Only `DirectML.dll` is required at runtime for GPU support.
- **DirectShow for camera enumeration** — Media Foundation misses many virtual cameras (OBS, vMix, NVIDIA Broadcast). DirectShow sees all devices.
- **STA thread + message pump for DirectShow capture** — DirectShow filter graphs require a single-threaded apartment with Windows message pumping. This runs in a dedicated `std::thread::spawn`.
- **Crash handler in `main.rs`** — catches panics at startup, writes `crash.log`, and shows a Windows MessageBox so users can report issues.
- **Region selector is a separate Tauri WebviewWindow** — captures a frame, sends it as base64 to an HTML overlay, lets the user draw a rectangle, then saves coordinates back to config.
