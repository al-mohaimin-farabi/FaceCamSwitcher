"""
FaceCam — GUI Application.

A real-time OCR monitoring dashboard that shows:
  • Live preview of the captured screen region (scaled up for visibility)
  • OCR detection results with confidence and fuzzy-match accuracy bars
  • Detection history log
  • Controls to start/stop capture, re-select region, and reload config

Usage:
    python main.py
"""

import json
import sys
import threading
import time
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import font as tkfont

from PIL import Image, ImageTk

# ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

# ──────────────────────────────────────────────────────────────────────
# Color palette — premium dark theme
# ──────────────────────────────────────────────────────────────────────
C = {
    "bg":           "#0d1117",     # deep dark background
    "bg_card":      "#161b22",     # card / panel background
    "bg_card_alt":  "#1c2333",     # alternate row / section
    "bg_input":     "#0d1117",     # input field background
    "border":       "#30363d",     # subtle borders
    "border_focus": "#58a6ff",     # focus / active accent
    "text":         "#e6edf3",     # primary text
    "text_dim":     "#8b949e",     # secondary / dimmed text
    "text_muted":   "#484f58",     # muted text
    "accent":       "#58a6ff",     # primary accent blue
    "accent_hover": "#79c0ff",     # hover accent
    "green":        "#3fb950",     # success / high accuracy
    "green_bg":     "#1a3a2a",     # success background
    "yellow":       "#d29922",     # medium accuracy
    "yellow_bg":    "#3d2e00",     # warning background
    "red":          "#f85149",     # low / error
    "red_bg":       "#3d1418",     # error background
    "cyan":         "#39d2c0",     # info accent
    "purple":       "#bc8cff",     # special accent
}


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ──────────────────────────────────────────────────────────────────────
# Accuracy bar widget
# ──────────────────────────────────────────────────────────────────────
class AccuracyBar(tk.Canvas):
    """A horizontal bar that fills from 0-100% with color gradient."""

    def __init__(self, parent, bar_width=200, bar_height=18, **kwargs):
        super().__init__(
            parent, width=bar_width, height=bar_height,
            bg=C["bg_card"], highlightthickness=0, **kwargs,
        )
        self.bar_width = bar_width
        self.bar_height = bar_height

    def set_value(self, pct: float, label: str = ""):
        """Set the bar fill to *pct* (0-100)."""
        self.delete("all")
        pct = max(0, min(100, pct))

        # Background track
        self.create_rectangle(
            0, 0, self.bar_width, self.bar_height,
            fill=C["bg"], outline=C["border"], width=1,
        )

        # Filled portion
        fill_w = int(self.bar_width * pct / 100)
        if pct >= 80:
            color = C["green"]
        elif pct >= 50:
            color = C["yellow"]
        else:
            color = C["red"]

        if fill_w > 0:
            self.create_rectangle(1, 1, fill_w, self.bar_height - 1, fill=color, outline="")

        # Label
        display = f"{label}  {pct:.0f}%" if label else f"{pct:.0f}%"
        self.create_text(
            self.bar_width // 2, self.bar_height // 2,
            text=display, fill=C["text"], font=("Consolas", 9),
        )


# ──────────────────────────────────────────────────────────────────────
# Main Application
# ──────────────────────────────────────────────────────────────────────
class FaceCamApp:
    """Premium dark-themed OCR monitoring dashboard."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("FaceCam — OCR Monitor")
        self.root.configure(bg=C["bg"])
        self.root.minsize(780, 620)
        self.root.geometry("860x680")

        # Try to set icon (optional)
        try:
            self.root.iconbitmap(default="")
        except Exception:
            pass

        # ── Fonts ────────────────────────────────────────────────────
        self.font_title = tkfont.Font(family="Segoe UI", size=18, weight="bold")
        self.font_heading = tkfont.Font(family="Segoe UI", size=12, weight="bold")
        self.font_body = tkfont.Font(family="Consolas", size=11)
        self.font_small = tkfont.Font(family="Consolas", size=9)
        self.font_label = tkfont.Font(family="Segoe UI", size=10)
        self.font_btn = tkfont.Font(family="Segoe UI", size=10, weight="bold")

        # ── State ────────────────────────────────────────────────────
        self.running = False
        self.engine = None
        self.sender = None
        self.capture_thread = None
        self.preview_photo = None   # keep reference to prevent GC
        self.history: list[dict] = []  # detection log
        self.scan_count = 0
        self.total_detections = 0
        self.total_matches = 0

        # ── Build UI ─────────────────────────────────────────────────
        self._build_ui()

        # ── Initialize OCR engine in background ─────────────────────
        self._set_status("Initializing PaddleOCR engine...", C["yellow"])
        threading.Thread(target=self._init_engine, daemon=True).start()

        # ── Window close handler ─────────────────────────────────────
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ══════════════════════════════════════════════════════════════════
    # UI Construction
    # ══════════════════════════════════════════════════════════════════

    def _build_ui(self):
        # ── HEADER ───────────────────────────────────────────────────
        header = tk.Frame(self.root, bg=C["bg_card"], pady=10, padx=16)
        header.pack(fill=tk.X)

        tk.Label(
            header, text="⬤", font=("Segoe UI", 14),
            fg=C["cyan"], bg=C["bg_card"],
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Label(
            header, text="FaceCam", font=self.font_title,
            fg=C["text"], bg=C["bg_card"],
        ).pack(side=tk.LEFT)

        tk.Label(
            header, text="OCR Monitor", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"],
        ).pack(side=tk.LEFT, padx=(8, 0), pady=(6, 0))

        # Status indicator in header (right side)
        self.status_dot = tk.Label(
            header, text="●", font=("Segoe UI", 10),
            fg=C["text_muted"], bg=C["bg_card"],
        )
        self.status_dot.pack(side=tk.RIGHT, padx=(4, 0))

        self.status_label = tk.Label(
            header, text="Initializing...", font=self.font_small,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.E,
        )
        self.status_label.pack(side=tk.RIGHT)

        # Divider
        tk.Frame(self.root, bg=C["border"], height=1).pack(fill=tk.X)

        # ── MAIN BODY ────────────────────────────────────────────────
        body = tk.Frame(self.root, bg=C["bg"])
        body.pack(fill=tk.BOTH, expand=True, padx=12, pady=8)

        # Left column: preview + controls
        left = tk.Frame(body, bg=C["bg"])
        left.pack(side=tk.LEFT, fill=tk.BOTH, padx=(0, 6))

        # Right column: results + log
        right = tk.Frame(body, bg=C["bg"])
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(6, 0))

        # ── LEFT: Capture Preview Card ───────────────────────────────
        preview_card = tk.Frame(left, bg=C["bg_card"], bd=0, highlightthickness=1, highlightbackground=C["border"])
        preview_card.pack(fill=tk.X, pady=(0, 8))

        tk.Label(
            preview_card, text="📷  CAPTURE PREVIEW", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).pack(fill=tk.X, padx=12, pady=(10, 4))

        # Preview canvas (fixed size, image will be scaled to fit)
        self.preview_canvas = tk.Canvas(
            preview_card, width=340, height=120,
            bg=C["bg"], highlightthickness=1, highlightbackground=C["border"],
        )
        self.preview_canvas.pack(padx=12, pady=(0, 6))

        # "No capture" placeholder
        self.preview_canvas.create_text(
            170, 60, text="No capture yet",
            fill=C["text_muted"], font=self.font_small,
            tags="placeholder",
        )

        # Region info label
        self.region_info_label = tk.Label(
            preview_card, text="Region: not loaded", font=self.font_small,
            fg=C["text_muted"], bg=C["bg_card"], anchor=tk.W,
        )
        self.region_info_label.pack(fill=tk.X, padx=12, pady=(0, 10))

        # ── LEFT: Control Buttons ────────────────────────────────────
        controls_card = tk.Frame(left, bg=C["bg_card"], bd=0, highlightthickness=1, highlightbackground=C["border"])
        controls_card.pack(fill=tk.X, pady=(0, 8))

        tk.Label(
            controls_card, text="⚙  CONTROLS", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).pack(fill=tk.X, padx=12, pady=(10, 6))

        btn_frame = tk.Frame(controls_card, bg=C["bg_card"])
        btn_frame.pack(fill=tk.X, padx=12, pady=(0, 10))

        self.start_btn = self._make_button(btn_frame, "▶  Start", self._toggle_capture, C["green"])
        self.start_btn.pack(fill=tk.X, pady=2)

        self.select_btn = self._make_button(btn_frame, "⊞  Select Region", self._open_region_selector, C["accent"])
        self.select_btn.pack(fill=tk.X, pady=2)

        self.snap_btn = self._make_button(btn_frame, "📸  Single Snap", self._single_snap, C["purple"])
        self.snap_btn.pack(fill=tk.X, pady=2)

        self.reload_btn = self._make_button(btn_frame, "↻  Reload Names", self._reload_names, C["cyan"])
        self.reload_btn.pack(fill=tk.X, pady=2)

        # ── LEFT: Stats Card ─────────────────────────────────────────
        stats_card = tk.Frame(left, bg=C["bg_card"], bd=0, highlightthickness=1, highlightbackground=C["border"])
        stats_card.pack(fill=tk.X, pady=(0, 8))

        tk.Label(
            stats_card, text="📊  STATISTICS", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).pack(fill=tk.X, padx=12, pady=(10, 6))

        stats_inner = tk.Frame(stats_card, bg=C["bg_card"])
        stats_inner.pack(fill=tk.X, padx=12, pady=(0, 10))

        self.lbl_scans = self._make_stat_row(stats_inner, "Scans", "0", 0)
        self.lbl_detections = self._make_stat_row(stats_inner, "Detections", "0", 1)
        self.lbl_matches = self._make_stat_row(stats_inner, "Matches", "0", 2)
        self.lbl_accuracy = self._make_stat_row(stats_inner, "Match Rate", "—", 3)

        # ── RIGHT: Current Detection Card ────────────────────────────
        det_card = tk.Frame(right, bg=C["bg_card"], bd=0, highlightthickness=1, highlightbackground=C["border"])
        det_card.pack(fill=tk.X, pady=(0, 8))

        tk.Label(
            det_card, text="🔍  CURRENT DETECTION", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).pack(fill=tk.X, padx=12, pady=(10, 6))

        # Detection details frame
        self.det_frame = tk.Frame(det_card, bg=C["bg_card"])
        self.det_frame.pack(fill=tk.X, padx=12, pady=(0, 10))

        # Placeholder
        self.det_placeholder = tk.Label(
            self.det_frame, text="No detection yet — press Start or Single Snap",
            font=self.font_small, fg=C["text_muted"], bg=C["bg_card"],
        )
        self.det_placeholder.pack(pady=20)

        # ── RIGHT: Detection History ─────────────────────────────────
        log_card = tk.Frame(right, bg=C["bg_card"], bd=0, highlightthickness=1, highlightbackground=C["border"])
        log_card.pack(fill=tk.BOTH, expand=True, pady=(0, 4))

        log_header = tk.Frame(log_card, bg=C["bg_card"])
        log_header.pack(fill=tk.X, padx=12, pady=(10, 6))

        tk.Label(
            log_header, text="📋  DETECTION HISTORY", font=self.font_label,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).pack(side=tk.LEFT)

        self.clear_btn = tk.Label(
            log_header, text="Clear", font=self.font_small,
            fg=C["accent"], bg=C["bg_card"], cursor="hand2",
        )
        self.clear_btn.pack(side=tk.RIGHT)
        self.clear_btn.bind("<Button-1>", lambda e: self._clear_history())

        # Scrollable log
        log_scroll_frame = tk.Frame(log_card, bg=C["bg_card"])
        log_scroll_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        self.log_text = tk.Text(
            log_scroll_frame,
            bg=C["bg"], fg=C["text"],
            font=self.font_small,
            relief=tk.FLAT, bd=0,
            wrap=tk.WORD, state=tk.DISABLED,
            insertbackground=C["text"],
            selectbackground=C["accent"],
            highlightthickness=1,
            highlightbackground=C["border"],
            padx=8, pady=8,
        )
        scrollbar = tk.Scrollbar(
            log_scroll_frame, orient=tk.VERTICAL,
            command=self.log_text.yview,
            bg=C["bg_card"], troughcolor=C["bg"],
            activebackground=C["text_muted"],
        )
        self.log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Configure text tags for colored log entries
        self.log_text.tag_configure("time", foreground=C["text_muted"])
        self.log_text.tag_configure("match", foreground=C["green"])
        self.log_text.tag_configure("nomatch", foreground=C["yellow"])
        self.log_text.tag_configure("error", foreground=C["red"])
        self.log_text.tag_configure("info", foreground=C["cyan"])
        self.log_text.tag_configure("dim", foreground=C["text_dim"])

        # ── FOOTER ───────────────────────────────────────────────────
        footer = tk.Frame(self.root, bg=C["bg_card"], height=30)
        footer.pack(fill=tk.X, side=tk.BOTTOM)

        self.footer_label = tk.Label(
            footer, text="FaceCam v1.0  •  PaddleOCR v3", font=self.font_small,
            fg=C["text_muted"], bg=C["bg_card"],
        )
        self.footer_label.pack(side=tk.LEFT, padx=12, pady=4)

        self.interval_label = tk.Label(
            footer, text="", font=self.font_small,
            fg=C["text_muted"], bg=C["bg_card"],
        )
        self.interval_label.pack(side=tk.RIGHT, padx=12, pady=4)

    # ──────────────────────────────────────────────────────────────────
    # Widget helpers
    # ──────────────────────────────────────────────────────────────────

    def _make_button(self, parent, text, command, color) -> tk.Frame:
        """Create a styled button with hover effect."""
        btn = tk.Frame(parent, bg=C["bg_card_alt"], cursor="hand2",
                       highlightthickness=1, highlightbackground=C["border"], bd=0)

        lbl = tk.Label(
            btn, text=text, font=self.font_btn,
            fg=color, bg=C["bg_card_alt"],
            pady=6, padx=12,
        )
        lbl.pack(fill=tk.X)

        def on_enter(e):
            btn.configure(highlightbackground=color)
            lbl.configure(bg=C["bg"])

        def on_leave(e):
            btn.configure(highlightbackground=C["border"])
            lbl.configure(bg=C["bg_card_alt"])

        def on_click(e):
            command()

        for widget in (btn, lbl):
            widget.bind("<Enter>", on_enter)
            widget.bind("<Leave>", on_leave)
            widget.bind("<Button-1>", on_click)

        return btn

    def _make_stat_row(self, parent, label, value, row) -> tk.Label:
        """Create a label-value stat row."""
        tk.Label(
            parent, text=label, font=self.font_small,
            fg=C["text_dim"], bg=C["bg_card"], anchor=tk.W,
        ).grid(row=row, column=0, sticky=tk.W, pady=1)

        val_lbl = tk.Label(
            parent, text=value, font=self.font_body,
            fg=C["text"], bg=C["bg_card"], anchor=tk.E,
        )
        val_lbl.grid(row=row, column=1, sticky=tk.E, padx=(20, 0), pady=1)

        parent.columnconfigure(1, weight=1)
        return val_lbl

    # ──────────────────────────────────────────────────────────────────
    # Engine initialization
    # ──────────────────────────────────────────────────────────────────

    def _init_engine(self):
        """Initialize the OCR engine (runs in background thread)."""
        try:
            config = load_config()

            from ocr_engine import OCREngine
            self.engine = OCREngine(config)

            # Update region info
            r = config.get("capture_region", {})
            region_text = (
                f"Monitor {r.get('monitor_index', '?')}  •  "
                f"{r.get('width', 0)}×{r.get('height', 0)}  •  "
                f"({r.get('left', 0)}, {r.get('top', 0)})"
            )

            interval = config.get("capture", {}).get("interval_seconds", 2)

            self.root.after(0, lambda: self.region_info_label.configure(text=region_text))
            self.root.after(0, lambda: self.interval_label.configure(text=f"Interval: {interval}s"))
            self.root.after(0, lambda: self._set_status("Ready — press Start", C["green"]))
            self.root.after(0, lambda: self._log("Engine initialized successfully", "info"))

            players = self.engine.player_names
            self.root.after(0, lambda: self._log(
                f"Loaded {len(players)} player name(s): {', '.join(players[:10])}"
                + ("..." if len(players) > 10 else ""),
                "dim",
            ))

        except Exception as exc:
            self.root.after(0, lambda: self._set_status(f"Init error: {exc}", C["red"]))
            self.root.after(0, lambda: self._log(f"ERROR: {exc}", "error"))

    # ──────────────────────────────────────────────────────────────────
    # Status
    # ──────────────────────────────────────────────────────────────────

    def _set_status(self, text: str, color: str):
        self.status_label.configure(text=text, fg=color)
        self.status_dot.configure(fg=color)

    # ──────────────────────────────────────────────────────────────────
    # Logging
    # ──────────────────────────────────────────────────────────────────

    def _log(self, message: str, tag: str = "dim"):
        """Append a timestamped line to the history log."""
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.insert(tk.END, f"[{ts}] ", "time")
        self.log_text.insert(tk.END, f"{message}\n", tag)
        self.log_text.see(tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def _clear_history(self):
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.configure(state=tk.DISABLED)

    # ──────────────────────────────────────────────────────────────────
    # Preview update
    # ──────────────────────────────────────────────────────────────────

    def _update_preview(self, pil_img: Image.Image):
        """Scale the captured image to fit the preview canvas and display it."""
        canvas_w = self.preview_canvas.winfo_width() or 340
        canvas_h = self.preview_canvas.winfo_height() or 120

        # Scale image to fit canvas while preserving aspect ratio
        img_w, img_h = pil_img.size
        scale = min(canvas_w / img_w, canvas_h / img_h, 6)  # cap at 6x zoom
        new_w = max(int(img_w * scale), 1)
        new_h = max(int(img_h * scale), 1)

        scaled = pil_img.resize((new_w, new_h), Image.NEAREST)
        self.preview_photo = ImageTk.PhotoImage(scaled)

        self.preview_canvas.delete("all")
        self.preview_canvas.create_image(
            canvas_w // 2, canvas_h // 2,
            image=self.preview_photo, anchor=tk.CENTER,
        )

    # ──────────────────────────────────────────────────────────────────
    # Detection display
    # ──────────────────────────────────────────────────────────────────

    def _update_detections(self, detections: list[dict]):
        """Rebuild the current-detection panel with fresh results."""
        # Clear existing widgets
        for w in self.det_frame.winfo_children():
            w.destroy()

        if not detections:
            tk.Label(
                self.det_frame, text="No text detected in region",
                font=self.font_small, fg=C["text_muted"], bg=C["bg_card"],
            ).pack(pady=16)
            return

        for i, det in enumerate(detections):
            row = tk.Frame(self.det_frame, bg=C["bg_card_alt"] if i % 2 == 0 else C["bg_card"], pady=6, padx=8)
            row.pack(fill=tk.X, pady=(0, 2))

            # ── Row top: raw text + matched name ─────────────
            top = tk.Frame(row, bg=row.cget("bg"))
            top.pack(fill=tk.X)

            # Raw text
            tk.Label(
                top, text=f"OCR:", font=self.font_small,
                fg=C["text_dim"], bg=row.cget("bg"),
            ).pack(side=tk.LEFT)

            tk.Label(
                top, text=f' "{det["raw_text"]}"', font=self.font_body,
                fg=C["text"], bg=row.cget("bg"),
            ).pack(side=tk.LEFT, padx=(2, 12))

            # Matched name badge
            if det["matched_name"]:
                badge_bg = C["green_bg"]
                badge_fg = C["green"]
                badge_text = f"[OK] {det['matched_name']}"
            else:
                badge_bg = C["yellow_bg"]
                badge_fg = C["yellow"]
                badge_text = "[FAIL] No match"

            badge = tk.Label(
                top, text=f" {badge_text} ", font=self.font_small,
                fg=badge_fg, bg=badge_bg,
            )
            badge.pack(side=tk.RIGHT)

            # ── Row bottom: accuracy bars ────────────────────
            row_bg = row.cget("bg")

            # OCR confidence bar row
            conf_row = tk.Frame(row, bg=row_bg)
            conf_row.pack(fill=tk.X, pady=(4, 1))
            tk.Label(
                conf_row, text="OCR Conf:", font=self.font_small,
                fg=C["text_dim"], bg=row_bg, width=12, anchor=tk.W,
            ).pack(side=tk.LEFT)
            conf_bar = AccuracyBar(conf_row, bar_width=260, bar_height=16)
            conf_bar.pack(side=tk.LEFT, padx=(4, 0))
            conf_bar.set_value(det["confidence"] * 100, "Confidence")

            # Fuzzy match bar row
            fuzz_row = tk.Frame(row, bg=row_bg)
            fuzz_row.pack(fill=tk.X, pady=(1, 0))
            tk.Label(
                fuzz_row, text="Fuzz Match:", font=self.font_small,
                fg=C["text_dim"], bg=row_bg, width=12, anchor=tk.W,
            ).pack(side=tk.LEFT)
            fuzz_bar = AccuracyBar(fuzz_row, bar_width=260, bar_height=16)
            fuzz_bar.pack(side=tk.LEFT, padx=(4, 0))
            fuzz_bar.set_value(det["match_score"], "Fuzzy")

    # ──────────────────────────────────────────────────────────────────
    # Stats
    # ──────────────────────────────────────────────────────────────────

    def _update_stats(self, detections: list[dict]):
        self.scan_count += 1
        self.total_detections += len(detections)
        matched_count = sum(1 for d in detections if d["matched_name"])
        self.total_matches += matched_count

        self.lbl_scans.configure(text=str(self.scan_count))
        self.lbl_detections.configure(text=str(self.total_detections))
        self.lbl_matches.configure(text=str(self.total_matches))

        if self.total_detections > 0:
            rate = (self.total_matches / self.total_detections) * 100
            self.lbl_accuracy.configure(
                text=f"{rate:.1f}%",
                fg=C["green"] if rate >= 70 else C["yellow"] if rate >= 40 else C["red"],
            )

    # ──────────────────────────────────────────────────────────────────
    # Capture actions
    # ──────────────────────────────────────────────────────────────────

    def _single_snap(self):
        """Run a single OCR capture and display results."""
        if not self.engine:
            self._set_status("Engine not ready yet", C["red"])
            return

        self._set_status("Capturing...", C["yellow"])

        def do_snap():
            try:
                pil_img, detections = self.engine.capture_and_recognise()
                self.root.after(0, lambda: self._on_results(pil_img, detections))
                self.root.after(0, lambda: self._set_status("Snap complete", C["green"]))
            except Exception as exc:
                self.root.after(0, lambda: self._set_status(f"Error: {exc}", C["red"]))
                self.root.after(0, lambda: self._log(f"Snap error: {exc}", "error"))

        threading.Thread(target=do_snap, daemon=True).start()

    def _toggle_capture(self):
        """Start or stop continuous capture."""
        if self.running:
            self.running = False
            self._set_status("Stopping...", C["yellow"])
            # Update button text
            for w in self.start_btn.winfo_children():
                if isinstance(w, tk.Label):
                    w.configure(text="▶  Start", fg=C["green"])
        else:
            if not self.engine:
                self._set_status("Engine not ready yet", C["red"])
                return
            self.running = True
            # Update button text
            for w in self.start_btn.winfo_children():
                if isinstance(w, tk.Label):
                    w.configure(text="⏹  Stop", fg=C["red"])
            self._set_status("Running...", C["green"])
            self._log("Continuous capture started", "info")
            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.capture_thread.start()

    def _capture_loop(self):
        """Background loop for continuous capture — instant detection."""
        config = load_config()

        # Optionally load server sender
        try:
            from server_sender import ServerSender
            sender = ServerSender(config)
        except Exception:
            sender = None

        last_sent_names: set[str] = set()

        while self.running:
            try:
                pil_img, detections = self.engine.capture_and_recognise()

                # Update UI from main thread (instant)
                self.root.after(0, lambda pi=pil_img, d=detections: self._on_results(pi, d))

                # Send to server — FIRE AND FORGET in a separate thread
                # This never blocks the capture loop
                if sender and detections:
                    matched = [d for d in detections if d["matched_name"]]
                    current_names = {d["matched_name"] for d in matched}
                    if matched and current_names != last_sent_names:
                        last_sent_names = current_names
                        # Fire-and-forget: spawn a thread for the HTTP request
                        threading.Thread(
                            target=self._send_async,
                            args=(sender, list(matched)),
                            daemon=True,
                        ).start()

            except Exception as exc:
                self.root.after(0, lambda: self._log(f"Capture error: {exc}", "error"))

            # No sleep — run as fast as OCR can process
            # (PaddleOCR typically takes 50-200ms per frame, which is the natural throttle)

        self.root.after(0, lambda: self._set_status("Stopped", C["text_dim"]))
        self.root.after(0, lambda: self._log("Continuous capture stopped", "info"))

    def _send_async(self, sender, matched: list[dict]):
        """Send detections to server in a background thread (non-blocking)."""
        try:
            ok = sender.send(matched)
            tag = "info" if ok else "error"
            msg = f"Sent {len(matched)} name(s) to server" if ok else "Server send failed"
            self.root.after(0, lambda m=msg, t=tag: self._log(m, t))
        except Exception as exc:
            self.root.after(0, lambda: self._log(f"Server error: {exc}", "error"))

    def _on_results(self, pil_img: Image.Image, detections: list[dict]):
        """Handle new OCR results (called from main thread)."""
        self._update_preview(pil_img)
        self._update_detections(detections)
        self._update_stats(detections)

        # Log each detection
        if detections:
            for det in detections:
                if det["matched_name"]:
                    self._log(
                        f'"{det["raw_text"]}" → {det["matched_name"]}  '
                        f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)',
                        "match",
                    )
                else:
                    self._log(
                        f'"{det["raw_text"]}" → no match  '
                        f'(conf={det["confidence"]:.0%}, fuzz={det["match_score"]}%)',
                        "nomatch",
                    )
        else:
            self._log("No text detected", "dim")

    # ──────────────────────────────────────────────────────────────────
    # Region selector
    # ──────────────────────────────────────────────────────────────────

    def _open_region_selector(self):
        """Launch the region selector, then reload config."""
        self.root.withdraw()  # Hide main window

        try:
            from region_selector import RegionSelector
            selector = RegionSelector()
            region = selector.run()

            if region:
                self._log(f"Region updated: {region}", "info")
                # Reload engine config
                if self.engine:
                    self.engine.reload_config()
                # Update region info display
                r = region
                region_text = (
                    f"Monitor {r.get('monitor_index', '?')}  •  "
                    f"{r.get('width', 0)}×{r.get('height', 0)}  •  "
                    f"({r.get('left', 0)}, {r.get('top', 0)})"
                )
                self.region_info_label.configure(text=region_text)
                self._set_status("Region updated", C["green"])
            else:
                self._log("Region selection cancelled", "dim")
        except Exception as exc:
            self._log(f"Region selector error: {exc}", "error")
        finally:
            self.root.deiconify()  # Show main window again

    # ──────────────────────────────────────────────────────────────────
    # Reload names
    # ──────────────────────────────────────────────────────────────────

    def _reload_names(self):
        if self.engine:
            self.engine.reload_player_names()
            count = len(self.engine.player_names)
            names = ", ".join(self.engine.player_names[:10])
            self._log(f"Reloaded {count} name(s): {names}", "info")
            self._set_status(f"Reloaded {count} player name(s)", C["green"])
        else:
            self._set_status("Engine not ready", C["red"])

    # ──────────────────────────────────────────────────────────────────
    # Close
    # ──────────────────────────────────────────────────────────────────

    def _on_close(self):
        self.running = False
        try:
            self.root.destroy()
        except Exception:
            pass

    # ──────────────────────────────────────────────────────────────────
    # Run
    # ──────────────────────────────────────────────────────────────────

    def run(self):
        # Use a polling loop instead of mainloop() so Ctrl+C works on Windows.
        # root.after() schedules a no-op callback every 200ms, which yields
        # control back to Python's signal handler between iterations.
        def _poll():
            self.root.after(200, _poll)

        self.root.after(200, _poll)

        try:
            self.root.mainloop()
        except KeyboardInterrupt:
            print("\n[FaceCam] Ctrl+C received - shutting down...")
            self._on_close()


# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import signal

    app = FaceCamApp()

    # On Windows, ensure SIGINT triggers a KeyboardInterrupt
    signal.signal(signal.SIGINT, signal.default_int_handler)

    app.run()
