# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
from PyInstaller.utils.hooks import copy_metadata

datas = []
binaries = [('C:\\Users\\THEMIS\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\0deeb2fec52624e647be__mypyc.cp312-win_amd64.pyd', '.')]
hiddenimports = ['paddleocr', 'paddle', 'paddlex', 'thefuzz', 'Levenshtein', 'mss', 'requests', 'PIL', 'PIL._imaging', 'shapely', 'shapely.geometry', 'pyclipper', 'skimage', 'skimage.morphology', 'skimage.filters', 'cv2', 'lmdb', 'rapidfuzz', 'scipy', 'scipy.special', 'numpy', 'paddle.base', 'paddle.base.core', 'paddle.utils', 'paddlex.utils', 'paddlex.pipelines', 'paddlex.modules', 'paddleocr.paddleocr']
datas += copy_metadata('paddleocr')
datas += copy_metadata('paddlex')
datas += copy_metadata('paddlepaddle')
datas += copy_metadata('pyclipper')
datas += copy_metadata('shapely')
datas += copy_metadata('Pillow')
datas += copy_metadata('numpy')
datas += copy_metadata('opencv-python')
datas += copy_metadata('packaging')
tmp_ret = collect_all('paddleocr')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('paddle')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('paddlex')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('shapely')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('skimage')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('scipy')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['D:\\Esports Works\\Free Fire\\Free Fire API\\FaceCam\\facecam_backend.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['D:\\Esports Works\\Free Fire\\Free Fire API\\FaceCam\\app\\src-tauri\\icons\\icon.ico'],
)
