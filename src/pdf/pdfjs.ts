import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL;

/** Opens a PDF. `data` is transferred to the pdf.js worker and must not be reused. */
export function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data,
    cMapUrl: `${base}vendor/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}vendor/pdfjs/standard_fonts/`,
    wasmUrl: `${base}vendor/pdfjs/wasm/`,
    iccUrl: `${base}vendor/pdfjs/iccs/`,
  }).promise;
}

/** Releases a document and its worker resources. */
export function destroyPdf(pdf: PDFDocumentProxy): void {
  void pdf.loadingTask.destroy().catch(() => {});
}

export const PDF_TO_CSS = pdfjs.PixelsPerInch.PDF_TO_CSS_UNITS;
export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
