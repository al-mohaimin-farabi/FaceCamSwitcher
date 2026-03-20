import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');

// Files to copy to the project root
const filesToCopy = [
    {
        source: path.join(__dirname, 'src-tauri', 'target', 'release', 'efinity-facecam.exe'),
        target: path.join(rootDir, 'FaceCam.exe'),
        label: 'FaceCam.exe (Tauri App)',
    },
    {
        source: path.join(__dirname, 'src-tauri', 'target', 'release', 'DirectML.dll'),
        target: path.join(rootDir, 'DirectML.dll'),
        label: 'DirectML.dll (ONNX Runtime)',
    }
];

// Directories to copy to the project root
const dirsToCopy = [
    {
        source: path.join(__dirname, 'src-tauri', 'models'),
        target: path.join(rootDir, 'models'),
        label: 'ONNX models',
    }
];

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('[POST-BUILD] Starting copy process...');

for (const file of filesToCopy) {
    try {
        if (fs.existsSync(file.source)) {
            fs.copyFileSync(file.source, file.target);
            const sizeMB = (fs.statSync(file.target).size / (1024 * 1024)).toFixed(1);
            console.log(`[POST-BUILD] ✓ Copied ${file.label} (${sizeMB} MB)`);
        } else {
            console.warn(`[POST-BUILD] ⚠ ${file.label} not found at: ${file.source}`);
        }
    } catch (e) {
        console.error(`[POST-BUILD] ✗ Failed to copy ${file.label}:`, e.message);
    }
}

for (const dir of dirsToCopy) {
    try {
        if (fs.existsSync(dir.source)) {
            copyDirSync(dir.source, dir.target);
            const fileCount = fs.readdirSync(dir.target).length;
            console.log(`[POST-BUILD] ✓ Copied ${dir.label} (${fileCount} files)`);
        } else {
            console.warn(`[POST-BUILD] ⚠ ${dir.label} not found at: ${dir.source}`);
        }
    } catch (e) {
        console.error(`[POST-BUILD] ✗ Failed to copy ${dir.label}:`, e.message);
    }
}

console.log('[POST-BUILD] Done.');
