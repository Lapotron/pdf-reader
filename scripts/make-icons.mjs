// Renders public/icon.svg to the PNG icons the web app manifest needs (uses the preinstalled
// Playwright Chromium). Run: node scripts/make-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("@playwright/test"));
}
const svg = readFileSync(join(root, "public", "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const targets = [
  { file: "icon-192.png", size: 192, pad: 0, bg: "transparent" },
  { file: "icon-512.png", size: 512, pad: 0, bg: "transparent" },
  { file: "icon-maskable-512.png", size: 512, pad: 0.12, bg: "#1f2937" },
  { file: "apple-touch-icon.png", size: 180, pad: 0.06, bg: "#1f2937" },
];
for (const t of targets) {
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg};display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">` +
      svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `) +
      "</body></html>",
  );
  await page.screenshot({ path: join(root, "public", t.file), omitBackground: t.bg === "transparent" });
}
await browser.close();
console.log("[make-icons] wrote PNG icons to public/");
