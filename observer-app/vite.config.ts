import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent Vite from clearing the terminal output
  clearScreen: false,

  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 5174 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Tauri reads a single bundle — no need for legacy polyfills
    target: ["es2021", "chrome105"],
    // Smaller chunks = faster first paint
    minify: "esbuild" as const,
    rollupOptions: {
      output: {
        // Split vendor libs from app code so the browser can cache them separately
        manualChunks: {
          "vendor-react":  ["react", "react-dom"],
          "vendor-tauri":  ["@tauri-apps/api"],
          "vendor-lucide": ["lucide-react"],
        },
        // Deterministic filenames in the Tauri bundle
        entryFileNames:   "assets/[name]-[hash].js",
        chunkFileNames:   "assets/[name]-[hash].js",
        assetFileNames:   "assets/[name]-[hash][extname]",
      },
    },
    // Report what's large
    reportCompressedSize: true,
  },
}));
