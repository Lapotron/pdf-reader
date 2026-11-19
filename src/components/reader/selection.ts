import { getSession } from "../../app/session";
import { srcPos, type PageText, type SrcPos } from "../../pdf/types";

const rawMaps = new WeakMap<PageText, Map<number, number>>();

function rawToItem(pt: PageText): Map<number, number> {
  let m = rawMaps.get(pt);
  if (!m) {
    m = new Map();
    pt.items.forEach((it, i) => m!.set(it.raw, i));
    rawMaps.set(pt, m);
  }
  return m;
}

function boundaryToSrc(node: Node, offset: number, edge: "start" | "end"): SrcPos | null {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  let charOffset: number | null = node.nodeType === Node.TEXT_NODE ? offset : null;
  if (el && node.nodeType !== Node.TEXT_NODE && !el.hasAttribute("data-raw")) {
    // Element boundary: pick the child next to the offset.
    const kids = el.childNodes;
    const child = edge === "start" ? kids[offset] : kids[offset - 1];
    if (child) {
      el = child.nodeType === Node.TEXT_NODE ? child.parentElement : (child as Element);
      charOffset = null;
    }
  }
  const pageEl = el?.closest<HTMLElement>("[data-page]");
  const span = el?.closest<HTMLElement>("[data-raw]");
  if (!pageEl || !span) return null;
  const page = Number(pageEl.dataset.page);
  const pt = getSession()?.text.peekPageText(page);
  if (!pt) return null;
  const map = rawToItem(pt);
  let raw = Number(span.dataset.raw);
  let idx = map.get(raw);
  let atEdge = false;
  if (idx === undefined) {
    // Whitespace-only span: snap to the neighboring real item.
    const step = edge === "start" ? 1 : -1;
    for (let k = 0; k < 50 && idx === undefined; k++) {
      raw += step;
      idx = map.get(raw);
    }
    atEdge = true;
    if (idx === undefined) return null;
  }
  const it = pt.items[idx];
  const c = atEdge || charOffset === null ? (edge === "start" ? 0 : it.str.length) : Math.max(0, Math.min(it.str.length, charOffset));
  return srcPos(page, pt.itemSrcStart[idx] + c);
}

export interface SourceSelection {
  srcStart: number;
  srcEnd: number;
  text: string;
  x: number;
  y: number;
}

/** Maps the current DOM text selection (inside pdf.js text layers) to a source range. */
export function selectionToSource(): SourceSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const a = boundaryToSrc(range.startContainer, range.startOffset, "start");
  const b = boundaryToSrc(range.endContainer, range.endOffset, "end");
  if (a === null || b === null || b <= a) return null;
  const r = range.getBoundingClientRect();
  return { srcStart: a, srcEnd: b, text: sel.toString().replace(/\s+/g, " ").trim(), x: r.left + r.width / 2, y: r.top };
}
