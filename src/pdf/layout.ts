import { overlap1d, union, unionAll } from "../lib/geom";
import { EXTRACT_VERSION, type PBlock, type PItem, type PLine, type PageText, type Rect } from "./types";

export interface LayoutOptions {
  /** 'auto' = XY-cut reading order (handles multi-column); 'off' = content-stream order. */
  columnDetection: "auto" | "off";
}

interface LineBuild {
  items: number[];
  baseline: number;
  fontSize: number;
  x0: number;
  x1: number;
  stream: number;
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

/** Groups stream-ordered items into lines; detects superscripts (footnote markers). */
export function groupLines(items: PItem[]): LineBuild[] {
  const lines: LineBuild[] = [];
  let cur: LineBuild | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.angle !== 0) continue;
    if (cur) {
      const fs = cur.fontSize;
      const ifs = it.fontSize;
      const em = Math.max(fs, ifs);
      const gap = it.rect.x - cur.x1;
      const dBase = it.baseline - cur.baseline; // > 0: lower on the page
      const adjacent = gap > -0.5 * em && gap < 1.5 * em;
      const prev = items[cur.items[cur.items.length - 1]];
      let join = false;
      if (adjacent && ifs < 0.8 * fs && dBase < -0.12 * fs && dBase > -0.75 * fs) {
        it.sup = true; // raised small text → superscript
        join = true;
      } else if (adjacent && ifs < 0.8 * fs && dBase > 0.05 * fs && dBase < 0.5 * fs) {
        join = true; // subscript
      } else if (
        adjacent &&
        fs < 0.8 * ifs &&
        -dBase < -0.12 * ifs &&
        -dBase > -0.75 * ifs &&
        cur.items.every((k) => items[k].fontSize < 0.8 * ifs)
      ) {
        // Line so far is only a raised marker (e.g. "¹ Footnote text"): adopt the larger text.
        for (const k of cur.items) items[k].sup = true;
        cur.baseline = it.baseline;
        cur.fontSize = ifs;
        join = true;
      } else if (!prev.hasEOL && adjacent && Math.abs(dBase) <= 0.3 * Math.min(fs, ifs)) {
        join = true;
      }
      if (join) {
        cur.items.push(i);
        cur.x1 = Math.max(cur.x1, right(it.rect));
        cur.x0 = Math.min(cur.x0, it.rect.x);
        if (!it.sup && ifs > cur.fontSize && Math.abs(dBase) <= 0.3 * ifs) cur.fontSize = ifs;
        continue;
      }
    }
    cur = { items: [i], baseline: it.baseline, fontSize: it.fontSize, x0: it.rect.x, x1: right(it.rect), stream: i };
    lines.push(cur);
  }
  return lines;
}

class DSU {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    while (this.p[a] !== a) {
      this.p[a] = this.p[this.p[a]];
      a = this.p[a];
    }
    return a;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** Groups lines into blocks: vertically adjacent, horizontally overlapping, similar font size. */
function groupBlocks(lines: { rect: Rect; fontSize: number }[]): number[][] {
  const n = lines.length;
  const dsu = new DSU(n);
  for (let i = 0; i < n; i++) {
    const a = lines[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = lines[j];
      if (b.rect.y < a.rect.y) continue; // only look downward
      const fsMin = Math.min(a.fontSize, b.fontSize);
      const fsMax = Math.max(a.fontSize, b.fontSize);
      if (fsMax / fsMin > 1.3) continue;
      const ov = overlap1d(a.rect.x, right(a.rect), b.rect.x, right(b.rect));
      if (ov < 0.5 * fsMin) continue;
      const gap = b.rect.y - bottom(a.rect);
      if (gap > 0.9 * fsMax || gap < -0.6 * fsMax) continue;
      dsu.union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = dsu.find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }
  return [...groups.values()];
}

/** Merged-interval gaps of [a, b] intervals, returned as [gapStart, gapEnd] with width >= minGap. */
function gaps(intervals: [number, number][], minGap: number): [number, number][] {
  const s = [...intervals].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let end = -Infinity;
  for (const [a, b] of s) {
    if (end !== -Infinity && a - end >= minGap) out.push([end, a]);
    end = Math.max(end, b);
  }
  return out;
}

/** Recursive XY-cut: vertical cuts (columns) first, then horizontal cuts (rows). */
export function xyCut(ids: number[], rects: Rect[]): number[] {
  if (ids.length <= 1) return ids;
  const vg = gaps(ids.map((i) => [rects[i].x, right(rects[i])]), 4);
  if (vg.length > 0) {
    let best = vg[0];
    for (const g of vg) if (g[1] - g[0] > best[1] - best[0]) best = g;
    const left = ids.filter((i) => right(rects[i]) <= best[0] + 0.01);
    const rest = ids.filter((i) => right(rects[i]) > best[0] + 0.01);
    if (left.length && rest.length) return [...xyCut(left, rects), ...xyCut(rest, rects)];
  }
  const hg = gaps(ids.map((i) => [rects[i].y, bottom(rects[i])]), 0.5);
  if (hg.length > 0) {
    const rows: number[][] = Array.from({ length: hg.length + 1 }, () => []);
    for (const i of ids) {
      const cy = rects[i].y;
      let k = 0;
      while (k < hg.length && cy >= hg[k][1] - 0.01) k++;
      rows[k].push(i);
    }
    const nonEmpty = rows.filter((r) => r.length);
    if (nonEmpty.length > 1) return nonEmpty.flatMap((r) => xyCut(r, rects));
  }
  return [...ids].sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
}

const TERMINAL = /[.!?:]["”’)\]]?\s*$/;

export function buildPageText(
  page: number,
  width: number,
  height: number,
  items: PItem[],
  opts: LayoutOptions = { columnDetection: "auto" },
): PageText {
  const built = groupLines(items);

  // Materialize upright lines.
  const lines: PLine[] = built.map((lb) => {
    const its = [...lb.items].sort((a, b) => items[a].rect.x - items[b].rect.x);
    return {
      rect: unionAll(its.map((k) => items[k].rect)),
      baseline: lb.baseline,
      fontSize: lb.fontSize,
      items: its,
      block: -1,
      role: "body",
      srcStart: 0,
      srcEnd: 0,
      text: "",
    };
  });
  const lineStream = built.map((lb) => lb.stream);

  // Rotated items become their own lines (role 'rotated').
  items.forEach((it, k) => {
    if (it.angle === 0) return;
    lines.push({ rect: it.rect, baseline: it.baseline, fontSize: it.fontSize, items: [k], block: -1, role: "rotated", srcStart: 0, srcEnd: 0, text: "" });
    lineStream.push(k);
  });

  // Blocks (rotated lines stay alone).
  const uprightIdx = lines.map((l, i) => (l.role === "rotated" ? -1 : i)).filter((i) => i >= 0);
  const groups = groupBlocks(uprightIdx.map((i) => lines[i])).map((g) => g.map((k) => uprightIdx[k]));
  lines.forEach((l, i) => {
    if (l.role === "rotated") groups.push([i]);
  });

  let blocks: PBlock[] = groups.map((g) => {
    const sorted = [...g].sort((a, b) => lines[a].baseline - lines[b].baseline || lines[a].rect.x - lines[b].rect.x);
    return { rect: unionAll(sorted.map((i) => lines[i].rect)), lines: sorted, role: lines[sorted[0]].role === "rotated" ? "rotated" : "body" };
  });

  // Reading order: top margin, body (XY-cut or stream), bottom margin, rotated.
  const rects = blocks.map((b) => b.rect);
  const isRot = (i: number) => blocks[i].role === "rotated";
  const topZone: number[] = [];
  const botZone: number[] = [];
  const body: number[] = [];
  const rot: number[] = [];
  blocks.forEach((b, i) => {
    if (isRot(i)) rot.push(i);
    else if (bottom(b.rect) < 0.1 * height) topZone.push(i);
    else if (b.rect.y > 0.9 * height) botZone.push(i);
    else body.push(i);
  });
  const byYX = (a: number, b: number) => rects[a].y - rects[b].y || rects[a].x - rects[b].x;
  const minStream = (i: number) => Math.min(...blocks[i].lines.map((l) => lineStream[l]));
  const bodyOrder = opts.columnDetection === "auto" ? xyCut(body, rects) : [...body].sort((a, b) => minStream(a) - minStream(b));
  const order = [...topZone.sort(byYX), ...bodyOrder, ...botZone.sort(byYX), ...rot.sort(byYX)];
  blocks = order.map((i) => blocks[i]);

  // Reorder lines to reading order and build the source string.
  const newLineIdx = new Map<number, number>();
  const orderedLines: PLine[] = [];
  blocks.forEach((b, bi) => {
    b.lines = b.lines.map((li) => {
      const l = lines[li];
      l.block = bi;
      newLineIdx.set(li, orderedLines.length);
      orderedLines.push(l);
      return orderedLines.length - 1;
    });
  });

  const chars: string[] = [];
  const srcItem: number[] = [];
  const srcChar: number[] = [];
  const itemSrcStart = new Int32Array(items.length).fill(-1);
  const synth = (s: string) => {
    for (const ch of s) {
      chars.push(ch);
      srcItem.push(-1);
      srcChar.push(-1);
    }
  };

  blocks.forEach((b) => {
    if (chars.length) synth("\n\n");
    b.lines.forEach((li, k) => {
      const line = orderedLines[li];
      if (k > 0) synth(isParagraphStart(orderedLines[b.lines[k - 1]], line, b, items) ? "\n\n" : "\n");
      line.srcStart = chars.length;
      line.items.forEach((ii, m) => {
        const it = items[ii];
        if (m > 0) {
          const prev = items[line.items[m - 1]];
          const gap = it.rect.x - right(prev.rect);
          if (gap > 0.15 * Math.min(prev.fontSize, it.fontSize) && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) synth(" ");
        }
        itemSrcStart[ii] = chars.length;
        for (let c = 0; c < it.str.length; c++) {
          chars.push(it.str[c]);
          srcItem.push(ii);
          srcChar.push(c);
        }
      });
      line.srcEnd = chars.length;
    });
  });
  const source = chars.join("");
  for (const l of orderedLines) l.text = source.slice(l.srcStart, l.srcEnd);
  // Block rects might have changed if lines were sorted; recompute for safety.
  for (const b of blocks) b.rect = b.lines.map((li) => orderedLines[li].rect).reduce(union);

  return {
    page,
    version: EXTRACT_VERSION,
    width,
    height,
    items,
    lines: orderedLines,
    blocks,
    source,
    srcItem: Int32Array.from(srcItem),
    srcChar: Int32Array.from(srcChar),
    itemSrcStart,
  };
}

function isParagraphStart(prev: PLine, cur: PLine, block: PBlock, items: PItem[]): boolean {
  const fs = Math.max(prev.fontSize, cur.fontSize);
  const vgap = cur.rect.y - bottom(prev.rect);
  if (vgap > 0.6 * fs) return true;
  const prevIndent = prev.rect.x - block.rect.x;
  const curIndent = cur.rect.x - block.rect.x;
  if (curIndent > 0.9 * fs && prevIndent < 0.5 * fs) return true;
  const prevText = prev.items.map((k) => items[k].str).join("");
  if (right(prev.rect) < right(block.rect) - 3 * fs && TERMINAL.test(prevText)) return true;
  return false;
}
