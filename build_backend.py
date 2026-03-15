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

import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent

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
        "--name", "FaceCam_Backend",
        # Hidden imports that PyInstaller may miss
        "--hidden-import", "paddleocr",
        "--hidden-import", "paddle",
        "--hidden-import", "thefuzz",
        "--hidden-import", "Levenshtein",
        "--hidden-import", "mss",
        "--hidden-import", "requests",
        "--hidden-import", "PIL",
        # Collect the full paddleocr & paddle package data
        "--collect-all", "paddleocr",
        "--collect-all", "paddle",
        # Entry point
        str(BASE_DIR / "facecam_backend.py"),
    ]

    print(f"\n  Running PyInstaller...\n")
    result = subprocess.run(cmd, cwd=str(BASE_DIR))

    if result.returncode == 0:
        exe_path = dist / "FaceCam_Backend.exe"
        if exe_path.exists():
            # Copy to root as well for convenience
            shutil.copy2(exe_path, BASE_DIR / "FaceCam_Backend.exe")
            
            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"\n{'=' * 60}")
            print(f"  ✅  BUILD SUCCESS")
            print(f"  Output:  {exe_path}")
            print(f"  Root:    {BASE_DIR / 'FaceCam_Backend.exe'}")
            print(f"  Size:    {size_mb:.1f} MB")
            print(f"{'=' * 60}")
        else:
            print("\n  ⚠  Build completed but exe not found at expected path.")
    else:
        print(f"\n  ❌  BUILD FAILED (exit code: {result.returncode})")
    
    # Import shutil here just in case it's needed for copy2
    import shutil


if __name__ == "__main__":
    build()
