import type { PDFDocumentProxy } from "pdfjs-dist";

export interface OutlineEntry {
  title: string;
  depth: number;
  page: number | null;
  /** Base-space y from the top of the page when known. */
  y: number | null;
}

/** Flattens the PDF outline (bookmarks) with resolved page numbers. */
export async function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const outline = await pdf.getOutline();
  if (!outline) return [];
  const out: OutlineEntry[] = [];
  const walk = async (nodes: typeof outline, depth: number) => {
    for (const n of nodes) {
      let page: number | null = null;
      let y: number | null = null;
      try {
        let dest = n.dest as unknown;
        if (typeof dest === "string") dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          page = typeof ref === "number" ? ref + 1 : (await pdf.getPageIndex(ref)) + 1;
          // [ref, {name: 'XYZ'}, left, top, zoom]
          if (dest[1]?.name === "XYZ" && typeof dest[3] === "number") {
            const pg = await pdf.getPage(page);
            const vp = pg.getViewport({ scale: 1 });
            y = vp.convertToViewportPoint(0, dest[3])[1];
          }
        }
      } catch {
        /* unresolved destination */
      }
      out.push({ title: n.title || "(untitled)", depth, page, y });
      if (n.items?.length) await walk(n.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return out;
}

/** Page range [start, end] of the chapter containing `page` (top-level outline entries). */
export function chapterRange(outline: OutlineEntry[], page: number, numPages: number): [number, number] | null {
  const tops = outline.filter((e) => e.depth === 0 && e.page !== null).map((e) => e.page as number).sort((a, b) => a - b);
  if (!tops.length) return null;
  let start = 1;
  let end = numPages;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= page) {
      start = tops[i];
      end = i + 1 < tops.length ? Math.max(tops[i], tops[i + 1] - 1) : numPages;
    }
  }
  return [start, end];
}
