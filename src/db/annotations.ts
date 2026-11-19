import { getSession } from "../app/session";
import { pageOf, type SrcPos } from "../pdf/types";
import { db, type AnnotationRow, type BookmarkRow } from "./schema";

export const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];

export async function addHighlight(srcStart: SrcPos, srcEnd: SrcPos, quote: string, color: string, note?: string): Promise<AnnotationRow | null> {
  const s = getSession();
  if (!s) return null;
  const rects = s.model.rectsFor(srcStart, srcEnd);
  if (!rects.length) return null;
  const row: AnnotationRow = { id: crypto.randomUUID(), docId: s.docId, page: pageOf(srcStart), srcStart, srcEnd, rects, quote, note, color, createdAt: Date.now() };
  await db.annotations.put(row);
  return row;
}

export async function addBookmark(page: number, src?: SrcPos, label?: string): Promise<BookmarkRow | null> {
  const s = getSession();
  if (!s) return null;
  const row: BookmarkRow = { docId: s.docId, page, srcPos: src, label: label || `Page ${page}`, createdAt: Date.now() };
  row.id = await db.bookmarks.add(row);
  return row;
}
