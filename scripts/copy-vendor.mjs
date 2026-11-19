// Copies runtime assets that must be served as plain files (not bundled) into public/vendor.
// - pdf.js: CMaps, standard fonts, WASM image decoders, ICC profiles
// - ONNX Runtime Web (used by Kokoro via transformers.js): wasm + loader, self-hosted for offline use
import { cpSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");

// Node-style lookup: walk up from `from` looking in node_modules/<name>.
// (Avoids require.resolve on package.json, which some packages do not export.)
function pkgDir(name, from = root) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot find package ${name} from ${from}`);
    dir = parent;
  }
}

const pdfjs = pkgDir("pdfjs-dist");
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const src = join(pdfjs, dir);
  if (existsSync(src)) cpSync(src, join(out, "pdfjs", dir), { recursive: true });
}

// Resolve transformers as seen from kokoro-js so we always copy the matching ORT build.
const kokoroDir = pkgDir("kokoro-js");
const transformersDir = pkgDir("@huggingface/transformers", kokoroDir);
const ortOut = join(out, "ort");
mkdirSync(ortOut, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  const src = join(transformersDir, "dist", f);
  if (!existsSync(src)) throw new Error(`Missing ONNX Runtime asset: ${src}`);
  copyFileSync(src, join(ortOut, f));
}
// ONNX Runtime used by transformers.js v4 (Chatterbox voice cloning): its "asyncify" build.
const transformers4Dir = pkgDir("@huggingface/transformers");
const ort4Dir = pkgDir("onnxruntime-web", transformers4Dir);
const ort4Out = join(out, "ort4");
mkdirSync(ort4Out, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  const src = join(ort4Dir, "dist", f);
  if (!existsSync(src)) throw new Error(`Missing ONNX Runtime asset: ${src}`);
  copyFileSync(src, join(ort4Out, f));
}
console.log("[copy-vendor] pdf.js assets and ONNX Runtime wasm copied to public/vendor");
