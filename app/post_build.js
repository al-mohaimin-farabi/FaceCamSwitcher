import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');

// The PCOB debugger build has no native OCR runtime dependencies (no ONNX
// models, no DirectML.dll). We only stage the standalone exe to the repo root
// for quick local runs.
const filesToCopy = [
    {
        source: path.join(__dirname, 'src-tauri', 'target', 'release', 'efinity-facecam.exe'),
        target: path.join(rootDir, 'FaceCam.exe'),
        label: 'FaceCam.exe (Tauri App)',
    },
];

console.log('[POST-BUILD] Starting copy process...');

for (const file of filesToCopy) {
    try {
        if (fs.existsSync(file.source)) {
            fs.copyFileSync(file.source, file.target);
            console.log(`[POST-BUILD] Copied ${file.label}`);
        } else {
            console.warn(`[POST-BUILD] Source not found (skipped): ${file.source}`);
        }
    } catch (e) {
        console.error(`[POST-BUILD] Failed to copy ${file.label}:`, e.message);
    }
}

console.log('[POST-BUILD] Done.');
