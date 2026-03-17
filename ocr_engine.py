"""
OCR Engine — PaddleOCR-based text recognition with fuzzy player-name matching.

This module:
  1. Captures a specific screen region using mss.
  2. Runs PaddleOCR on the captured image.
  3. Fuzzy-matches OCR results against known player names from "Players Name.txt".
  4. Returns the best-matching player name(s).
"""

import json
import logging
import os
import re
import sys
import warnings
from pathlib import Path

# ── Suppress ALL noise BEFORE importing paddle/paddleocr ──────────────
warnings.filterwarnings("ignore")
os.environ["GLOG_minloglevel"]   = "3"
os.environ["PP_LOG_LEVEL"]       = "40"
os.environ["PADDLEX_LOG_LEVEL"]  = "40"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["FLAGS_call_stack_level"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["MPLBACKEND"] = "Agg"   # prevent matplotlib from importing tkinter

# ── Force DPI Awareness on Windows (Critical for correct screen capture/coords) ──
if os.name == 'nt':
    try:
        import ctypes
        # Set DPI awareness for Windows 8.1+ -> Per-Monitor DPI aware
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception as e:
        pass

import numpy as np
import time
from datetime import datetime
from typing import Optional

import mss
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from thefuzz import fuzz, process

# ──────────────────────────────────────────────────────────────────────
# Window listing helper (Windows only)
# ──────────────────────────────────────────────────────────────────────

def list_windows() -> list[dict]:
    """
    Return a list of real application windows as [{hwnd, title}].
    Filters out tool windows, child windows, system trays, and tiny popups.
    """
    try:
        import win32gui
        import win32con

        windows = []

        def _enum_cb(hwnd, _):
            # Must be visible
            if not win32gui.IsWindowVisible(hwnd):
                return
            # Must be a top-level window (no owner/parent)
            if win32gui.GetParent(hwnd):
                return
            # Skip tool windows (system tray icons, notification popups, etc.)
            ex_style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
            if ex_style & win32con.WS_EX_TOOLWINDOW:
                return
            # Must have a non-empty title
            title = win32gui.GetWindowText(hwnd)
            if not title:
                return
            # Must have a meaningful size (ignore tiny helper windows)
            rect = win32gui.GetWindowRect(hwnd)
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            if w < 100 or h < 60:
                return
            windows.append({"hwnd": hwnd, "title": title})

        win32gui.EnumWindows(_enum_cb, None)
        # Sort alphabetically for easier scanning
        windows.sort(key=lambda x: x["title"].lower())
        return windows
    except ImportError:
        return []


# ──────────────────────────────────────────────────────────────────────
# Paths — prefer FACECAM_DATA_DIR (set by Tauri frontend) so the engine
# reads config/players from the writable AppData directory in production.
# ──────────────────────────────────────────────────────────────────────
if os.environ.get("FACECAM_DATA_DIR"):
    BASE_DIR = Path(os.environ["FACECAM_DATA_DIR"])
elif getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent

CONFIG_PATH = BASE_DIR / "config.json"
PLAYERS_FILE = BASE_DIR / "Players Name.txt"

# ──────────────────────────────────────────────────────────────────────
# Common OCR character substitutions (what OCR misreads → likely correct)
# ──────────────────────────────────────────────────────────────────────
OCR_CHAR_MAP = {
    "0": "O",   "O": "0",
    "1": "l",   "l": "1",   "I": "l",
    "5": "S",   "S": "5",
    "8": "B",   "B": "8",
    "6": "G",   "G": "6",
    "2": "Z",   "Z": "2",
    "!": "l",   "|": "l",
    "{": "(",   "}": ")",
    "[": "(",   "]": ")",
    "$": "S",
    "@": "a",
    "&": "8",
}


def _load_config() -> dict:
    """Load the central configuration file."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_player_names() -> list[str]:
    """
    Read known player names from 'Players Name.txt'.
    Ignores blank lines and lines starting with '#'.
    """
    if not PLAYERS_FILE.exists():
        print(f"[OCR] ⚠ Players file not found: {PLAYERS_FILE}")
        return []

    names: list[str] = []
    with open(PLAYERS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                names.append(line)
    return names


def list_cameras(max_index: int = 10) -> list[dict]:
    """
    Enumerate available camera devices (physical and virtual, e.g. OBS, vMix).
    Returns a list of {index, name} dicts for every camera that opens successfully.
    Uses DirectShow on Windows so virtual cameras (OBS, vMix, NDI) are included.
    """
    import cv2
    cameras = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            # Try to get a device name via the backend property
            name = cap.getBackendName() or f"Camera {i}"
            # VideoCapture doesn't expose friendly names; use generic label
            name = f"Camera {i}"
            cap.release()
            cameras.append({"index": i, "name": name})
        else:
            cap.release()
    return cameras


# ──────────────────────────────────────────────────────────────────────
# PaddleOCR singleton — PaddleX 3.x raises "PDX has already been
# initialized" if PaddleOCR() is called more than once per process.
# Cache the instance here so OCREngine can be reconstructed safely.
# ──────────────────────────────────────────────────────────────────────
_paddle_ocr_instance = None
_paddle_ocr_lang = None
_paddle_ocr_device = None


def _get_or_create_paddleocr(lang: str, device: str):
    global _paddle_ocr_instance, _paddle_ocr_lang, _paddle_ocr_device

    if _paddle_ocr_instance is not None:
        if _paddle_ocr_lang == lang and _paddle_ocr_device == device:
            print("[OCR] Reusing existing PaddleOCR instance")
            return _paddle_ocr_instance
        # Config changed — warn but reuse anyway (can't reinit)
        print(f"[OCR] Warning: PaddleOCR already initialized with lang={_paddle_ocr_lang} "
              f"device={_paddle_ocr_device}. Reusing existing instance.")
        return _paddle_ocr_instance

    # ── PyInstaller frozen-env fix ────────────────────────────────────
    # Patch importlib.metadata so paddlex's dep checker doesn't raise
    # DependencyError for packages that are bundled but lack .dist-info.
    # NOTE: We do NOT import paddlex.utils.deps here — doing so triggers
    # PDX's global initialization as a side-effect, which then causes
    # PaddleOCR() below to raise "PDX has already been initialized".
    # The importlib.metadata patch alone is sufficient.
    if getattr(sys, "frozen", False):
        try:
            import importlib.metadata
            _orig_requires = importlib.metadata.requires
            _orig_version = importlib.metadata.version

            def _mock_requires(pkg):
                if pkg == "paddlex":
                    return []
                try:
                    return _orig_requires(pkg)
                except Exception:
                    return []

            def _mock_version(pkg):
                return "3.0.0" if pkg == "paddlex" else _orig_version(pkg)

            importlib.metadata.requires = _mock_requires
            importlib.metadata.version = _mock_version
            print("[OCR] Patched importlib.metadata for frozen env")
        except Exception as patch_err:
            print(f"[OCR] Warning: could not patch importlib.metadata: {patch_err}")

    # ── Stub out optional deps paddleocr imports but doesn't need for OCR ──
    # paddleocr/paddlex dynamically imports audio and other optional packages.
    # In the frozen exe these aren't bundled (and aren't needed for text OCR).
    # Injecting empty stub modules prevents ModuleNotFoundError at init time.
    import types as _types
    for _stub in [
        "soundfile", "sounddevice", "librosa", "resampy", "audioread",
        "audioread.rawread", "lxml", "lxml.etree", "lxml.html",
        "antlr4", "sentencepiece", "ftfy", "premailer",
    ]:
        if _stub not in sys.modules:
            sys.modules[_stub] = _types.ModuleType(_stub)

    try:
        from paddleocr import PaddleOCR as _PaddleOCR
        instance = _PaddleOCR(lang=lang, device=device, enable_mkldnn=False)
        _paddle_ocr_instance = instance
        _paddle_ocr_lang = lang
        _paddle_ocr_device = device
        return instance
    except Exception as first_err:
        # Handle "PDX already initialized" gracefully — try to get existing instance
        err_str = str(first_err)
        if "already been initialized" in err_str or "Reinitialization" in err_str:
            # PaddleX singleton is set but we have no cached reference — attempt
            # to construct without triggering the global init again.
            # This happens if the process is reused between OCR sessions.
            try:
                from paddleocr import PaddleOCR as _PaddleOCR
                # Try with suppress_log flag variants that exist in some builds
                instance = object.__new__(_PaddleOCR)
                # Fall back: just return a wrapper that tries predict via the class
                # If construction truly fails, raise a clear error
                raise RuntimeError(
                    "PaddleOCR singleton conflict — please restart FaceCam completely "
                    "(close the app and reopen it) to reset the OCR engine."
                ) from first_err
            except RuntimeError:
                raise
            except Exception:
                pass
        if isinstance(first_err, ModuleNotFoundError):
            raise RuntimeError(
                f"PaddleOCR failed to initialize.\n"
                f"  paddleocr wrapper error: {first_err}\n"
                f"  Missing module '{first_err.name}' — rebuild FaceCam_Backend.exe:\n"
                f"    cd FaceCam && python build_backend.py"
            ) from first_err
        raise RuntimeError(
            f"PaddleOCR failed to initialize.\n"
            f"  paddleocr wrapper error: {first_err}\n"
            f"Run: pip uninstall paddleocr paddlex -y && pip install paddleocr==3.4.0"
        ) from first_err


class OCREngine:
    """Wraps PaddleOCR with region capture and fuzzy matching."""

    def __init__(self, config: Optional[dict] = None):
        self.config = config or _load_config()
        ocr_cfg = self.config.get("ocr", {})

        self.confidence_threshold = ocr_cfg.get("confidence_threshold", 0.6)
        self.fuzzy_threshold = ocr_cfg.get("fuzzy_match_threshold", 70)
        self.use_gpu = ocr_cfg.get("use_gpu", False)
        self.lang = ocr_cfg.get("language", "en")

        # Capture settings
        cap_cfg = self.config.get("capture", {})
        self.save_debug = cap_cfg.get("save_debug_screenshots", False)
        self.debug_dir = BASE_DIR / cap_cfg.get("debug_screenshot_dir", "debug_captures")

        if self.save_debug:
            self.debug_dir.mkdir(parents=True, exist_ok=True)

        # Load known player names
        self.player_names = _load_player_names()
        print(f"[OCR] Loaded {len(self.player_names)} player name(s) from {PLAYERS_FILE.name}")

        # Input source from config
        src = self.config.get("input_source", {})
        if src:
            self.input_source = src
        else:
            region = self.config.get("capture_region", {})
            self.input_source = {
                "type": "window",
                "window_hwnd": 0,
                "window_title": "",
                "window_region": {
                    "left": region.get("left", 0),
                    "top": region.get("top", 0),
                    "width": region.get("width", 400),
                    "height": region.get("height", 100),
                },
            }
        print(f"[OCR] Input source: hwnd={self.input_source.get('window_hwnd', 0)}")

        # Initialize PaddleOCR v3.x (singleton — PaddleX only allows one init per process)
        print("[OCR] Initializing PaddleOCR ...")
        device = "gpu" if self.use_gpu else "cpu"
        logging.getLogger('ppocr').setLevel(logging.ERROR)

        self.ocr = _get_or_create_paddleocr(lang=self.lang, device=device)
        self._ocr_backend = "paddleocr"

        print("[OCR] PaddleOCR ready [OK]")

    # ─── Screen Capture ──────────────────────────────────────────────

    def _get_mss_region(self) -> dict:
        """Return the mss-compatible region dict from input_source.window_region."""
        r = self.input_source.get("window_region", {})
        return {
            "left": r.get("left", 0),
            "top": r.get("top", 0),
            "width": r.get("width", 400),
            "height": r.get("height", 100),
        }

    def capture_region(self) -> np.ndarray:
        """Capture the configured screen region and return as a numpy array."""
        with mss.mss() as sct:
            screenshot = sct.grab(self._get_mss_region())

        img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

        if self.save_debug:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            debug_path = self.debug_dir / f"capture_{ts}_raw.png"
            img.save(str(debug_path))

        img = self._preprocess_image(img)

        if self.save_debug:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            debug_path = self.debug_dir / f"capture_{ts}_processed.png"
            img.save(str(debug_path))

        frame = np.array(img)
        return frame

    def capture_region_pil(self) -> Image.Image:
        """Capture the configured screen region and return as a PIL Image."""
        with mss.mss() as sct:
            screenshot = sct.grab(self._get_mss_region())

        img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

        if self.save_debug:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            debug_path = self.debug_dir / f"capture_{ts}.png"
            img.save(str(debug_path))

        return img

    def capture_window_pil(self) -> Image.Image:
        """Capture a specific window by HWND using PrintWindow, then crop to region."""
        import win32gui
        import win32ui
        import win32con
        from ctypes import windll

        hwnd = self.input_source.get("window_hwnd", 0)
        if not hwnd:
            raise ValueError("No window handle configured. Select a window first.")

        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        w = right - left
        h = bottom - top
        if w <= 0 or h <= 0:
            raise ValueError(f"Window {hwnd} has invalid dimensions ({w}x{h}).")

        hwnd_dc = win32gui.GetWindowDC(hwnd)
        mfc_dc = win32ui.CreateDCFromHandle(hwnd_dc)
        save_dc = mfc_dc.CreateCompatibleDC()
        bmp = win32ui.CreateBitmap()
        bmp.CreateCompatibleBitmap(mfc_dc, w, h)
        save_dc.SelectObject(bmp)
        # PW_RENDERFULLCONTENT = 2 — captures even layered/DX windows
        windll.user32.PrintWindow(hwnd, save_dc.GetSafeHdc(), 2)

        info = bmp.GetInfo()
        raw = bmp.GetBitmapBits(True)
        img = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), raw, "raw", "BGRX", 0, 1)

        win32gui.DeleteObject(bmp.GetHandle())
        save_dc.DeleteDC()
        mfc_dc.DeleteDC()
        win32gui.ReleaseDC(hwnd, hwnd_dc)

        # Crop to configured region within the window
        r = self.input_source.get("window_region", {})
        rw = r.get("width", 0)
        rh = r.get("height", 0)
        if rw > 0 and rh > 0:
            box = (r.get("left", 0), r.get("top", 0),
                   r.get("left", 0) + rw, r.get("top", 0) + rh)
            img = img.crop(box)

        return img

    def capture_camera_pil(self) -> Image.Image:
        """Capture a frame from a camera (physical or virtual) by index, then crop to region."""
        import cv2
        idx = self.input_source.get("camera_index", 0)
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if not cap.isOpened():
            # fallback: try without backend hint
            cap = cv2.VideoCapture(idx)
        if not cap.isOpened():
            raise ValueError(f"Cannot open camera index {idx}. Make sure the camera/virtual camera is running.")

        # Set high resolution so region crops work well
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

        # Grab a couple of frames to allow the camera to settle
        for _ in range(3):
            cap.grab()
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            raise ValueError(f"Failed to read frame from camera index {idx}.")

        # Convert BGR (OpenCV) → RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(frame_rgb)

        # Crop to configured region if one is set
        r = self.input_source.get("window_region", {})
        rw = r.get("width", 0)
        rh = r.get("height", 0)
        if rw > 0 and rh > 0:
            box = (r.get("left", 0), r.get("top", 0),
                   r.get("left", 0) + rw, r.get("top", 0) + rh)
            # clamp to image boundaries
            iw, ih = img.size
            box = (max(0, box[0]), max(0, box[1]),
                   min(iw, box[2]), min(ih, box[3]))
            if box[2] > box[0] and box[3] > box[1]:
                img = img.crop(box)

        return img

    def capture_and_recognise(self) -> tuple[Image.Image, list[dict]]:
        """Capture from the configured input source and run OCR."""
        src_type = self.input_source.get("type", "window")

        if src_type == "camera":
            pil_img = self.capture_camera_pil()
        else:
            hwnd = self.input_source.get("window_hwnd", 0)
            if hwnd:
                pil_img = self.capture_window_pil()
            else:
                pil_img = self.capture_region_pil()

        processed = self._preprocess_image(pil_img)
        frame = np.array(processed)
        detections = self.recognise(image=frame)
        return pil_img, detections

    # ─── Image Preprocessing ─────────────────────────────────────────

    @staticmethod
    def _preprocess_image(img: Image.Image) -> Image.Image:
        """
        Preprocess the captured image to improve OCR accuracy:
          1. Upscale 3× with LANCZOS for sub-pixel detail
          2. Convert to grayscale (removes color noise)
          3. Boost contrast (makes text stand out)
          4. Sharpen (crisper edges on characters)
        """
        w, h = img.size
        img = img.resize((w * 3, h * 3), Image.LANCZOS)
        img = img.convert("L")  # grayscale
        img = ImageEnhance.Contrast(img).enhance(2.0)
        img = img.filter(ImageFilter.SHARPEN)
        img = img.convert("RGB")  # PaddleOCR expects 3-channel input
        return img

    # ─── OCR ─────────────────────────────────────────────────────────

    def recognise(self, image: Optional[np.ndarray] = None) -> list[dict]:
        """
        Run OCR on the given image (or capture a new one).

        Returns a list of dicts:
            {
                "raw_text": <str>,       # exact OCR output
                "confidence": <float>,   # 0-1
                "matched_name": <str|None>,  # fuzzy-matched player name
                "match_score": <int>,    # 0-100 fuzz ratio
            }
        """
        if image is None:
            image = self.capture_region()

        # PaddleOCR v3.x: use predict() instead of deprecated ocr()
        results = self.ocr.predict(image)

        detections: list[dict] = []

        if not results:
            return detections

        # OCRResult has rec_texts (list[str]) and rec_scores (list[float])
        for ocr_result in results:
            texts = ocr_result.get("rec_texts", []) if hasattr(ocr_result, "get") else getattr(ocr_result, "rec_texts", [])
            scores = ocr_result.get("rec_scores", []) if hasattr(ocr_result, "get") else getattr(ocr_result, "rec_scores", [])

            for text, confidence in zip(texts, scores):
                confidence = float(confidence)

                if confidence < self.confidence_threshold:
                    continue

                # Clean up common OCR artefacts
                cleaned = self._clean_text(text)
                if not cleaned:
                    continue

                # Fuzzy match against known player names
                matched_name, match_score = self._fuzzy_match(cleaned)

                detections.append({
                    "raw_text": text,
                    "cleaned_text": cleaned,
                    "confidence": round(confidence, 4),
                    "matched_name": matched_name,
                    "match_score": match_score,
                })

        return detections

    # ─── Fuzzy Matching ──────────────────────────────────────────────

    def _fuzzy_match(self, text: str) -> tuple[Optional[str], int]:
        """
        Multi-scorer fuzzy matching with OCR character correction.

        Strategy:
          1. Generate OCR-corrected variants of the text
          2. Try 4 different fuzzy scorers on each variant
          3. Return the best (name, score) across all combinations
        """
        if not self.player_names:
            return None, 0

        # Generate text variants with common OCR corrections applied
        variants = self._generate_ocr_variants(text)

        # Try multiple scorers — different ones excel at different errors
        scorers = [
            fuzz.token_set_ratio,    # handles extra/missing words
            fuzz.partial_ratio,      # handles substrings (name within garbage)
            fuzz.ratio,              # straight character similarity
            fuzz.token_sort_ratio,   # handles reordered words
        ]

        best_name = None
        best_score = 0

        for variant in variants:
            for scorer in scorers:
                result = process.extractOne(variant, self.player_names, scorer=scorer)
                if result:
                    name, score = result[0], result[1]
                    if score > best_score:
                        best_score = score
                        best_name = name

        if best_score >= self.fuzzy_threshold:
            return best_name, best_score
        return None, best_score

    @staticmethod
    def _generate_ocr_variants(text: str) -> list[str]:
        """
        Generate corrected variants of the OCR text by substituting
        commonly confused characters (0↔O, 1↔l, 5↔S, etc.).

        Returns the original text + up to N corrected variants.
        """
        variants = {text}

        # Apply each substitution individually
        for src_char, dst_char in OCR_CHAR_MAP.items():
            if src_char in text:
                variants.add(text.replace(src_char, dst_char))

        # Also try a "full correction" pass (all substitutions at once)
        corrected = text
        for src_char, dst_char in OCR_CHAR_MAP.items():
            corrected = corrected.replace(src_char, dst_char)
        variants.add(corrected)

        return list(variants)

    # ─── Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        """Remove stray symbols / whitespace that OCR sometimes injects."""
        text = text.strip()
        # collapse multiple spaces
        text = re.sub(r"\s{2,}", " ", text)
        return text

    def reload_player_names(self):
        """Hot-reload the player name list (e.g. between matches)."""
        self.player_names = _load_player_names()
        print(f"[OCR] Reloaded {len(self.player_names)} player name(s)")

    def reload_config(self):
        """Hot-reload config.json (input source, thresholds, etc.)."""
        self.config = _load_config()
        src = self.config.get("input_source", {})
        if src:
            self.input_source = src
        ocr_cfg = self.config.get("ocr", {})
        self.confidence_threshold = ocr_cfg.get("confidence_threshold", 0.6)
        self.fuzzy_threshold = ocr_cfg.get("fuzzy_match_threshold", 70)
        print("[OCR] Configuration reloaded [OK]")


# ──────────────────────────────────────────────────────────────────────
# Quick self-test
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    engine = OCREngine()
    print("\n[Test] Capturing and recognising ...")
    results = engine.recognise()
    if results:
        for r in results:
            print(f"  Raw: {r['raw_text']!r}  →  Matched: {r['matched_name']}  "
                  f"(confidence={r['confidence']}, fuzz={r['match_score']})")
    else:
        print("  No text detected.")
