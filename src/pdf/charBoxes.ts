import type { PItem } from "./types";

/**
 * Per-char x offsets within an item: Float32Array of length str.length + 1, where
 * offsets[i] is the x distance (base space) from item.rect.x to the start of char i.
 * Glyph widths are measured with a canvas when available and scaled so they sum to the
 * item width; otherwise a width heuristic is used.
 */
const cache = new WeakMap<PItem, Float32Array>();

type Measure = (text: string, font: string) => number;
let measurer: Measure | null | undefined;

function getMeasurer(): Measure | null {
  if (measurer !== undefined) return measurer;
  measurer = null;
  try {
    const canvas: OffscreenCanvas | HTMLCanvasElement | null =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : typeof document !== "undefined"
          ? document.createElement("canvas")
          : null;
    const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (ctx && typeof ctx.measureText === "function") {
      let lastFont = "";
      measurer = (text, font) => {
        if (font !== lastFont) {
          ctx.font = font;
          lastFont = font;
        }
        return ctx.measureText(text).width;
      };
    }
  } catch {
    measurer = null;
  }
  return measurer;
}

/** For tests: force the heuristic (null) or a custom measurer. */
export function setMeasurer(m: Measure | null): void {
  measurer = m;
}

function heuristicWidth(ch: string): number {
  if (ch === " ") return 0.28;
  if ("iljI.,;:'!|".includes(ch)) return 0.28;
  if ("ftr()[]-".includes(ch)) return 0.36;
  if ("mwMW".includes(ch)) return 0.85;
  if (ch >= "A" && ch <= "Z") return 0.68;
  if (ch >= "0" && ch <= "9") return 0.56;
  return 0.52;
}

export function charOffsets(item: PItem): Float32Array {
  const hit = cache.get(item);
  if (hit) return hit;
  const s = item.str;
  const n = s.length;
  const widths = new Float32Array(n);
  const m = getMeasurer();
  let measuredOk = false;
  if (m) {
    const font = `${Math.max(1, Math.round(item.fontSize))}px ${item.fontFamily}`;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      widths[i] = m(s[i], font);
      sum += widths[i];
    }
    measuredOk = sum > 0;
  }
  if (!measuredOk) for (let i = 0; i < n; i++) widths[i] = heuristicWidth(s[i]);
  let total = 0;
  for (let i = 0; i < n; i++) total += widths[i];
  const scale = total > 0 ? item.rect.w / total : 0;
  const off = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + widths[i] * scale;
  off[n] = item.rect.w;
  cache.set(item, off);
  return off;
}

/** Char index within the item at x offset dx from item.rect.x (nearest boundary, clamped). */
export function charAtX(item: PItem, dx: number): number {
  const off = charOffsets(item);
  const n = item.str.length;
  if (dx <= 0) return 0;
  if (dx >= off[n]) return Math.max(0, n - 1);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (off[mid] <= dx) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
