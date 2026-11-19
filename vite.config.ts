import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// VITE_BASE lets the same build run at "/" locally and at "/<repo>/" on GitHub Pages.
const base = process.env.VITE_BASE ?? "/";
const coiHeaders: Record<string, string> = process.env.VITE_COI
  ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" }
  : {};

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  worker: {
    // Kokoro's worker uses dynamic imports (transformers.js, ONNX Runtime): needs ES workers.
    format: "es",
  },
  optimizeDeps: {
    // Pre-bundling breaks ONNX Runtime's runtime-relative asset loading in dev.
    exclude: ["kokoro-js", "@huggingface/transformers"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  // Optional cross-origin isolation for local testing of multi-threaded WASM (VITE_COI=1).
  server: { headers: coiHeaders },
  preview: { headers: coiHeaders },
});
