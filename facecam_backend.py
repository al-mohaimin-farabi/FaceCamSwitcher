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

# ── PyInstaller frozen-env: fix importlib.metadata ────────────────────
# paddlex.utils.deps calls importlib.metadata.metadata("paddlex") and
# importlib.metadata.requires("paddlex") at import time to build its
# dependency map.  Inside a PyInstaller bundle these calls fail because
# .dist-info directories are not bundled (or are incomplete).
# We patch importlib.metadata BEFORE any paddle imports happen.
if getattr(sys, "frozen", False):
    import importlib.metadata as _im

    _orig_requires = _im.requires
    _orig_metadata = _im.metadata
    _orig_version  = _im.version

    def _patched_requires(pkg):
        try:
            result = _orig_requires(pkg)
            if result is not None:
                return result
        except _im.PackageNotFoundError:
            pass
        return []            # treat missing metadata as "no requirements"

    def _patched_metadata(pkg):
        try:
            return _orig_metadata(pkg)
        except _im.PackageNotFoundError:
            # Return a minimal email.message.Message so callers don't crash
            import email.message
            m = email.message.Message()
            m["Name"] = pkg
            m["Version"] = "0.0.0"
            return m

    def _patched_version(pkg):
        try:
            return _orig_version(pkg)
        except _im.PackageNotFoundError:
            return "0.0.0"   # dummy version so is_dep_available() says True

    _im.requires = _patched_requires
    _im.metadata = _patched_metadata
    _im.version  = _patched_version

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


def run_list_cameras():
    """Print available camera devices (including virtual cameras) as a JSON array.
    Uses pygrabber for friendly names (OBS Virtual Camera, vMix, etc.) with
    OpenCV as a fallback to verify devices are actually readable.
    NOTE: Intentionally avoids importing ocr_engine to prevent PaddleOCR init noise.
    """
    import json

    # Step 1: Try to get friendly device names via pygrabber (Windows DirectShow)
    device_names: dict[int, str] = {}
    try:
        from pygrabber.dshow_graph import FilterGraph
        graph = FilterGraph()
        devices = graph.get_input_devices()
        for i, name in enumerate(devices):
            device_names[i] = name
    except Exception:
        pass

    # Step 2: Use OpenCV to confirm which indices are actually readable
    try:
        import cv2
        cameras = []
        max_index = max(len(device_names) + 2, 10)
        for i in range(max_index):
            cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
            if cap.isOpened():
                name = device_names.get(i, f"Camera {i}")
                cameras.append({"index": i, "name": name})
                cap.release()
            else:
                cap.release()
        print(json.dumps(cameras))
    except Exception as exc:
        # If OpenCV fails entirely, fall back to pygrabber names only
        if device_names:
            cameras = [{"index": i, "name": n} for i, n in device_names.items()]
            print(json.dumps(cameras))
        else:
            print(f"[ERROR] list_cameras failed: {exc}", flush=True)
            print("[]")


def run_camera_region_select(camera_index: int):
    """Open an interactive region selector fed by a live camera preview."""
    from camera_region_selector import CameraRegionSelector
    selector = CameraRegionSelector(camera_index=camera_index)
    region = selector.run()
    if region:
        print("[SUCCESS] Camera region saved successfully!")
    else:
        print("[WARNING] No camera region was selected.")


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

    # Initialize server sender only if enabled in config
    sender = None
    server_enabled = config.get("server", {}).get("enabled", False)
    if server_enabled:
        try:
            sender = ServerSender(config)
        except Exception as exc:
            print(f"[WARNING] Server sender init failed: {exc}", flush=True)
    else:
        print("[STATUS] Server sending disabled — running in local-only mode", flush=True)

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
    elif "--camera-region-select" in sys.argv:
        # Find --camera-index N argument, default 0
        cam_idx = 0
        if "--camera-index" in sys.argv:
            try:
                cam_idx = int(sys.argv[sys.argv.index("--camera-index") + 1])
            except (ValueError, IndexError):
                cam_idx = 0
        run_camera_region_select(cam_idx)
    elif "--list-windows" in sys.argv:
        run_list_windows()
    elif "--list-cameras" in sys.argv:
        run_list_cameras()
    else:
        run_ocr_main()
