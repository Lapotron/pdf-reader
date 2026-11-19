import { mul } from "../lib/geom";
import type { PItem } from "./types";

/** Minimal shapes of pdf.js TextContent so this module stays pure (and testable in Node). */
export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
  dir?: string;
}
export interface RawMarked {
  type: string;
}
export interface RawTextContent {
  items: (RawTextItem | RawMarked)[];
  styles: Record<string, { fontFamily?: string; ascent?: number; descent?: number; vertical?: boolean }>;
}
export interface BaseViewport {
  transform: number[];
  width: number;
  height: number;
}

const ROTATION_EPS = (2 * Math.PI) / 180;

/**
 * Converts pdf.js text items into PItems with base-space rectangles (same math as the
 * pdf.js TextLayer). Whitespace-only items are dropped (pdf.js emits wide " " items that
 * span column gutters), but `raw` keeps the TextLayer div index.
 */
export function extractItems(tc: RawTextContent, vp: BaseViewport): PItem[] {
  const out: PItem[] = [];
  let raw = -1;
  for (const it of tc.items) {
    if ((it as RawTextItem).str === undefined) continue; // marked content
    raw++;
    const item = it as RawTextItem;
    if (item.str.trim() === "") continue;
    const style = tc.styles[item.fontName] ?? {};
    const tx = mul(vp.transform, item.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    if (style.vertical) angle += Math.PI / 2;
    const fontSize = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 1;
    const ascent = style.ascent && style.ascent > 0 ? style.ascent : 0.8;
    const descent = style.descent && style.descent < 0 ? style.descent : -0.2;
    // pdf.js item.width is in user space units; base viewport scale is 1.
    const width = style.vertical ? item.height : item.width;
    let rect;
    if (Math.abs(angle) < ROTATION_EPS) {
      rect = { x: tx[4], y: tx[5] - fontSize * ascent, w: Math.max(width, 0), h: fontSize * (ascent - descent) };
      angle = 0;
    } else {
      // Axis-aligned bounds of the rotated run.
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const pts = [
        [0, -ascent * fontSize],
        [width, -ascent * fontSize],
        [0, -descent * fontSize],
        [width, -descent * fontSize],
      ].map(([u, v]) => [tx[4] + u * cos - v * sin, tx[5] + u * sin + v * cos]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    out.push({
      str: item.str,
      rect,
      baseline: tx[5],
      fontSize,
      fontFamily: style.fontFamily ?? "sans-serif",
      angle,
      hasEOL: item.hasEOL,
      raw,
    });
  }
  return out;
}
