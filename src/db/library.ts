import { sha256Hex } from "../lib/hash";
import { destroyPdf, openPdf } from "../pdf/pdfjs";
import { renderThumbnail } from "../pdf/thumbnails";
import { db, type DocumentRow } from "./schema";

/** Imports a PDF file into the local library (deduplicated by content hash). Returns the doc id. */
export async function importPdf(file: File | Blob, fileName = (file as File).name ?? "document.pdf"): Promise<string> {
  const buf = await file.arrayBuffer();
  const id = await sha256Hex(buf);
  const existing = await db.documents.get(id);
  if (existing) {
    await db.documents.update(id, { lastOpenedAt: Date.now() });
    return id;
  }
  const pdf = await openPdf(new Uint8Array(buf.slice(0)));
  try {
    let title = fileName.replace(/\.pdf$/i, "");
    let author: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const info = meta.info as { Title?: string; Author?: string };
      if (info?.Title && info.Title.trim().length > 2 && !/^untitled|^microsoft word/i.test(info.Title)) title = info.Title.trim();
      if (info?.Author) author = info.Author.trim();
    } catch {
      /* no metadata */
    }
    const thumb = await renderThumbnail(pdf, 1, 180);
    const row: DocumentRow = { id, title, fileName, size: buf.byteLength, numPages: pdf.numPages, addedAt: Date.now(), lastOpenedAt: Date.now(), progress: 0, author };
    await db.transaction("rw", [db.documents, db.files, db.thumbnails], async () => {
      await db.documents.put(row);
      await db.files.put({ docId: id, blob: new Blob([buf], { type: "application/pdf" }) });
      if (thumb) await db.thumbnails.put({ docId: id, page: 1, blob: thumb });
    });
  } finally {
    destroyPdf(pdf);
  }
  return id;
}

export async function deleteDocument(id: string): Promise<void> {
  await db.transaction("rw", [db.documents, db.files, db.thumbnails, db.readingState, db.docPrefs, db.docMeta, db.bookmarks, db.annotations, db.audioCache], async () => {
    await db.documents.delete(id);
    await db.files.delete(id);
    await db.thumbnails.where("docId").equals(id).delete();
    await db.readingState.delete(id);
    await db.docPrefs.delete(id);
    await db.docMeta.delete(id);
    await db.bookmarks.where("docId").equals(id).delete();
    await db.annotations.where("docId").equals(id).delete();
    await db.audioCache.where("docId").equals(id).delete();
  });
}

export async function saveReadingState(docId: string, page: number, sentenceId: number | undefined, numPages: number): Promise<void> {
  await db.readingState.put({ docId, page, sentenceId, updatedAt: Date.now() });
  await db.documents.update(docId, { progress: numPages > 1 ? (page - 1) / (numPages - 1) : 1, lastOpenedAt: Date.now() });
}
