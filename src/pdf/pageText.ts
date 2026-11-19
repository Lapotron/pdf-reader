import { extractItems, type RawTextContent } from "./extract";
import { buildPageText, type LayoutOptions } from "./layout";
import type { PageText } from "./types";

/** Minimal PDFPageProxy surface used here (keeps this usable with the Node legacy build in tests). */
export interface PageLike {
  pageNumber: number;
  getViewport(o: { scale: number }): { transform: number[]; width: number; height: number };
  getTextContent(o?: { includeMarkedContent?: boolean }): Promise<unknown>;
}

export async function loadPageText(page: PageLike, opts: LayoutOptions): Promise<PageText> {
  const vp = page.getViewport({ scale: 1 });
  const tc = (await page.getTextContent({ includeMarkedContent: false })) as RawTextContent;
  const items = extractItems(tc, vp);
  return buildPageText(page.pageNumber, vp.width, vp.height, items, opts);
}
