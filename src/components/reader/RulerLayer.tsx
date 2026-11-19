import { useEffect, useRef } from "react";
import { getSession } from "../../app/session";
import { usePlayer } from "../../state/player";
import { useSettings, type RulerSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { union } from "../../lib/geom";
import type { Rect } from "../../pdf/types";
import type { DocLayout } from "./layout";
import { hexToRgba } from "./PageView";

export interface RulerTarget {
  page: number;
  rect: Rect;
  lineIndex?: number;
}

/** The base-space rect the reading line should cover for the current spoken position. */
export function rulerTargetFromPlayer(r: RulerSettings): RulerTarget | null {
  const pos = usePlayer.getState().position;
  const s = getSession();
  if (!pos || !s) return null;
  const src = pos.wordStart ?? pos.srcStart;
  const ln = s.model.lineAt(src);
  if (!ln) return null;
  const pt = s.text.peekPageText(ln.page);
  let rect = ln.line.rect;
  if (pt && r.linesAhead > 0) {
    for (let k = 1; k <= r.linesAhead; k++) {
      const next = pt.lines[ln.index + k];
      if (!next || next.block !== ln.line.block) break;
      rect = union(rect, next.rect);
    }
  }
  if (r.span === "column") rect = { ...rect, x: ln.block.rect.x, w: ln.block.rect.w };
  else if (r.span === "page" && pt) rect = { ...rect, x: 0, w: pt.width };
  return { page: ln.page, rect, lineIndex: ln.index };
}

/**
 * Floating reading line: a band (or underline / clear window) that glides to the line being
 * read, optionally masking the rest of the page to keep focus. Positioned in content space so
 * it scrolls natively with the pages.
 */
export function RulerLayer({ layout, scale }: { layout: DocLayout; scale: number }) {
  const ruler = useSettings((s) => s.ruler);
  const el = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const apply = () => {
      const st = usePlayer.getState();
      const active = st.position && st.state !== "idle" && st.state !== "error";
      const manual = useUi.getState().manualRuler;
      const target = active || !manual ? rulerTargetFromPlayer(ruler) : manual;
      const L = layoutRef.current;
      if (!ruler.enabled || !target || target.page < 1 || target.page > L.tops.length) {
        node.style.opacity = "0";
        node.dataset.page = "";
        return;
      }
      const pad = ruler.padding;
      const pageTop = L.tops[target.page - 1];
      const pageLeft = L.lefts[target.page - 1];
      let x = pageLeft + (target.rect.x - pad) * scale;
      let w = (target.rect.w + 2 * pad) * scale;
      let y = pageTop + (target.rect.y - pad) * scale;
      let h = (target.rect.h + 2 * pad) * scale;
      if (ruler.heightMode === "fixed") {
        const cy = y + h / 2;
        h = ruler.heightPx;
        y = cy - h / 2;
      }
      if (ruler.mode === "underline") {
        y = y + h - 2;
        h = 3;
      }
      x = Math.max(pageLeft - 4, x);
      w = Math.min(w, L.widths[target.page - 1] + 8);
      node.style.opacity = "1";
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      node.style.width = `${Math.round(w)}px`;
      node.style.height = `${Math.round(h)}px`;
      node.dataset.page = String(target.page);
    };
    apply();
    const unsubs = [
      usePlayer.subscribe((s, p) => {
        if (s.position !== p.position || s.state !== p.state) apply();
      }),
      useUi.subscribe((s, p) => {
        if (s.manualRuler !== p.manualRuler) apply();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [ruler, scale, layout]);

  const mask = ruler.mask || ruler.mode === "window";
  const maskShadow = mask ? `0 0 0 200vmax ${hexToRgba(ruler.maskColor, ruler.maskOpacity)}` : "none";
  const style: React.CSSProperties = {
    opacity: 0,
    transition: `transform ${ruler.animationMs}ms ease-out, width ${ruler.animationMs}ms ease-out, height ${ruler.animationMs}ms ease-out, opacity 150ms`,
    borderRadius: ruler.mode === "underline" ? 2 : 6,
    background: ruler.mode === "band" ? hexToRgba(ruler.color, ruler.opacity) : ruler.mode === "underline" ? ruler.color : "transparent",
    boxShadow: ruler.mode === "window" ? `${maskShadow}, inset 0 0 0 1.5px ${hexToRgba(ruler.color, 0.7)}` : maskShadow,
    mixBlendMode: ruler.mode === "band" && !mask ? "multiply" : undefined,
  };
  return <div ref={el} className="ruler" data-testid="reading-ruler" aria-hidden style={style} />;
}
