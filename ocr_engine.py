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
import warnings

# ── Suppress ALL noise BEFORE importing paddle/paddleocr ──────────────
warnings.filterwarnings("ignore")
os.environ["GLOG_minloglevel"]   = "3"
os.environ["PP_LOG_LEVEL"]       = "40"
os.environ["PADDLEX_LOG_LEVEL"]  = "40"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["FLAGS_call_stack_level"] = "0"

import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import mss
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from paddleocr import PaddleOCR
from thefuzz import fuzz, process


# ──────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────
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

        # Region from config
        region = self.config.get("capture_region", {})
        self.region = {
            "left": region.get("left", 0),
            "top": region.get("top", 0),
            "width": region.get("width", 400),
            "height": region.get("height", 100),
        }
        print(f"[OCR] Capture region: {self.region}")

        # Initialize PaddleOCR v3.x
        # - device: 'cpu' or 'gpu' (replaces old use_gpu)
        # - enable_mkldnn: disabled to avoid compatibility issues
        # - use_textline_orientation: replaces old use_angle_cls
        print("[OCR] Initializing PaddleOCR ...")
        device = "gpu" if self.use_gpu else "cpu"
        # Suppress internal PaddleOCR logs
        logging.getLogger('ppocr').setLevel(logging.ERROR)
        
        self.ocr = PaddleOCR(
            lang=self.lang,
            device=device,
            enable_mkldnn=False,
            use_textline_orientation=True,
        )
        print("[OCR] PaddleOCR ready [OK]")

    # ─── Screen Capture ──────────────────────────────────────────────

    def capture_region(self) -> np.ndarray:
        """Capture the configured screen region and return as a numpy array."""
        with mss.mss() as sct:
            screenshot = sct.grab(self.region)

        img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

        if self.save_debug:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            debug_path = self.debug_dir / f"capture_{ts}_raw.png"
            img.save(str(debug_path))

        # ── Image preprocessing for better OCR accuracy ──────────
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
            screenshot = sct.grab(self.region)

        img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

        if self.save_debug:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            debug_path = self.debug_dir / f"capture_{ts}.png"
            img.save(str(debug_path))

        return img

    def capture_and_recognise(self) -> tuple[Image.Image, list[dict]]:
        """Capture the region and run OCR. Returns (PIL Image, detections)."""
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
        """Hot-reload config.json (region, thresholds, etc.)."""
        self.config = _load_config()
        region = self.config.get("capture_region", {})
        self.region = {
            "left": region.get("left", 0),
            "top": region.get("top", 0),
            "width": region.get("width", 400),
            "height": region.get("height", 100),
        }
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
