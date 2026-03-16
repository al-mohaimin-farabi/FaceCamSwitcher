"""
Build Script — Bundle FaceCam backend into a standalone executable.

Run:  python build_backend.py

This creates FaceCam_Backend.exe that includes:
  • main OCR capture loop
  • region selector
  • OCR engine (PaddleOCR)
  • server sender

The resulting .exe plus config.json and Players Name.txt is all
that end users need — no Python installation required.
"""

import glob
import shutil
import site
import struct
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent

ICON_PATH = BASE_DIR / "app" / "src-tauri" / "icons" / "icon.ico"
TAURI_BINARY = (
    BASE_DIR / "app" / "src-tauri" / "binaries"
    / "FaceCam_Backend-x86_64-pc-windows-msvc.exe"
)


def _stamp_icon(exe_path: Path, ico_path: Path) -> None:
    """
    Embed ico_path as the main application icon into exe_path using the
    Windows UpdateResource API (win32api).  Works on any PE binary regardless
    of how it was built.

    The .ico file may contain multiple images (sizes/depths).  We write each
    individual image as RT_ICON and then write a GRPICONDIR (RT_GROUP_ICON)
    that references them — exactly what MSVC / rc.exe does at compile time.
    """
    import win32api
    import win32con

    # ── Parse the .ico file ──────────────────────────────────────────────────
    ico_data = ico_path.read_bytes()

    # ICONDIR header: reserved(2) type(2) count(2)
    reserved, ico_type, count = struct.unpack_from("<HHH", ico_data, 0)
    if ico_type != 1:
        raise ValueError(f"Not a valid .ico file: {ico_path}")

    images = []
    for i in range(count):
        offset = 6 + i * 16
        # ICONDIRENTRY: width(1) height(1) colorCount(1) reserved(1)
        #               planes(2) bitCount(2) bytesInRes(4) imageOffset(4)
        w, h, color_count, res, planes, bit_count, bytes_in_res, image_offset = \
            struct.unpack_from("<BBBBHHII", ico_data, offset)
        image_data = ico_data[image_offset: image_offset + bytes_in_res]
        images.append({
            "width": w, "height": h, "color_count": color_count,
            "reserved": res, "planes": planes, "bit_count": bit_count,
            "data": image_data,
        })

    # ── Build GRPICONDIR (the RT_GROUP_ICON resource) ────────────────────────
    # Header: reserved(2) type(2) count(2)
    grp = struct.pack("<HHH", 0, 1, len(images))
    for idx, img in enumerate(images, start=1):
        # GRPICONDIRENTRY: width(1) height(1) colorCount(1) reserved(1)
        #                  planes(2) bitCount(2) bytesInRes(4) id(2)
        grp += struct.pack(
            "<BBBBHHIH",
            img["width"], img["height"], img["color_count"], img["reserved"],
            img["planes"], img["bit_count"], len(img["data"]), idx,
        )

    # ── Write resources into the exe ─────────────────────────────────────────
    handle = win32api.BeginUpdateResource(str(exe_path), False)
    try:
        # Write each RT_ICON image (id = 1-based index)
        for idx, img in enumerate(images, start=1):
            win32api.UpdateResource(handle, win32con.RT_ICON, idx, img["data"])
        # Write the group icon under id 1
        win32api.UpdateResource(handle, win32con.RT_GROUP_ICON, 1, grp)
    except Exception:
        win32api.EndUpdateResource(handle, True)   # discard on error
        raise
    win32api.EndUpdateResource(handle, False)      # commit


def _find_mypyc_binaries() -> list[str]:
    """
    Collect mypyc .pyd files that sit directly in site-packages root.
    PyInstaller's --collect-all misses these because they have no package owner.
    Returns a list of --add-binary args: "src;." (copy to exe root).
    """
    args = []
    for sp in site.getsitepackages():
        for pyd in glob.glob(str(Path(sp) / "*mypyc*.pyd")):
            args += ["--add-binary", f"{pyd};."]
    return args


def build():
    print("=" * 60)
    print("  Building FaceCam Backend  →  FaceCam_Backend.exe")
    print("=" * 60)

    # Clean previous builds
    dist = BASE_DIR / "dist"
    build_dir = BASE_DIR / "build"
    for d in [dist, build_dir]:
        if d.exists():
            import shutil
            shutil.rmtree(d);
            print(f"  Cleaned: {d.name}/")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--console",       # need console for log output to Tauri
        "--icon", str(ICON_PATH),
        "--name", "FaceCam_Backend",
        # Hidden imports that PyInstaller may miss
        "--hidden-import", "paddleocr",
        "--hidden-import", "paddle",
        "--hidden-import", "thefuzz",
        "--hidden-import", "Levenshtein",
        "--hidden-import", "mss",
        "--hidden-import", "requests",
        "--hidden-import", "PIL",
        # Collect the full paddleocr, paddle & paddlex package data
        # paddlex must be collected so its configs/pipelines/*.yaml files are
        # bundled — PaddleOCR 3.x resolves pipeline configs via __file__ inside
        # paddlex, which breaks in a frozen exe without this.
        "--collect-all", "paddleocr",
        "--collect-all", "paddle",
        "--collect-all", "paddlex",
        # mypyc .pyd files that live in site-packages root (PyInstaller misses them)
        *_find_mypyc_binaries(),
        # Entry point
        str(BASE_DIR / "facecam_backend.py"),
    ]

    print(f"\n  Running PyInstaller...\n")
    result = subprocess.run(cmd, cwd=str(BASE_DIR))

    if result.returncode == 0:
        exe_path = dist / "FaceCam_Backend.exe"
        if exe_path.exists():
            root_exe = BASE_DIR / "FaceCam_Backend.exe"
            shutil.copy2(exe_path, root_exe)

            # Stamp the icon onto every copy of the backend exe
            targets = [exe_path, root_exe]
            if TAURI_BINARY.exists():
                shutil.copy2(exe_path, TAURI_BINARY)
                targets.append(TAURI_BINARY)

            if ICON_PATH.exists():
                print("\n  Stamping icon onto backend executables...")
                for target in targets:
                    try:
                        _stamp_icon(target, ICON_PATH)
                        print(f"    ✔  {target.name}")
                    except Exception as e:
                        print(f"    ⚠  Icon stamp failed for {target.name}: {e}")

            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"\n{'=' * 60}")
            print(f"  ✅  BUILD SUCCESS")
            print(f"  Output:  {exe_path}")
            print(f"  Tauri:   {TAURI_BINARY}")
            print(f"  Size:    {size_mb:.1f} MB")
            print(f"{'=' * 60}")
        else:
            print("\n  ⚠  Build completed but exe not found at expected path.")
    else:
        print(f"\n  ❌  BUILD FAILED (exit code: {result.returncode})")


if __name__ == "__main__":
    build()
