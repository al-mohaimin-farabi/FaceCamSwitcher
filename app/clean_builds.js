import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dirsToClean = [
  path.join(__dirname, "src-tauri", "target", "release", "bundle", "nsis"),
  path.join(__dirname, "src-tauri", "target", "release", "bundle", "msi"),
];

let cleanedCount = 0;

try {
  execSync("taskkill /IM FaceCam.exe /F", { stdio: "ignore" });
  console.log("[CLEANUP] Closed running FaceCam application.");
} catch (e) {
  // It's fine if it's not running
}

try {
  execSync("taskkill /IM FaceCam_Backend.exe /F", { stdio: "ignore" });
  console.log("[CLEANUP] Closed running FaceCam_Backend application.");
} catch (e) {
  // It's fine if it's not running
}

dirsToClean.forEach((dir) => {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((file) => {
      if (file.endsWith(".exe") || file.endsWith(".msi")) {
        try {
          fs.unlinkSync(path.join(dir, file));
          console.log(`[CLEANUP] Deleted old version: ${file}`);
          cleanedCount++;
        } catch (e) {
          console.error(`[CLEANUP] Failed to delete ${file}:`, e.message);
        }
      }
    });
  }
});

if (cleanedCount > 0) {
  console.log(
    `[CLEANUP] Successfully removed ${cleanedCount} old build file(s).`,
  );
} else {
  console.log(`[CLEANUP] No old builds found to clear.`);
}
