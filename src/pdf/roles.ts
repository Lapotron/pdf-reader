import type { LineRole, PageText } from "./types";

/**
 * Role detection:
 *  - header/footer/pageNum: learned per document from repeated lines in the top/bottom margins
 *  - footnote, caption, table, rotated: per page heuristics
 */

export interface HeaderFooterModel {
  /** Keys "zone|ybucket|normalized text" that repeat across pages. */
  keys: string[];
  sampledPages: number;
}

const ZONE = 0.1;
const YBUCKET = 8;
const ROMAN = /^(?=[mdclxvi])m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/i;
const PAGE_NUM = /^(?:(?:page|p\.|pg\.?)\s*)?(\d{1,4})(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const CAPTION = /^(?:fig(?:ure)?|table|tab|chart|listing|algorithm|scheme|plate|exhibit)\.?\s*(?:\d+|[IVXLC]+)(?:\.\d+)*\s*[.:|—–-]/i;
const FOOTNOTE_START = /^\s*(?:\d{1,3}|[*†‡§¶])/;

export function normalizeMarginText(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^\d+$/.test(w) || (w.length <= 6 && ROMAN.test(w)) ? "#" : w.replace(/\d+/g, "#")))
    .join(" ")
    .trim();
}

export function isPageNumberText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PAGE_NUM.test(t)) return true;
  return t.length <= 6 && ROMAN.test(t);
}

interface MarginLine {
  zone: "top" | "bottom";
  yb: number;
  norm: string;
  line: number;
}

function marginLines(pt: PageText): MarginLine[] {
  const out: MarginLine[] = [];
  const top: number[] = [];
  const bot: number[] = [];
  pt.lines.forEach((l, i) => {
    if (l.role === "rotated" || !l.text.trim()) return;
    if (l.rect.y + l.rect.h <= ZONE * pt.height) top.push(i);
    else if (l.rect.y >= (1 - ZONE) * pt.height) bot.push(i);
  });
  top.sort((a, b) => pt.lines[a].rect.y - pt.lines[b].rect.y);
  bot.sort((a, b) => pt.lines[b].rect.y - pt.lines[a].rect.y);
  for (const i of top.slice(0, 3)) {
    const l = pt.lines[i];
    out.push({ zone: "top", yb: Math.round(l.baseline / YBUCKET), norm: normalizeMarginText(l.text), line: i });
  }
  for (const i of bot.slice(0, 3)) {
    const l = pt.lines[i];
    out.push({ zone: "bottom", yb: Math.round(l.baseline / YBUCKET), norm: normalizeMarginText(l.text), line: i });
  }
  return out;
}

const keyOf = (m: { zone: string; yb: number; norm: string }) => `${m.zone}|${m.yb}|${m.norm}`;

/** Learns repeated margin lines from a sample of pages (needs >= 2 pages; all pages when < 4). */
export function learnHeaderFooter(pages: PageText[]): HeaderFooterModel {
  const n = pages.length;
  if (n < 2) return { keys: [], sampledPages: n };
  const counts = new Map<string, number>();
  for (const pt of pages) {
    const seen = new Set<string>();
    for (const m of marginLines(pt)) {
      // Count with ±1 y-bucket tolerance by registering the key under neighboring buckets too.
      for (const d of [-1, 0, 1]) seen.add(keyOf({ ...m, yb: m.yb + d }));
    }
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = n < 4 ? n : Math.max(3, Math.ceil(0.25 * n));
  const keys = [...counts.entries()].filter(([, c]) => c >= threshold).map(([k]) => k);
  return { keys, sampledPages: n };
}

/** Char-weighted median font size of plausible body lines. */
export function bodyFontSize(pages: PageText[]): number {
  const hist = new Map<number, number>();
  for (const pt of pages)
    for (const l of pt.lines) {
      if (l.role !== "body") continue;
      const k = Math.round(l.fontSize * 2) / 2;
      hist.set(k, (hist.get(k) ?? 0) + l.text.length);
    }
  let best = 0;
  let bestCount = -1;
  for (const [k, c] of hist) if (c > bestCount) [best, bestCount] = [k, c];
  return best || 10;
}

/** Assigns line and block roles in place. */
export function applyRoles(pt: PageText, hf: HeaderFooterModel | null, bodyFs: number): void {
  const keys = new Set(hf?.keys ?? []);
  const setRole = (i: number, r: LineRole) => {
    pt.lines[i].role = r;
  };

  // Margins: repeated header/footer lines and lone page numbers.
  for (const m of marginLines(pt)) {
    const line = pt.lines[m.line];
    if (keys.has(keyOf(m))) setRole(m.line, isPageNumberText(line.text) ? "pageNum" : m.zone === "top" ? "header" : "footer");
    else if (isPageNumberText(line.text)) setRole(m.line, "pageNum");
  }

  // Block-level: captions and footnotes.
  for (const b of pt.blocks) {
    if (b.role === "rotated") continue;
    const first = pt.lines[b.lines[0]];
    if (first.role !== "body") continue;
    const bodyLines = b.lines.filter((li) => pt.lines[li].role === "body");
    if (!bodyLines.length) continue;
    if (CAPTION.test(first.text)) {
      for (const li of bodyLines) setRole(li, "caption");
      b.role = "caption";
      continue;
    }
    const fs = median(bodyLines.map((li) => pt.lines[li].fontSize));
    const inLowerPart = b.rect.y > 0.6 * pt.height;
    const firstItem = pt.items[first.items[0]];
    if (inLowerPart && fs < 0.88 * bodyFs && (FOOTNOTE_START.test(first.text) || firstItem?.sup)) {
      for (const li of bodyLines) setRole(li, "footnote");
      b.role = "footnote";
    }
  }

  // Tables: rows (shared baseline) with >= 3 short segments, at least 2 such rows.
  const rows = new Map<number, number[]>();
  pt.lines.forEach((l, i) => {
    if (l.role !== "body") return;
    const k = Math.round(l.baseline / 2);
    const r = rows.get(k) ?? [];
    r.push(i);
    rows.set(k, r);
  });
  const tableRows = [...rows.values()].filter((r) => r.length >= 3 && r.reduce((s, i) => s + pt.lines[i].text.length, 0) / r.length <= 20);
  if (tableRows.length >= 2) for (const r of tableRows) for (const i of r) setRole(i, "table");

  for (const b of pt.blocks) {
    if (b.role !== "body") continue;
    const roles = new Set(b.lines.map((li) => pt.lines[li].role));
    if (roles.size === 1) b.role = [...roles][0];
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
