import { charAtX, charOffsets } from "../pdf/charBoxes";
import { localOf, pageOf, srcPos, type PBlock, type PLine, type PageText, type Rect, type SrcPos } from "../pdf/types";
import { buildDisplay, buildSpeech, type CleanupOptions } from "./cleanup";
import type { CompiledRule } from "./pronunciation";
import { splitSentences, type Sentence } from "./segment";

export interface PageTextProvider {
  readonly numPages: number;
  /** PageText with roles applied. */
  getPageText(page: number): Promise<PageText>;
  /** Synchronous access to an already loaded page (for overlays and hit-testing). */
  peekPageText(page: number): PageText | undefined;
}

export interface PageRect {
  page: number;
  rect: Rect;
}

/**
 * The reading model: sentences/words with source mapping, built lazily per page from a
 * window [p-1, p, p+1] so sentences crossing page boundaries stay intact. Cleanup runs at
 * read time, so toggling an option never re-extracts the PDF.
 */
export class ReadingModel {
  private sentences = new Map<number, Promise<Sentence[]>>();
  private resolved = new Map<number, Sentence[]>();
  private opts: CleanupOptions;
  private rules: CompiledRule[];
  readonly provider: PageTextProvider;

  constructor(provider: PageTextProvider, opts: CleanupOptions, rules: CompiledRule[] = []) {
    this.provider = provider;
    this.opts = opts;
    this.rules = rules;
  }

  get numPages(): number {
    return this.provider.numPages;
  }

  get options(): CleanupOptions {
    return this.opts;
  }

  setOptions(opts: CleanupOptions, rules: CompiledRule[]): void {
    this.opts = opts;
    this.rules = rules;
    this.sentences.clear();
    this.resolved.clear();
  }

  page(p: number): Promise<PageText> {
    return this.provider.getPageText(p);
  }

  /** Sentences whose start lies on page p (sync, if already computed). */
  peekSentences(p: number): Sentence[] | undefined {
    return this.resolved.get(p);
  }

  sentencesOfPage(p: number): Promise<Sentence[]> {
    if (p < 1 || p > this.numPages) return Promise.resolve([]);
    let pr = this.sentences.get(p);
    if (!pr) {
      const opts = this.opts;
      const rules = this.rules;
      pr = (async () => {
        const nums = [p - 1, p, p + 1].filter((n) => n >= 1 && n <= this.numPages);
        const pages = await Promise.all(nums.map((n) => this.page(n)));
        const display = buildDisplay(pages, opts);
        const speech = buildSpeech(display, opts, rules);
        const all = splitSentences(speech).filter((s) => pageOf(s.srcStart) === p);
        if (this.opts === opts) this.resolved.set(p, all);
        return all;
      })();
      this.sentences.set(p, pr);
      pr.catch(() => this.sentences.delete(p));
    }
    return pr;
  }

  /** First sentence starting on page >= p. */
  async firstSentenceFrom(p: number): Promise<Sentence | null> {
    for (let q = Math.max(1, p); q <= this.numPages; q++) {
      const ss = await this.sentencesOfPage(q);
      if (ss.length) return ss[0];
    }
    return null;
  }

  /** Sentence containing src (or the first one after it) and the word index at src. */
  async sentenceAt(src: SrcPos): Promise<{ sentence: Sentence; wordIdx: number } | null> {
    const p = pageOf(src);
    const prev = await this.sentencesOfPage(p - 1);
    const last = prev[prev.length - 1];
    if (last && last.srcEnd > src && last.srcStart <= src) return { sentence: last, wordIdx: wordIndexAt(last, src) };
    const ss = await this.sentencesOfPage(p);
    for (const s of ss) {
      if (s.srcEnd > src) return { sentence: s, wordIdx: s.srcStart <= src ? wordIndexAt(s, src) : 0 };
    }
    const next = await this.firstSentenceFrom(p + 1);
    return next ? { sentence: next, wordIdx: 0 } : null;
  }

  async next(s: Sentence): Promise<Sentence | null> {
    const p = pageOf(s.srcStart);
    const ss = await this.sentencesOfPage(p);
    const i = ss.findIndex((x) => x.id === s.id);
    if (i >= 0 && i + 1 < ss.length) return ss[i + 1];
    return this.firstSentenceFrom(p + 1);
  }

  async prev(s: Sentence): Promise<Sentence | null> {
    const p = pageOf(s.srcStart);
    const ss = await this.sentencesOfPage(p);
    const i = ss.findIndex((x) => x.id === s.id);
    if (i > 0) return ss[i - 1];
    for (let q = p - 1; q >= 1; q--) {
      const prev = await this.sentencesOfPage(q);
      if (prev.length) return prev[prev.length - 1];
    }
    return null;
  }

  /** One rect per line covering source range [a, b) on loaded pages. */
  rectsFor(a: SrcPos, b: SrcPos): PageRect[] {
    const out: PageRect[] = [];
    if (b <= a) return out;
    const p0 = pageOf(a);
    const p1 = pageOf(b - 1);
    for (let p = p0; p <= p1; p++) {
      const pt = this.provider.peekPageText(p);
      if (!pt) continue;
      const la = p === p0 ? localOf(a) : 0;
      const lb = p === p1 ? localOf(b - 1) + 1 : pt.source.length;
      for (const line of pt.lines) {
        const s = Math.max(la, line.srcStart);
        const e = Math.min(lb, line.srcEnd);
        if (e <= s) continue;
        const r = spanRect(pt, line, s, e);
        if (r) out.push({ page: p, rect: r });
      }
    }
    return out;
  }

  /** Line containing src, or the next line after it on the same page. */
  lineAt(src: SrcPos): { page: number; line: PLine; block: PBlock; index: number } | null {
    const p = pageOf(src);
    const pt = this.provider.peekPageText(p);
    if (!pt) return null;
    const l = localOf(src);
    let idx = pt.lines.findIndex((ln) => ln.srcStart <= l && l < ln.srcEnd);
    if (idx < 0) idx = pt.lines.findIndex((ln) => ln.srcStart >= l);
    if (idx < 0) return null;
    const line = pt.lines[idx];
    return { page: p, line, block: pt.blocks[line.block], index: idx };
  }

  /** Source position under a base-space point on a loaded page. */
  hitTest(page: number, x: number, y: number): SrcPos | null {
    const pt = this.provider.peekPageText(page);
    if (!pt) return null;
    let best: PLine | null = null;
    let bestD = Infinity;
    for (const line of pt.lines) {
      const r = line.rect;
      const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      const d = dy * 4 + dx;
      if (d < bestD) {
        bestD = d;
        best = line;
      }
    }
    if (!best || bestD > 4 * best.fontSize) return null;
    let bestItem = best.items[0];
    let bestDx = Infinity;
    for (const ii of best.items) {
      const r = pt.items[ii].rect;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      if (dx < bestDx) {
        bestDx = dx;
        bestItem = ii;
      }
    }
    const it = pt.items[bestItem];
    const c = charAtX(it, x - it.rect.x);
    return srcPos(page, pt.itemSrcStart[bestItem] + c);
  }
}

export function wordIndexAt(s: Sentence, src: SrcPos): number {
  for (let i = 0; i < s.words.length; i++) if (s.words[i].srcEnd > src) return i;
  return Math.max(0, s.words.length - 1);
}

function spanRect(pt: PageText, line: PLine, s: number, e: number): Rect | null {
  let i = s;
  while (i < e && (pt.srcItem[i] < 0 || /\s/.test(pt.source[i]))) i++;
  let j = e - 1;
  while (j >= i && (pt.srcItem[j] < 0 || /\s/.test(pt.source[j]))) j--;
  if (j < i) return null;
  const a = pt.items[pt.srcItem[i]];
  const b = pt.items[pt.srcItem[j]];
  const x0 = a.rect.x + charOffsets(a)[pt.srcChar[i]];
  const x1 = b.rect.x + charOffsets(b)[pt.srcChar[j] + 1];
  return { x: x0, y: line.rect.y, w: Math.max(1, x1 - x0), h: line.rect.h };
}
