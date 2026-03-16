/**
 * Builds FaceCam_Backend.exe via PyInstaller and copies it into the
 * Tauri `binaries/` directory so `tauri build` can bundle it via externalBin.
 *
 * Always rebuilds — old dist/, build/, and the destination exe are deleted first.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const appDir      = path.resolve(__dirname, '..');
const facecamDir  = path.resolve(appDir, '..');
const binariesDir = path.join(appDir, 'src-tauri', 'binaries');
const backendDst  = path.join(binariesDir, 'FaceCam_Backend-x86_64-pc-windows-msvc.exe');
const distDir     = path.join(facecamDir, 'dist');
const buildDir    = path.join(facecamDir, 'build');
const backendSrc  = path.join(distDir, 'FaceCam_Backend.exe');

// ── 1. Clean old Tauri bundle artifacts ───────────────────────────────────
const tauriBundleDir = path.join(appDir, 'src-tauri', 'target', 'release', 'bundle');
if (fs.existsSync(tauriBundleDir)) {
  fs.rmSync(tauriBundleDir, { recursive: true, force: true });
  console.log('[build-backend] Cleaned old Tauri bundle artifacts.');
}

// ── 2. Always delete old PyInstaller output so we build fresh ─────────────
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('[build-backend] Deleted old dist/ directory.');
}
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
  console.log('[build-backend] Deleted old build/ directory.');
}
if (fs.existsSync(backendDst)) {
  fs.rmSync(backendDst);
  console.log('[build-backend] Deleted old backend exe from binaries/.');
}

// ── 3. Run PyInstaller ────────────────────────────────────────────────────
console.log('\n[build-backend] Running PyInstaller...\n');
try {
  execSync('python -m PyInstaller facecam_backend.spec --noconfirm', {
    cwd: facecamDir,
    stdio: 'inherit',
  });
} catch (e) {
  console.error('[build-backend] PyInstaller failed.');
  process.exit(1);
}

// ── 4. Copy to Root and Verify ──────────────────────────────────────────────
if (!fs.existsSync(backendSrc)) {
  console.error(`[build-backend] Expected output not found: ${backendSrc}`);
  process.exit(1);
}

const rootBackendPath = path.join(facecamDir, 'FaceCam_Backend.exe');
fs.copyFileSync(backendSrc, rootBackendPath);

console.log(`\n[build-backend] Backend built successfully at: ${rootBackendPath}\n`);
