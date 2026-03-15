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

# Ensure the working directory is correct when running as a bundled exe
BASE_DIR = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent


class _StderrSuppressor:
    """Context manager that silences stderr AND stdout (where PaddleX dumps its logs).
    Only our explicit print() calls should go to the real stdout, so we
    temporarily swap both streams during the noisy init phase."""
    def __init__(self):
        self._orig_stderr = None
        self._orig_stdout = None
    def __enter__(self):
        self._orig_stderr = sys.stderr
        self._orig_stdout = sys.stdout
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        return self
    def __exit__(self, *args):
        sys.stderr = self._orig_stderr
        sys.stdout = self._orig_stdout


def run_region_selector():
    """Launch the interactive region selector."""
    from region_selector import RegionSelector
    selector = RegionSelector()
    region = selector.run()
    if region:
        print("[SUCCESS] Region saved successfully!")
    else:
        print("[WARNING] No region was selected.")


def run_ocr_main():
    """Run the main OCR capture loop (headless -- no GUI window)."""
    import json
    import time
    import threading

    CONFIG_PATH = BASE_DIR / "config.json"

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    # Import OCR engine (suppress stderr + stdout during import + init to hide
    # PaddleX "Creating model" / "Model files already exist" spam)
    print("[STATUS] Initializing OCR engine...", flush=True)

    with _StderrSuppressor():
        from ocr_engine import OCREngine
        from server_sender import ServerSender
        engine = OCREngine(config)

    print("[SUCCESS] OCR engine ready!", flush=True)

    # Initialize server sender
    sender = None
    try:
        sender = ServerSender(config)
    except Exception as exc:
        print(f"[WARNING] Server sender init failed: {exc}")

    # Report loaded players
    players = engine.player_names
    print(f"[STATUS] Loaded {len(players)} player name(s)")

    interval = config.get("capture", {}).get("interval_seconds", 2)
    print(f"[STATUS] Capture interval: {interval}s")
    print("[STATUS] OCR capture running... (Ctrl+C to stop)")

    last_sent_names = set()

    try:
        while True:
            try:
                pil_img, detections = engine.capture_and_recognise()

                if pil_img:
                    buf = io.BytesIO()
                    pil_img.save(buf, format="PNG")
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
                                f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)'
                            )
                        else:
                            print(
                                f'[STATUS] "{det["raw_text"]}" -> no match '
                                f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)'
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
                    print("[STATUS] No text detected in region")

            except Exception as exc:
                print(f"[ERROR] Capture error: {exc}")

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n[STATUS] OCR capture stopped.")


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
    else:
        run_ocr_main()
