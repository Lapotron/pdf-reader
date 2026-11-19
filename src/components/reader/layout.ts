import type { PageSize } from "../../state/reader";

export const PAGE_GAP = 14;
export const PAGE_PAD = 20;

export interface DocLayout {
  tops: number[];
  lefts: number[];
  widths: number[];
  heights: number[];
  totalHeight: number;
  contentWidth: number;
}

export function computeLayout(sizes: PageSize[], scale: number, viewportWidth: number): DocLayout {
  const widths = sizes.map((s) => Math.round(s.w * scale));
  const heights = sizes.map((s) => Math.round(s.h * scale));
  const maxW = widths.reduce((m, w) => Math.max(m, w), 0);
  const contentWidth = Math.max(viewportWidth, maxW + 2 * PAGE_PAD);
  const tops: number[] = [];
  const lefts: number[] = [];
  let y = PAGE_PAD;
  for (let i = 0; i < sizes.length; i++) {
    tops.push(y);
    lefts.push(Math.round((contentWidth - widths[i]) / 2));
    y += heights[i] + PAGE_GAP;
  }
  return { tops, lefts, widths, heights, totalHeight: y - PAGE_GAP + PAGE_PAD, contentWidth };
}

/** Index of the last page whose top <= y. */
export function pageAtY(layout: DocLayout, y: number): number {
  const t = layout.tops;
  let lo = 0;
  let hi = t.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function fitScale(mode: "fit-width" | "fit-page" | "custom", zoom: number, sizes: PageSize[], vw: number, vh: number, cssPerPt: number): number {
  if (!sizes.length || vw <= 0) return zoom * cssPerPt;
  const maxW = sizes.reduce((m, s) => Math.max(m, s.w), 0);
  const first = sizes[0];
  if (mode === "fit-width") return Math.max(0.2, Math.min(4, (vw - 2 * PAGE_PAD - 12) / maxW));
  if (mode === "fit-page") return Math.max(0.2, Math.min(4, Math.min((vw - 2 * PAGE_PAD) / first.w, (vh - 2 * PAGE_PAD) / first.h)));
  return zoom * cssPerPt;
}
