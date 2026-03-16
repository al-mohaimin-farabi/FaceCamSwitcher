/**
 * Builds FaceCam_Backend.exe via PyInstaller and copies it into the
 * Tauri `binaries/` directory so `tauri build` can bundle it via externalBin.
 *
 * Pass --force to rebuild even if the exe already exists.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const appDir      = path.resolve(__dirname, '..');
const facecamDir  = path.resolve(appDir, '..');
const binariesDir = path.join(appDir, 'src-tauri', 'binaries');
const backendSrc  = path.join(facecamDir, 'dist', 'FaceCam_Backend.exe');
const backendDst  = path.join(binariesDir, 'FaceCam_Backend-x86_64-pc-windows-msvc.exe');
const force       = process.argv.includes('--force');

// ── Clean old installer artifacts so stale builds never ship ──────────────
const bundleDir = path.join(appDir, 'src-tauri', 'target', 'release', 'bundle');
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
  console.log('[build-backend] Cleaned old bundle artifacts.');
}

// ── Build or reuse FaceCam_Backend.exe ────────────────────────────────────
if (!force && fs.existsSync(backendDst)) {
  console.log('[build-backend] Backend exe already exists — skipping PyInstaller. (pass --force to rebuild)');
} else {
  if (force && fs.existsSync(backendDst)) {
    fs.rmSync(backendDst);
    console.log('[build-backend] Removed old backend exe (--force).');
  }

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

  if (!fs.existsSync(backendSrc)) {
    console.error(`[build-backend] Expected output not found: ${backendSrc}`);
    process.exit(1);
  }

  fs.mkdirSync(binariesDir, { recursive: true });
  fs.copyFileSync(backendSrc, backendDst);
  console.log(`\n[build-backend] Backend ready: ${backendDst}\n`);
}
