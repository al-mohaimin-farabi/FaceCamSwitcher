"""
Region Selector — Interactive screen region picker with multi-monitor support.

Launch this script directly to pick a capture region.
It creates a semi-transparent overlay across ALL monitors and lets you
draw a rectangle on any of them.  The selected region (including which
monitor it belongs to) is saved to config.json automatically.

Supports up to 4 monitors.
"""

import json
import os
import sys
import tkinter as tk
from pathlib import Path

import mss

# ── Force DPI Awareness on Windows (Critical for multi-monitor scaling) ──
if os.name == 'nt':
    try:
        import ctypes
        # Set DPI awareness for Windows 8.1+ -> Per-Monitor DPI aware
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception as e:
        print(f"[RegionSelector] Could not set DPI awareness: {e}")

# ──────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent / "config.json"
OVERLAY_COLOR = "#1a1a2e"       # dark navy -- used as the tint
OVERLAY_ALPHA = 0.35            # 35 % opacity for the overlay
RECT_OUTLINE = "#00d4ff"        # cyan selection rectangle
RECT_DASH = (6, 4)
RECT_WIDTH = 2
INFO_FONT = ("Consolas", 12)
TITLE_FONT = ("Consolas", 16, "bold")


class RegionSelector:
    """Full-screen transparent overlay to select a screen region."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("FaceCam — Region Selector")
        self.root.attributes("-topmost", True)

        # ── Detect monitors via mss ──────────────────────────────────
        with mss.mss() as sct:
            # monitors[0] is the combined virtual screen
            self.virtual = sct.monitors[0]
            # individual monitors - Sort by physical position (Left -> Right)
            # to match Windows display numbering convention
            self.monitors = sorted(sct.monitors[1:], key=lambda m: (m['left'], m['top']))

        print(f"[RegionSelector] Detected {len(self.monitors)} monitor(s):")
        for i, m in enumerate(self.monitors, 1):
            print(f"  Monitor {i}: {m['width']}x{m['height']} @ ({m['left']}, {m['top']})")

        # ── Make the window span the entire virtual desktop ──────────
        vx = self.virtual["left"]
        vy = self.virtual["top"]
        vw = self.virtual["width"]
        vh = self.virtual["height"]

        self.root.overrideredirect(True)
        self.root.geometry(f"{vw}x{vh}+{vx}+{vy}")
        self.root.attributes("-alpha", OVERLAY_ALPHA)

        # ── Canvas ───────────────────────────────────────────────────
        self.canvas = tk.Canvas(
            self.root, width=vw, height=vh,
            bg=OVERLAY_COLOR, highlightthickness=0, cursor="crosshair",
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        # ── Draw monitor boundaries & labels ─────────────────────────
        for i, m in enumerate(self.monitors, 1):
            x = m["left"] - vx
            y = m["top"] - vy
            w = m["width"]
            h = m["height"]
            # border
            self.canvas.create_rectangle(
                x, y, x + w, y + h,
                outline="#ffffff", width=1, dash=(3, 3),
            )
            # label
            self.canvas.create_text(
                x + 20, y + 20, anchor=tk.NW,
                text=f"Monitor {i}  ({w}x{h})",
                fill="#ffffff", font=TITLE_FONT,
            )

        # ── Instructions ─────────────────────────────────────────────
        self.canvas.create_text(
            vw // 2, vh - 40, anchor=tk.S,
            text="Click & drag to select a capture region  -  Press ESC to cancel",
            fill="#aaaaaa", font=INFO_FONT,
        )

        # ── State for rubber-band rectangle ──────────────────────────
        self.start_x = 0
        self.start_y = 0
        self.rect_id = None
        self.coord_text_id = None
        self.selected_region = None

        # ── Bindings ─────────────────────────────────────────────────
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.root.bind("<Escape>", self._on_cancel)
        self.canvas.bind("<Escape>", self._on_cancel)

        # Force keyboard focus (required for overrideredirect windows on Windows)
        self.root.focus_force()
        self.canvas.focus_set()

    # ─── Event handlers ──────────────────────────────────────────────

    def _on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        if self.coord_text_id:
            self.canvas.delete(self.coord_text_id)

    def _on_drag(self, event):
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        if self.coord_text_id:
            self.canvas.delete(self.coord_text_id)

        self.rect_id = self.canvas.create_rectangle(
            self.start_x, self.start_y, event.x, event.y,
            outline=RECT_OUTLINE, width=RECT_WIDTH, dash=RECT_DASH,
        )

        w = abs(event.x - self.start_x)
        h = abs(event.y - self.start_y)
        self.coord_text_id = self.canvas.create_text(
            min(self.start_x, event.x),
            min(self.start_y, event.y) - 6,
            anchor=tk.SW,
            text=f"{w} x {h}",
            fill=RECT_OUTLINE, font=INFO_FONT,
        )

    def _on_release(self, event):
        vx = self.virtual["left"]
        vy = self.virtual["top"]

        # Compute selection in absolute screen coords
        abs_x1 = min(self.start_x, event.x) + vx
        abs_y1 = min(self.start_y, event.y) + vy
        abs_x2 = max(self.start_x, event.x) + vx
        abs_y2 = max(self.start_y, event.y) + vy

        sel_w = abs_x2 - abs_x1
        sel_h = abs_y2 - abs_y1

        if sel_w < 10 or sel_h < 10:
            print("[RegionSelector] Selection too small, ignoring.")
            return

        # ── Determine which monitor the centre of selection is on ────
        cx = (abs_x1 + abs_x2) // 2
        cy = (abs_y1 + abs_y2) // 2
        
        monitor_index = 1
        # Use the same sorted list we created in __init__
        for i, m in enumerate(self.monitors, 1):
            if (m["left"] <= cx < m["left"] + m["width"] and
                    m["top"] <= cy < m["top"] + m["height"]):
                monitor_index = i
                break

        self.selected_region = {
            "monitor_index": monitor_index,
            "left": abs_x1,
            "top": abs_y1,
            "width": sel_w,
            "height": sel_h,
        }

        print(f"\n[RegionSelector] Selected region:")
        print(f"  Monitor : {monitor_index}")
        print(f"  Left    : {abs_x1}")
        print(f"  Top     : {abs_y1}")
        print(f"  Width   : {sel_w}")
        print(f"  Height  : {sel_h}")

        self._save_to_config()
        self.root.destroy()

    def _on_cancel(self, _event):
        print("[RegionSelector] Cancelled.")
        self.root.destroy()

    # ─── Persistence ─────────────────────────────────────────────────

    def _save_to_config(self):
        """Write the selected region into config.json."""
        config = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)

        config["capture_region"] = self.selected_region
        if "input_source" not in config:
            config["input_source"] = {}
        if "window_region" not in config["input_source"]:
            config["input_source"]["window_region"] = {}
        
        config["input_source"]["window_region"]["left"] = self.selected_region["left"]
        config["input_source"]["window_region"]["top"] = self.selected_region["top"]
        config["input_source"]["window_region"]["width"] = self.selected_region["width"]
        config["input_source"]["window_region"]["height"] = self.selected_region["height"]

        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)

        print(f"[RegionSelector] Region saved to {CONFIG_PATH}")

    # ─── Public API ──────────────────────────────────────────────────

    def run(self):
        """Show the overlay and block until the user makes a selection."""
        self.root.mainloop()
        return self.selected_region


# ──────────────────────────────────────────────────────────────────────
# Direct execution
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    selector = RegionSelector()
    region = selector.run()
    if region:
        print("\n[SUCCESS] Region saved successfully! You can now run the app.")
    else:
        print("\n[CANCELLED] No region was selected.")
