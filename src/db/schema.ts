import Dexie, { type EntityTable } from "dexie";
import type { PronunciationRule } from "../text/pronunciation";
import type { WordTiming } from "../tts/types";
import type { Rect } from "../pdf/types";

export interface DocumentRow {
  id: string; // sha256 of file bytes
  title: string;
  fileName: string;
  size: number;
  numPages: number;
  addedAt: number;
  lastOpenedAt: number;
  /** 0..1 reading progress. */
  progress: number;
  author?: string;
}

export interface FileRow {
  docId: string;
  blob: Blob;
}

export interface ReadingStateRow {
  docId: string;
  sentenceId?: number;
  page: number;
  scrollFrac?: number;
  zoom?: number;
  updatedAt: number;
}

export interface DocPrefsRow {
  docId: string;
  engine?: string;
  voice?: string;
  speed?: number;
  cleanupOverrides?: Record<string, unknown>;
}

export interface DocMetaRow {
  docId: string;
  headerFooter?: { keys: string[]; sampledPages: number };
  bodyFontSize?: number;
  version: number;
}

export interface BookmarkRow {
  id?: number;
  docId: string;
  page: number;
  srcPos?: number;
  label: string;
  createdAt: number;
}

export interface AnnotationRow {
  id: string;
  docId: string;
  page: number;
  srcStart: number;
  srcEnd: number;
  rects: { page: number; rect: Rect }[];
  quote: string;
  note?: string;
  color: string;
  createdAt: number;
}

export interface ThumbnailRow {
  docId: string;
  page: number;
  blob: Blob;
}

export interface AudioCacheRow {
  key: string;
  pcm: ArrayBuffer; // Int16 mono
  sampleRate: number;
  timings?: WordTiming[];
  timingSource: "engine" | "estimated";
  bytes: number;
  lastUsed: number;
  docId?: string;
}

export interface PronunciationRow extends PronunciationRule {}

export interface MetaRow {
  k: string;
  v: unknown;
}

export class MegaDB extends Dexie {
  documents!: EntityTable<DocumentRow, "id">;
  files!: EntityTable<FileRow, "docId">;
  readingState!: EntityTable<ReadingStateRow, "docId">;
  docPrefs!: EntityTable<DocPrefsRow, "docId">;
  docMeta!: EntityTable<DocMetaRow, "docId">;
  bookmarks!: EntityTable<BookmarkRow, "id">;
  annotations!: EntityTable<AnnotationRow, "id">;
  thumbnails!: Dexie.Table<ThumbnailRow, [string, number]>;
  audioCache!: EntityTable<AudioCacheRow, "key">;
  pronunciations!: EntityTable<PronunciationRow, "id">;
  meta!: EntityTable<MetaRow, "k">;

  constructor(name = "mega-reader") {
    super(name);
    this.version(1).stores({
      documents: "id, title, addedAt, lastOpenedAt",
      files: "docId",
      readingState: "docId",
      docPrefs: "docId",
      docMeta: "docId",
      bookmarks: "++id, docId, createdAt",
      annotations: "id, docId, page, createdAt",
      thumbnails: "[docId+page], docId",
      audioCache: "key, lastUsed, docId",
      pronunciations: "id, scope",
      meta: "k",
    });
  }
}

export const db = new MegaDB();
