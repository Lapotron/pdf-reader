import type { PDFDocumentProxy } from "pdfjs-dist";

/** Renders a page to a JPEG blob of the given CSS width. */
export async function renderThumbnail(pdf: PDFDocumentProxy, pageNum: number, width = 180): Promise<Blob | null> {
  try {
    const page = await pdf.getPage(pageNum);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = (width * 2) / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvas, viewport: vp, background: "#ffffff" }).promise;
    return await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.8));
  } catch {
    return null;
  }
}
