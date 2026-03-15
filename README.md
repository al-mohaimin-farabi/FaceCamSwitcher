# FaceCam — Player Name OCR System

Real-time screen capture OCR that reads player names from a live game feed and sends them to your website server. Built for Free Fire esports production.

---

## 🖥️ Set Up Screen

- Install **OnTopReplica**. (**Download link:** *https://github.com/ItsAsif/OnTopReplica/releases*)
- Install **NDI Runtime 6**. (**Download link:** *http://ndi.link/NDIRedistV6*)
- Install **DistroAV** plugin for OBS Studio. (**Download link:** *https://github.com/DistroTV/DistroAV/releases*)
---
- Run **OBS Studio**
- Add **NDI Source** in OBS Studio.
- Now Go to **Open Preview Projecter** and select the monitor.
---
- Open **OnTopReplica** and select **Open Preview Projecter**.
- Select the region where the player names are displayed.
- Click **Start**

---

## 📋 Requirements

- **Python 3.10+** (tested on 3.12)
- **Windows 10/11**
- Supports **up to 4 monitors**

---

## 🚀 Setup (New PC)

### Step 1 — Install Python

Download and install Python from [python.org](https://www.python.org/downloads/).

> ⚠️ **IMPORTANT:** During installation, check ✅ **"Add Python to PATH"**.

Verify installation:
```
python --version
```

### Step 2 — Install Dependencies

Open a terminal in the `FaceCam` folder and run:

```
cd FaceCam
pip install -r requirements.txt
```

This installs:
| Package | Purpose |
|---------|---------|
| `paddlepaddle` | Deep learning framework (PaddleOCR backend) |
| `paddleocr` | OCR text recognition engine (v3.x) |
| `mss` | Multi-monitor screenshot capture |
| `Pillow` | Image preprocessing (upscale, sharpen, contrast) |
| `requests` | HTTP client for sending data to server |
| `thefuzz` | Fuzzy string matching for player names |
| `python-Levenshtein` | Fast C-based string distance (speeds up thefuzz) |

> 💡 First run will auto-download PaddleOCR model files (~100MB). This only happens once.

### Step 3 — Add Player Names

Edit `Players Name.txt` and add one player name per line:

```
PlayerOne
xXSlayerXx
ProGamer99
TeamAlpha_Lead
```

- Lines starting with `#` are comments (ignored)
- These names are used for fuzzy matching — the more accurate the list, the better the detection

### Step 4 — Configure Server (Optional)

Edit `config.json` → `"server"` section:

```json
{
    "server": {
        "url": "https://your-website.com/api/facecam",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_API_KEY_HERE"
        },
        "timeout": 2,
        "retry_count": 1,
        "retry_delay": 0.5
    }
}
```

Change `url` to your actual API endpoint. The server will receive JSON like:

```json
{
    "timestamp": "2026-03-07T05:30:00",
    "players": [
        {
            "raw_text": "P1ayerOne",
            "cleaned_text": "P1ayerOne",
            "confidence": 0.92,
            "matched_name": "PlayerOne",
            "match_score": 88
        }
    ]
}
```

### Step 5 — Run

```
python main.py
```

This opens the GUI application. From there:

1. Click **⊞ Select Region** → draw a rectangle around the player name area on your screen
2. Click **📸 Single Snap** to test if OCR is reading correctly
3. Click **▶ Start** to begin continuous capture

---

## 🖥️ GUI Controls

| Button | Action |
|--------|--------|
| **▶ Start / ⏹ Stop** | Start or stop continuous OCR capture |
| **⊞ Select Region** | Open full-screen overlay to pick capture area (works on any monitor) |
| **📸 Single Snap** | Run OCR once and show results |
| **↻ Reload Names** | Hot-reload `Players Name.txt` without restarting |

- **ESC** cancels the region selector
- **Ctrl+C** in terminal stops the app cleanly

---

## 📁 File Structure

```
FaceCam/
├── main.py              ← Run this (GUI application)
├── ocr_engine.py        ← PaddleOCR engine + fuzzy matching
├── region_selector.py   ← Screen region picker
├── server_sender.py     ← HTTP client for server
├── config.json          ← All settings (edit this)
├── Players Name.txt     ← Known player names (edit this)
├── requirements.txt     ← Python dependencies
└── README.md            ← This file
```

---

## ⚙️ Configuration Reference

All settings are in `config.json`:

### capture_region
Auto-saved when you use the region selector. No need to edit manually.

```json
{
    "monitor_index": 2,
    "left": 1436,
    "top": 835,
    "width": 227,
    "height": 24
}
```

### server
```json
{
    "url": "http://localhost:3000/api/facecam",
    "method": "POST",
    "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer YOUR_API_KEY_HERE"
    },
    "timeout": 2,
    "retry_count": 1,
    "retry_delay": 0.5
}
```

| Field | Description |
|-------|-------------|
| `url` | Your API endpoint URL |
| `method` | `POST`, `PUT`, or `PATCH` |
| `headers` | Custom headers (auth, content type, etc.) |
| `timeout` | Max seconds to wait for server response |
| `retry_count` | Number of retry attempts on failure |
| `retry_delay` | Seconds between retries |

### ocr
```json
{
    "language": "en",
    "confidence_threshold": 0.6,
    "fuzzy_match_threshold": 70,
    "use_gpu": false
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `language` | `"en"` | PaddleOCR language code |
| `confidence_threshold` | `0.6` | Min OCR confidence (0-1) to accept a text detection |
| `fuzzy_match_threshold` | `70` | Min fuzz score (0-100) to accept a name match |
| `use_gpu` | `false` | Set `true` if you have NVIDIA GPU with CUDA |

### capture
```json
{
    "save_debug_screenshots": false,
    "debug_screenshot_dir": "debug_captures"
}
```

| Field | Description |
|-------|-------------|
| `save_debug_screenshots` | Save raw + processed captures as PNG for debugging |
| `debug_screenshot_dir` | Folder name for debug screenshots |

---

## 🔧 Troubleshooting

### OCR not detecting text?
1. Run **📸 Single Snap** and check the preview — is the right area being captured?
2. Use **⊞ Select Region** to re-select a better area
3. Try making the selection area slightly larger (bigger text = better OCR)
4. Enable `save_debug_screenshots` in config.json to inspect what OCR sees

### Low fuzzy match scores?
1. Check `Players Name.txt` — make sure names are spelled exactly as they appear in-game
2. Lower `fuzzy_match_threshold` to `60` or `50` in config.json
3. Lower `confidence_threshold` to `0.4` to catch more text

### Server send failing?
1. Check the `url` in config.json is correct
2. Verify your API is running and accepting POST requests
3. Check `Authorization` header has the right API key
4. Send failures are non-blocking — they won't slow down OCR detection

### First run is slow?
PaddleOCR downloads model files (~100MB) on first run. After that, models are cached at `C:\Users\<username>\.paddlex\` and startup is fast.

### Want GPU acceleration?
1. Install CUDA-compatible PaddlePaddle: `pip install paddlepaddle-gpu`
2. Set `"use_gpu": true` in config.json

---

## 📡 API Payload Reference

When a player name is detected, the server receives:

```
POST /api/facecam
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY_HERE
```

```json
{
    "timestamp": "2026-03-07T05:30:00",
    "players": [
        {
            "raw_text": "P1ayerOne",
            "cleaned_text": "P1ayerOne",
            "confidence": 0.9234,
            "matched_name": "PlayerOne",
            "match_score": 92
        }
    ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO format detection time |
| `raw_text` | string | Exact text OCR read from screen |
| `cleaned_text` | string | Cleaned version (trimmed whitespace) |
| `confidence` | float | OCR confidence 0.0 - 1.0 |
| `matched_name` | string | Best matching name from Players Name.txt |
| `match_score` | int | Fuzzy match accuracy 0 - 100 |

> Only sends when detected names **change** — duplicate sends are skipped automatically.
