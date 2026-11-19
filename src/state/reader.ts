import { create } from "zustand";
import type { OutlineEntry } from "../pdf/outline";

export interface PageSize {
  w: number;
  h: number;
}

export interface ReaderStore {
  docId: string | null;
  title: string;
  numPages: number;
  loading: boolean;
  loadError: string | null;
  /** Base-space page sizes (index = page - 1). */
  sizes: PageSize[];
  /** CSS pixels per PDF point. */
  scale: number;
  currentPage: number;
  outline: OutlineEntry[];
  /** Incremented to ask DocumentView to scroll somewhere. */
  scrollRequest: { page: number; y?: number; seq: number; smooth?: boolean } | null;
  searchHits: { page: number; srcStart: number; srcEnd: number }[];
  activeHit: number;
  selection: { srcStart: number; srcEnd: number; text: string; x: number; y: number } | null;
}

export const useReader = create<ReaderStore>()(() => ({
  docId: null,
  title: "",
  numPages: 0,
  loading: false,
  loadError: null,
  sizes: [],
  scale: 1,
  currentPage: 1,
  outline: [],
  scrollRequest: null,
  searchHits: [],
  activeHit: -1,
  selection: null,
}));

let seq = 0;
export function requestScroll(page: number, y?: number, smooth = false): void {
  useReader.setState({ scrollRequest: { page, y, seq: ++seq, smooth } });
}
