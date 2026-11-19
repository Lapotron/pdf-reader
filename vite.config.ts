import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// VITE_BASE lets the same build run at "/" locally and at "/<repo>/" on GitHub Pages.
const base = process.env.VITE_BASE ?? "/";
const coiHeaders: Record<string, string> = process.env.VITE_COI
  ? { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" }
  : {};

/**
 * ONNX Runtime is loaded from the self-hosted copy in public/vendor/ort (its standalone loader
 * is required for multi-threaded WASM). Rollup still emits a second 21 MB copy referenced via
 * `new URL(...)` inside the bundle; it is never requested, so drop it.
 */
function dropBundledOrtWasm(): Plugin {
  return {
    name: "drop-bundled-ort-wasm",
    apply: "build",
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm-simd-threaded.*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

/** Warns about files that common static hosts reject (Cloudflare Pages: 25 MiB per file). */
function warnLargeFiles(limitBytes = 25 * 1024 * 1024): Plugin {
  let outDir = "dist";
  return {
    name: "warn-large-files",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
      for (const f of walk(outDir)) {
        const size = statSync(f).size;
        if (size > limitBytes) this.warn(`${f} is ${(size / 1048576).toFixed(1)} MiB; some static hosts (e.g. Cloudflare Pages) reject files over 25 MiB.`);
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    dropBundledOrtWasm(),
    warnLargeFiles(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png", "sample.pdf"],
      manifest: {
        name: "Simple Reader",
        short_name: "Simple Reader",
        description: "PDF reader with natural neural text-to-speech, a floating reading line, smart text cleanup, library and annotations.",
        theme_color: "#1f2937",
        background_color: "#e9ecf1",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        file_handlers: [{ action: ".", accept: { "application/pdf": [".pdf"] } }],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,pdf}"],
        // Large runtime assets are cached on first use instead of precached.
        globIgnores: ["**/vendor/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/vendor\/ort4?\//.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "onnx-runtime", expiration: { maxEntries: 6 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/vendor/pdfjs/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfjs-assets", expiration: { maxEntries: 500 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
        // Model weights are cached by transformers.js / kokoro-js in their own Cache Storage buckets.
      },
    }),
  ],
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
