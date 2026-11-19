import type { PDFDocumentProxy } from "pdfjs-dist";
import { db } from "../db/schema";
import type { PageTextProvider } from "../text/readingModel";
import type { RawTextContent } from "./extract";
import type { LayoutOptions } from "./layout";
import { loadPageText } from "./pageText";
import { applyRoles, bodyFontSize, learnHeaderFooter, type HeaderFooterModel } from "./roles";
import { EXTRACT_VERSION, type PageText } from "./types";

class LRU<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }
  clear(): void {
    this.m.clear();
  }
}

/**
 * PageText provider for an open PDF: extraction + layout + roles, with a header/footer
 * model learned from a sample of pages (cached in IndexedDB per document).
 */
export class PdfDocText implements PageTextProvider {
  readonly pdf: PDFDocumentProxy;
  readonly docId: string;
  private layout: LayoutOptions;
  private texts = new LRU<number, PageText>(200);
  private pending = new Map<number, Promise<PageText>>();
  private raw = new LRU<number, RawTextContent>(40);
  private hf: HeaderFooterModel | null = null;
  private bodyFs = 10;
  private rolesReady: Promise<void> | null = null;

  constructor(pdf: PDFDocumentProxy, docId: string, layout: LayoutOptions) {
    this.pdf = pdf;
    this.docId = docId;
    this.layout = layout;
  }

  get numPages(): number {
    return this.pdf.numPages;
  }

  setLayout(layout: LayoutOptions): void {
    if (layout.columnDetection === this.layout.columnDetection) return;
    this.layout = layout;
    this.texts.clear();
    this.pending.clear();
  }

  /** Cached pdf.js TextContent (shared with the TextLayer so div indices match items). */
  async getTextContent(p: number): Promise<RawTextContent> {
    const hit = this.raw.get(p);
    if (hit) return hit;
    const page = await this.pdf.getPage(p);
    const tc = (await page.getTextContent({ includeMarkedContent: false })) as unknown as RawTextContent;
    this.raw.set(p, tc);
    return tc;
  }

  private async extract(p: number): Promise<PageText> {
    const page = await this.pdf.getPage(p);
    const tc = await this.getTextContent(p);
    return loadPageText({ pageNumber: p, getViewport: (o) => page.getViewport(o), getTextContent: async () => tc }, this.layout);
  }

  private ensureRoles(): Promise<void> {
    if (!this.rolesReady) {
      this.rolesReady = (async () => {
        try {
          const meta = await db.docMeta.get(this.docId);
          if (meta && meta.version === EXTRACT_VERSION && meta.headerFooter) {
            this.hf = meta.headerFooter;
            this.bodyFs = meta.bodyFontSize ?? 10;
            return;
          }
        } catch {
          /* IndexedDB unavailable */
        }
        const n = this.numPages;
        const count = Math.min(n, 30);
        const sample = new Set<number>();
        for (let i = 0; i < count; i++) sample.add(1 + Math.round((i * (n - 1)) / Math.max(1, count - 1)));
        const pages: PageText[] = [];
        for (const p of sample) pages.push(await this.extract(p));
        this.hf = learnHeaderFooter(pages);
        this.bodyFs = bodyFontSize(pages);
        try {
          await db.docMeta.put({ docId: this.docId, headerFooter: this.hf, bodyFontSize: this.bodyFs, version: EXTRACT_VERSION });
        } catch {
          /* ignore */
        }
      })();
    }
    return this.rolesReady;
  }

  getPageText(p: number): Promise<PageText> {
    const hit = this.texts.get(p);
    if (hit) return Promise.resolve(hit);
    let pr = this.pending.get(p);
    if (!pr) {
      pr = (async () => {
        await this.ensureRoles();
        const pt = await this.extract(p);
        applyRoles(pt, this.hf, this.bodyFs);
        this.texts.set(p, pt);
        this.pending.delete(p);
        return pt;
      })();
      pr.catch(() => this.pending.delete(p));
      this.pending.set(p, pr);
    }
    return pr;
  }

  peekPageText(p: number): PageText | undefined {
    return this.texts.get(p);
  }
}
