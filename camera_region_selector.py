"""
Camera Region Selector — Interactive region picker over a live camera/virtual camera feed.

Opens a window showing the live feed from the selected camera (e.g. OBS Virtual Camera,
vMix Virtual Input) and lets the user draw a rectangle to select the capture region.
The selected region is saved to config.json so ocr_engine.py uses it on the next capture.

Supports OBS Virtual Camera, vMix, NDI Virtual Input, and any DirectShow device.
"""

import json
import os
import sys
import tkinter as tk
from pathlib import Path

# ── Force DPI Awareness on Windows ──────────────────────────────────
if os.name == 'nt':
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

CONFIG_PATH = Path(__file__).parent / "config.json"

# ── Style constants ──────────────────────────────────────────────────
RECT_OUTLINE = "#00d4ff"
RECT_DASH = (6, 4)
RECT_WIDTH = 2
INFO_FONT = ("Consolas", 12)
TITLE_FONT = ("Consolas", 14, "bold")
PREVIEW_W = 1280
PREVIEW_H = 720


class CameraRegionSelector:
    """Shows a live camera feed and lets the user draw a capture region."""

    def __init__(self, camera_index: int = 0):
        self.camera_index = camera_index
        self.selected_region = None
        self._running = True

        # Try to open the camera
        try:
            import cv2
            self.cv2 = cv2
        except ImportError:
            raise RuntimeError("opencv-python is required: pip install opencv-python")

        self.cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(
                f"Cannot open camera index {camera_index}. "
                "Make sure the virtual camera (OBS, vMix) is running before selecting a region."
            )

        # Attempt to capture at a decent resolution
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

        # Read one frame to get actual dimensions
        for _ in range(5):
            self.cap.grab()
        ret, frame = self.cap.read()
        if not ret or frame is None:
            self.cap.release()
            raise RuntimeError(f"Could not read a frame from camera {camera_index}.")

        self.cam_w = frame.shape[1]
        self.cam_h = frame.shape[0]

        # Scale factor: fit the camera frame into the preview window
        scale_x = PREVIEW_W / self.cam_w
        scale_y = PREVIEW_H / self.cam_h
        self.scale = min(scale_x, scale_y, 1.0)  # never upscale beyond 1:1

        self.disp_w = int(self.cam_w * self.scale)
        self.disp_h = int(self.cam_h * self.scale)

        # ── Build Tkinter UI ─────────────────────────────────────────
        self.root = tk.Tk()
        self.root.title(f"FaceCam — Select Region from Camera {camera_index}")
        self.root.configure(bg="#0d1117")
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)

        # Info label
        info = tk.Label(
            self.root,
            text="Click & drag to select the OCR capture region   •   Press ESC to cancel",
            font=INFO_FONT,
            fg="#aaaaaa",
            bg="#0d1117",
            pady=6,
        )
        info.pack(fill=tk.X)

        # Camera label (source info)
        src_label = tk.Label(
            self.root,
            text=f"Camera {camera_index}  •  {self.cam_w}×{self.cam_h}  (preview at {self.disp_w}×{self.disp_h})",
            font=("Consolas", 10),
            fg="#58a6ff",
            bg="#0d1117",
            pady=2,
        )
        src_label.pack(fill=tk.X)

        # Canvas for live feed
        self.canvas = tk.Canvas(
            self.root,
            width=self.disp_w,
            height=self.disp_h,
            bg="#000000",
            highlightthickness=1,
            highlightbackground="#30363d",
            cursor="crosshair",
        )
        self.canvas.pack(padx=12, pady=(4, 12))

        # Rubber-band state
        self.start_x = 0
        self.start_y = 0
        self.rect_id = None
        self.coord_id = None
        self._photo = None  # keep reference

        # Bindings
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.root.bind("<Escape>", self._on_cancel)

        self.root.protocol("WM_DELETE_WINDOW", self._on_cancel)

        # Start live preview loop
        self._update_frame()

    # ─── Live frame update ───────────────────────────────────────────

    def _update_frame(self):
        """Grab a new frame and draw it on the canvas every ~33ms (≈30fps)."""
        if not self._running:
            return
        try:
            ret, frame = self.cap.read()
            if ret and frame is not None:
                import cv2
                # Resize to display size
                disp = cv2.resize(frame, (self.disp_w, self.disp_h))
                # Convert BGR → RGB
                disp_rgb = cv2.cvtColor(disp, cv2.COLOR_BGR2RGB)
                from PIL import Image, ImageTk
                pil_img = Image.fromarray(disp_rgb)
                self._photo = ImageTk.PhotoImage(pil_img)
                self.canvas.create_image(0, 0, anchor=tk.NW, image=self._photo, tags="frame")
                self.canvas.tag_lower("frame")  # keep frame behind the selection rect
        except Exception:
            pass
        self.root.after(33, self._update_frame)

    # ─── Mouse events ────────────────────────────────────────────────

    def _on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        if self.rect_id:
            self.canvas.delete(self.rect_id)
            self.rect_id = None
        if self.coord_id:
            self.canvas.delete(self.coord_id)
            self.coord_id = None

    def _on_drag(self, event):
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        if self.coord_id:
            self.canvas.delete(self.coord_id)

        self.rect_id = self.canvas.create_rectangle(
            self.start_x, self.start_y, event.x, event.y,
            outline=RECT_OUTLINE, width=RECT_WIDTH, dash=RECT_DASH,
            tags="overlay",
        )
        w = abs(event.x - self.start_x)
        h = abs(event.y - self.start_y)
        self.coord_id = self.canvas.create_text(
            min(self.start_x, event.x),
            min(self.start_y, event.y) - 6,
            anchor=tk.SW,
            text=f"{w} x {h}",
            fill=RECT_OUTLINE,
            font=INFO_FONT,
            tags="overlay",
        )

    def _on_release(self, event):
        # Convert display coords → camera coords
        inv = 1.0 / self.scale if self.scale > 0 else 1.0

        x1_disp = min(self.start_x, event.x)
        y1_disp = min(self.start_y, event.y)
        x2_disp = max(self.start_x, event.x)
        y2_disp = max(self.start_y, event.y)

        if (x2_disp - x1_disp) < 5 or (y2_disp - y1_disp) < 5:
            print("[CameraRegionSelector] Selection too small, ignoring.")
            return

        x1 = int(x1_disp * inv)
        y1 = int(y1_disp * inv)
        x2 = int(x2_disp * inv)
        y2 = int(y2_disp * inv)

        # Clamp to camera frame
        x1 = max(0, min(x1, self.cam_w))
        y1 = max(0, min(y1, self.cam_h))
        x2 = max(0, min(x2, self.cam_w))
        y2 = max(0, min(y2, self.cam_h))

        self.selected_region = {
            "left": x1,
            "top": y1,
            "width": x2 - x1,
            "height": y2 - y1,
        }

        print(f"\n[CameraRegionSelector] Selected region:")
        print(f"  Camera : {self.camera_index}")
        print(f"  Left   : {x1}")
        print(f"  Top    : {y1}")
        print(f"  Width  : {x2 - x1}")
        print(f"  Height : {y2 - y1}")

        self._save_to_config()
        self._cleanup()

    def _on_cancel(self, _event=None):
        print("[CameraRegionSelector] Cancelled.")
        self._cleanup()

    # ─── Persistence ─────────────────────────────────────────────────

    def _save_to_config(self):
        """Write the selected region into config.json under input_source.window_region."""
        config = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)

        config.setdefault("input_source", {})
        config["input_source"]["window_region"] = {
            "left": self.selected_region["left"],
            "top": self.selected_region["top"],
            "width": self.selected_region["width"],
            "height": self.selected_region["height"],
        }

        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)

        print(f"[CameraRegionSelector] Region saved to {CONFIG_PATH}")

    # ─── Cleanup ─────────────────────────────────────────────────────

    def _cleanup(self):
        self._running = False
        try:
            self.cap.release()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass

    # ─── Public API ──────────────────────────────────────────────────

    def run(self):
        """Show the selector and block until the user makes a selection or cancels."""
        self.root.mainloop()
        return self.selected_region


# ── Direct execution ────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Select a region from a camera feed")
    parser.add_argument("--camera-index", type=int, default=0, help="Camera device index")
    args = parser.parse_args()

    selector = CameraRegionSelector(camera_index=args.camera_index)
    region = selector.run()
    if region:
        print("\n[SUCCESS] Camera region saved! You can now run the app.")
    else:
        print("\n[CANCELLED] No region was selected.")
