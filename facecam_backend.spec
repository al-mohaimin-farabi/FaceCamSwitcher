# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for FaceCam_Backend.exe
# Run from the FaceCam\ directory:
#   pyinstaller facecam_backend.spec
#

import sys
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs

datas    = []
binaries = []
hiddenimports = []

# ── PaddleOCR + PaddleX (required by PaddleOCR v3) ───────────────────
for pkg in ('paddleocr', 'paddlex', 'paddle'):
    try:
        d, b, h = collect_all(pkg)
        datas    += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# ── OpenCV ────────────────────────────────────────────────────────────
try:
    d, b, h = collect_all('cv2')
    datas += d; binaries += b; hiddenimports += h
except Exception:
    pass

# ── mss (screen capture) ──────────────────────────────────────────────
try:
    d, b, h = collect_all('mss')
    datas += d; binaries += b; hiddenimports += h
except Exception:
    pass

# ── Pillow ────────────────────────────────────────────────────────────
try:
    d, b, h = collect_all('PIL')
    datas += d; binaries += b; hiddenimports += h
except Exception:
    pass

# ── Matplotlib (needed by paddleocr; collect fully so Agg backend is present) ──
try:
    d, b, h = collect_all('matplotlib')
    datas += d; binaries += b; hiddenimports += h
except Exception:
    pass

# ── Explicit hidden imports ───────────────────────────────────────────
hiddenimports += [
    # Windows capture
    'win32gui', 'win32ui', 'win32con', 'win32api', 'pywintypes',
    # Camera enumeration
    'pygrabber', 'pygrabber.dshow_graph',
    # Fuzzy matching
    'thefuzz', 'thefuzz.fuzz', 'thefuzz.process', 'Levenshtein',
    # Image
    'PIL', 'PIL.Image', 'PIL.ImageEnhance', 'PIL.ImageFilter',
    # Screen capture
    'mss', 'mss.windows',
    # HTTP
    'requests', 'urllib3', 'certifi', 'charset_normalizer', 'idna',
    # Numpy
    'numpy', 'numpy.core', 'numpy.lib',
    # Paddle internals
    'paddle', 'paddle.fluid', 'paddle.nn', 'paddle.optimizer',
    # Shapely (paddleocr dep)
    'shapely', 'shapely.geometry',
    # Sklearn (paddleocr dep)
    'sklearn', 'sklearn.utils', 'sklearn.metrics',
    # Other paddleocr deps
    'lmdb', 'imgaug', 'pyclipper',
]

a = Analysis(
    ['facecam_backend.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Exclude heavy GUI / ML libs we don't need
    excludes=[
        'tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
        'wx', 'IPython', 'jupyter', 'notebook',
        'tensorflow', 'torch', 'torchvision',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FaceCam_Backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,           # UPX can break paddle DLLs — keep off
    console=True,        # Must be True: Tauri reads stdout/stderr
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)