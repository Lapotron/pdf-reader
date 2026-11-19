/**
 * Core geometry and text-model types shared by extraction, layout, cleanup and playback.
 *
 * Coordinate space ("base space"): page.getViewport({ scale: 1 }) — page /Rotate applied,
 * origin at the top-left, y grows downward, 1 unit = 1 PDF point. Screen CSS pixels are
 * base * cssScale, where cssScale = zoom * PDF_TO_CSS_UNITS.
 */

/** Globally ordered source position: page * PAGE_STRIDE + local offset into PageText.source. */
export type SrcPos = number;

/** Max chars per page source string. 2^22 * 2^31 pages stays far below 2^53. */
export const PAGE_STRIDE = 1 << 22;

export const srcPos = (page: number, local: number): SrcPos => page * PAGE_STRIDE + local;
export const pageOf = (p: SrcPos): number => Math.floor(p / PAGE_STRIDE);
export const localOf = (p: SrcPos): number => p - pageOf(p) * PAGE_STRIDE;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PItem {
  str: string;
  rect: Rect;
  /** Baseline y in base space. */
  baseline: number;
  fontSize: number;
  fontFamily: string;
  /** Screen angle in radians (0 = upright, left-to-right). */
  angle: number;
  hasEOL: boolean;
  /** Index among the page's text items (marked-content entries excluded); equals the TextLayer textDivs index. */
  raw: number;
  /** Superscript (e.g. footnote marker), set by layout. */
  sup?: boolean;
}

export type LineRole =
  | "body"
  | "header"
  | "footer"
  | "pageNum"
  | "footnote"
  | "caption"
  | "table"
  | "rotated";

export interface PLine {
  rect: Rect;
  baseline: number;
  fontSize: number;
  /** Item indices, left to right. */
  items: number[];
  block: number;
  role: LineRole;
  /** Local offsets into PageText.source: [srcStart, srcEnd). */
  srcStart: number;
  srcEnd: number;
  text: string;
}

export interface PBlock {
  rect: Rect;
  /** Line indices in reading order. */
  lines: number[];
  role: LineRole;
}

export interface PageText {
  /** 1-based page number. */
  page: number;
  version: number;
  width: number;
  height: number;
  items: PItem[];
  /** Lines in reading order. */
  lines: PLine[];
  /** Blocks in reading order. */
  blocks: PBlock[];
  /** Page text in reading order, with synthetic spaces/newlines between items/lines/blocks. */
  source: string;
  /** Per source char: item index, or -1 for synthetic separators. */
  srcItem: Int32Array;
  /** Per source char: char index within the item's str, or -1. */
  srcChar: Int32Array;
  /** Per item: local source offset of its first char. */
  itemSrcStart: Int32Array;
}

/** Bump when extraction/layout output changes so cached PageText is rebuilt. */
export const EXTRACT_VERSION = 3;
