# Efinity FaceCam

A premium desktop application for real-time OCR-based player name detection in Free Fire esports. Built with Tauri + React + PaddleOCR.

## 🎯 Features

- **Real-time OCR Detection** — Captures a screen region and identifies player names using PaddleOCR
- **Interactive Region Selector** — Click and drag to select the capture area on any monitor
- **Player Name Management** — Add, remove, search, and bulk-import player names directly in the app
- **Fuzzy Matching** — Matches OCR text against known player names with intelligent fuzzy matching
- **Server Integration** — Sends detected names to your API server in real-time
- **Live Log Viewer** — Monitor all OCR activity with color-coded logs
- **Session Statistics** — Track scans, detections, and match rates
- **Settings Panel** — Configure OCR thresholds, capture interval, server URL, and more
- **Zero Dependencies for End Users** — Fully bundled as standalone executables

## 📁 Project Structure

```
FaceCam/
├── app/                          # Tauri + React frontend
│   ├── src/                      # React source code
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Main OCR control panel
│   │   │   ├── PlayerNames.tsx   # Player name management
│   │   │   └── Settings.tsx      # Configuration settings
│   │   ├── components/
│   │   │   └── LogViewer.tsx     # Live log component
│   │   ├── App.tsx               # Main app shell with navigation
│   │   ├── index.css             # Design system & global styles
│   │   └── main.tsx              # React entry point
│   └── src-tauri/                # Rust backend
│       ├── src/lib.rs            # Tauri commands (config, players, OCR)
│       └── tauri.conf.json       # App configuration
├── config.json                   # OCR & server configuration
├── Players Name.txt              # Known player names (one per line)
├── main.py                       # Original Python OCR app (dev)
├── ocr_engine.py                 # PaddleOCR engine with fuzzy matching
├── region_selector.py            # Interactive region picker
├── server_sender.py              # HTTP client for server integration
├── facecam_backend.py            # Backend entry point for PyInstaller
├── build_backend.py              # Script to bundle Python → .exe
└── requirements.txt              # Python dependencies (dev only)
```

## 🚀 Development Setup

### Prerequisites (Developer only)
- Node.js (v18+)
- Rust toolchain (via rustup)
- Python 3.10+ with PaddleOCR dependencies

### Install Dependencies
```bash
cd app
npm install
```

### Run in Development Mode
```bash
cd app
npx tauri dev
```

## 📦 Building for Distribution

### Step 1: Bundle the Python backend
```bash
cd FaceCam
pip install pyinstaller
python build_backend.py
```
This creates `dist/FaceCam_Backend.exe`.

### Step 2: Build the Tauri app
```bash
cd app
npx tauri build
```
This creates `Efinity FaceCam.exe` installer.

### Step 3: Distribute
End users need:
- `Efinity FaceCam.exe` (the main app)
- `FaceCam_Backend.exe` (OCR engine — place next to the main exe)
- `config.json` (auto-created on first run)
- `Players Name.txt` (player names — can be managed via the app)

## 🎮 For End Users

1. Download and extract the application
2. Run `Efinity FaceCam.exe`
3. Go to **Players** tab and add your player names
4. Go to **Dashboard** and click **Select Region** to choose the screen area to capture
5. Click **Start Capture** to begin OCR detection
6. View real-time results in the Live Log

**No Python, Node.js, or any other software needs to be installed!**

---

*Developed by themisuwu • Powered by PaddleOCR v3*
