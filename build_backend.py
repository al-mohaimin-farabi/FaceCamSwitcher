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
        "--name", "FaceCam_Backend",
        # Hidden imports that PyInstaller may miss
        "--hidden-import", "paddleocr",
        "--hidden-import", "paddle",
        "--hidden-import", "paddlex",
        "--hidden-import", "thefuzz",
        "--hidden-import", "Levenshtein",
        "--hidden-import", "mss",
        "--hidden-import", "requests",
        "--hidden-import", "pycocotools",
        "--hidden-import", "PIL",
        "--hidden-import", "PIL._imaging",
        "--hidden-import", "shapely",
        "--hidden-import", "shapely.geometry",
        "--hidden-import", "pyclipper",
        "--hidden-import", "skimage",
        "--hidden-import", "skimage.morphology",
        "--hidden-import", "skimage.filters",
        "--hidden-import", "cv2",
        "--hidden-import", "lxml",
        "--hidden-import", "lxml.etree",
        "--hidden-import", "lxml.html",
        "--hidden-import", "lmdb",
        "--hidden-import", "rapidfuzz",
        "--hidden-import", "scipy",
        "--hidden-import", "scipy.special",
        "--hidden-import", "numpy",
        "--hidden-import", "paddle.base",
        "--hidden-import", "paddle.base.core",
        "--hidden-import", "paddle.utils",
        "--hidden-import", "paddlex.utils",
        "--hidden-import", "paddlex.pipelines",
        "--hidden-import", "paddlex.modules",
        "--hidden-import", "paddleocr.paddleocr",
        # Audio / signal processing deps pulled in by paddleocr/paddlex
        "--hidden-import", "soundfile",
        "--hidden-import", "sounddevice",
        "--hidden-import", "librosa",
        "--hidden-import", "resampy",
        "--hidden-import", "audioread",
        # Other commonly-missed paddleocr deps
        "--hidden-import", "filelock",
        "--hidden-import", "huggingface_hub",
        "--hidden-import", "tqdm",
        "--hidden-import", "yaml",
        "--hidden-import", "omegaconf",
        "--hidden-import", "antlr4",
        "--hidden-import", "ftfy",
        "--hidden-import", "regex",
        "--hidden-import", "sentencepiece",
        "--hidden-import", "prettytable",
        "--hidden-import", "func_timeout",
        "--hidden-import", "paddle.dataset",
        "--hidden-import", "paddle.metric",
        # Collect the full paddleocr, paddle & paddlex package data
        # paddlex must be collected so its configs/pipelines/*.yaml files are
        # bundled — PaddleOCR 3.x resolves pipeline configs via __file__ inside
        # paddlex, which breaks in a frozen exe without this.
        '--copy-metadata', 'paddlex', # Copy paddlex metadata
        "--collect-all", "paddleocr",
        "--collect-all", "paddle",
        "--collect-all", "paddlex",
        "--collect-all", "shapely",
        "--collect-all", "skimage",
        "--collect-all", "scipy",
        "--collect-all", "soundfile",
        "--collect-all", "lxml",
        "--collect-all", "librosa",
        # Copy package metadata so importlib.metadata works inside the frozen exe.
        # Without this, paddlex's dependency checker (is_dep_available) fails
        # because it cannot find .dist-info directories.
        "--copy-metadata", "paddleocr",
        "--copy-metadata", "paddlex",
        "--copy-metadata", "paddlepaddle",
        "--copy-metadata", "pyclipper",
        "--copy-metadata", "shapely",
        "--copy-metadata", "Pillow",
        "--copy-metadata", "numpy",
        "--copy-metadata", "opencv-python",
        "--copy-metadata", "packaging",
        # Note: soundfile has no .dist-info on this system — metadata copy skipped,
        # but the module itself is collected via --collect-all soundfile above.
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

            size_mb = exe_path.stat().st_size / (1024 * 1024)
            print(f"\n{'=' * 60}")
            print(f"  ✅  BUILD SUCCESS")
            print(f"  Output:  {exe_path}")
            print(f"  Root:    {root_exe}")
            print(f"  Size:    {size_mb:.1f} MB")
            print(f"{'=' * 60}")
        else:
            print("\n  ⚠  Build completed but exe not found at expected path.")
    else:
        print(f"\n  ❌  BUILD FAILED (exit code: {result.returncode})")


if __name__ == "__main__":
    build()
