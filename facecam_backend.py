"""
FaceCam Backend -- Standalone entry point for PyInstaller bundling.

This script wraps all FaceCam functionality so it can be bundled into
a single executable (FaceCam_Backend.exe). The Tauri frontend calls
this exe to run OCR capture or the region selector.

Usage:
    FaceCam_Backend.exe                    # Run the OCR main loop
    FaceCam_Backend.exe --region-select    # Open the region selector
"""

import base64
import io
import os
import sys
import warnings
from pathlib import Path

# ── Suppress ALL noisy output from PaddlePaddle / PaddleX / requests ──
# These must be set BEFORE any paddle imports happen.
warnings.filterwarnings("ignore")                       # kill all Python warnings
os.environ["GLOG_minloglevel"]   = "3"                  # suppress Google Logging (used by Paddle)
os.environ["PP_LOG_LEVEL"]       = "40"                 # PaddlePaddle: ERROR only
os.environ["PADDLEX_LOG_LEVEL"]  = "40"                 # PaddleX: ERROR only
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["FLAGS_call_stack_level"] = "0"              # suppress call stack info

# Prefer FACECAM_DATA_DIR (set by the Tauri frontend) so the backend finds
# config.json and Players Name.txt in the user-writable AppData directory.
# Fall back to the exe/script directory for dev mode.
if os.environ.get("FACECAM_DATA_DIR"):
    BASE_DIR = Path(os.environ["FACECAM_DATA_DIR"])
elif getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent


class _StderrSuppressor:
    """Context manager that silences stderr only (where PaddleX dumps its logs).
    We must NOT redirect sys.stdout because Tauri reads from the real OS stdout pipe —
    swapping it causes the pipe to break and the process to appear crashed."""
    def __init__(self):
        self._orig_stderr = None
    def __enter__(self):
        self._orig_stderr = sys.stderr
        sys.stderr = io.StringIO()
        return self
    def __exit__(self, *args):
        sys.stderr = self._orig_stderr


def run_region_selector():
    """Launch the interactive region selector."""
    from region_selector import RegionSelector
    selector = RegionSelector()
    region = selector.run()
    if region:
        print("[SUCCESS] Region saved successfully!")
    else:
        print("[WARNING] No region was selected.")


def run_list_windows():
    """Print available windows as a JSON array.
    NOTE: Intentionally does NOT import ocr_engine to avoid triggering
    PaddleOCR initialisation (which pollutes stdout with lines starting
    with '[' and breaks the JSON parser in the Rust frontend).
    """
    import json
    try:
        import win32gui
        import win32con
        windows = []

        def _cb(hwnd, _):
            if not win32gui.IsWindowVisible(hwnd):
                return
            if win32gui.GetParent(hwnd):
                return
            ex_style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
            if ex_style & win32con.WS_EX_TOOLWINDOW:
                return
            title = win32gui.GetWindowText(hwnd)
            if not title:
                return
            rect = win32gui.GetWindowRect(hwnd)
            if (rect[2] - rect[0]) < 100 or (rect[3] - rect[1]) < 60:
                return
            windows.append({"hwnd": hwnd, "title": title})

        win32gui.EnumWindows(_cb, None)
        windows.sort(key=lambda x: x["title"].lower())
        print(json.dumps(windows))
    except Exception as exc:
        print(f"[ERROR] list_windows failed: {exc}", flush=True)
        print("[]")


def run_ocr_main():
    """Run the main OCR capture loop (headless -- no GUI window)."""
    import json
    import time
    import threading

    CONFIG_PATH = BASE_DIR / "config.json"

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as exc:
        print(f"[ERROR] Failed to load config: {exc}", flush=True)
        return

    # Import OCR engine (suppress stderr during import + init to hide
    # PaddleX "Creating model" / "Model files already exist" spam)
    # NOTE: We only suppress stderr — stdout must remain connected to the
    # real OS pipe so Tauri can read our log lines.
    print("[STATUS] Initializing OCR engine...", flush=True)

    try:
        with _StderrSuppressor():
            from ocr_engine import OCREngine
            from server_sender import ServerSender
            engine = OCREngine(config)
    except Exception as exc:
        print(f"[ERROR] OCR engine failed to initialize: {exc}", flush=True)
        return

    print("[SUCCESS] OCR engine ready!", flush=True)

    # Initialize server sender
    sender = None
    try:
        sender = ServerSender(config)
    except Exception as exc:
        print(f"[WARNING] Server sender init failed: {exc}", flush=True)

    # Report loaded players
    players = engine.player_names
    print(f"[STATUS] Loaded {len(players)} player name(s)", flush=True)

    interval = config.get("capture", {}).get("interval_seconds", 2)
    print(f"[STATUS] Capture interval: {interval}s", flush=True)
    print("[STATUS] OCR capture running... (Ctrl+C to stop)", flush=True)

    last_sent_names = set()
    consecutive_errors = 0
    MAX_CONSECUTIVE_ERRORS = 10

    try:
        while True:
            try:
                pil_img, detections = engine.capture_and_recognise()
                consecutive_errors = 0  # reset on success

                if pil_img:
                    # Resize preview if it's too large (keep aspect ratio)
                    preview_img = pil_img.copy()
                    max_preview_dim = 640
                    if preview_img.width > max_preview_dim or preview_img.height > max_preview_dim:
                        preview_img.thumbnail((max_preview_dim, max_preview_dim))

                    buf = io.BytesIO()
                    preview_img.save(buf, format="JPEG", quality=85)
                    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

                    json_dets = []
                    if detections:
                        for d in detections:
                            json_dets.append({
                                "raw_text": str(d.get("raw_text", "")),
                                "matched_name": str(d.get("matched_name", "")) if d.get("matched_name") else None,
                                "confidence": float(d.get("confidence", 0)),
                                "match_score": int(d.get("match_score", 0)),
                            })

                    preview_data = {
                        "image": img_b64,
                        "detections": json_dets
                    }
                    print(f"[PREVIEW] {json.dumps(preview_data)}", flush=True)

                if detections:
                    for det in detections:
                        if det["matched_name"]:
                            print(
                                f'[SUCCESS] "{det["raw_text"]}" -> {det["matched_name"]} '
                                f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)',
                                flush=True
                            )
                        else:
                            print(
                                f'[STATUS] "{det["raw_text"]}" -> no match '
                                f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)',
                                flush=True
                            )

                    # Send to server (non-blocking)
                    if sender:
                        matched = [d for d in detections if d["matched_name"]]
                        current_names = {d["matched_name"] for d in matched}
                        if matched and current_names != last_sent_names:
                            last_sent_names = current_names
                            threading.Thread(
                                target=_send_async,
                                args=(sender, list(matched)),
                                daemon=True,
                            ).start()
                else:
                    print("[STATUS] No text detected in region", flush=True)

            except Exception as exc:
                consecutive_errors += 1
                print(f"[ERROR] Capture error: {exc}", flush=True)
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    print(f"[ERROR] {MAX_CONSECUTIVE_ERRORS} consecutive errors — stopping capture.", flush=True)
                    break

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n[STATUS] OCR capture stopped.", flush=True)


def _send_async(sender, matched):
    """Send detections to server in background."""
    try:
        ok = sender.send(matched)
        if ok:
            print(f"[SUCCESS] Sent {len(matched)} name(s) to server")
        else:
            print("[WARNING] Server send failed")
    except Exception as exc:
        print(f"[ERROR] Server error: {exc}")


if __name__ == "__main__":
    if "--region-select" in sys.argv:
        run_region_selector()
    elif "--list-windows" in sys.argv:
        run_list_windows()
    else:
        run_ocr_main()
