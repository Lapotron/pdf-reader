import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TextLayer } from "pdfjs-dist";
import { getSession } from "../../app/session";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import type { AnnotationRow } from "../../db/schema";
import type { Rect } from "../../pdf/types";
import { acquireRenderSlot } from "./renderSlots";

interface Props {
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
  scale: number;
  annotations: AnnotationRow[];
}

const rectStyle = (r: Rect, s: number, pad = 0): CSSProperties => ({
  left: (r.x - pad) * s,
  top: (r.y - pad) * s,
  width: (r.w + 2 * pad) * s,
  height: (r.h + 2 * pad) * s,
});

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}
export { hexToRgba };

/** Sentence + word highlight for the spoken text on this page. */
function SyncOverlay({ page, scale, ready }: { page: number; scale: number; ready: boolean }) {
  const srcStart = usePlayer((s) => s.position?.srcStart ?? null);
  const srcEnd = usePlayer((s) => s.position?.srcEnd ?? null);
  const { sentenceStyle, sentenceColor, wordStyle, wordColor } = useSettings((s) => s.reading);
  const w1 = useRef<HTMLDivElement>(null);
  const w2 = useRef<HTMLDivElement>(null);

  const sentenceRects = useMemo(() => {
    const model = getSession()?.model;
    if (!model || srcStart === null || srcEnd === null || !ready) return [];
    return model.rectsFor(srcStart, srcEnd).filter((r) => r.page === page);
  }, [srcStart, srcEnd, page, ready]);

  useEffect(() => {
    const apply = (start: number | null, end: number | null) => {
      const els = [w1.current, w2.current];
      const model = getSession()?.model;
      const rects = model && start !== null && end !== null && ready ? model.rectsFor(start, end).filter((r) => r.page === page) : [];
      els.forEach((el, i) => {
        if (!el) return;
        const r = rects[i];
        if (!r) {
          el.style.display = "none";
          return;
        }
        el.style.display = "block";
        const pad = 1.2;
        el.style.width = `${(r.rect.w + 2 * pad) * scale}px`;
        el.style.height = `${wordStyle === "underline" ? 3 : (r.rect.h + 2 * pad) * scale}px`;
        const y = wordStyle === "underline" ? (r.rect.y + r.rect.h) * scale : (r.rect.y - pad) * scale;
        el.style.transform = `translate(${(r.rect.x - pad) * scale}px, ${y}px)`;
      });
    };
    const s = usePlayer.getState().position;
    apply(s?.wordStart ?? null, s?.wordEnd ?? null);
    return usePlayer.subscribe((st, prev) => {
      if (st.position?.wordStart !== prev.position?.wordStart || st.position?.wordEnd !== prev.position?.wordEnd) apply(st.position?.wordStart ?? null, st.position?.wordEnd ?? null);
    });
  }, [page, scale, ready, wordStyle]);

  return (
    <div className="overlay" aria-hidden>
      {sentenceStyle !== "off" &&
        sentenceRects.map((r, i) => (
          <div
            key={i}
            className="hl"
            data-testid="sentence-hl"
            style={
              sentenceStyle === "fill"
                ? { ...rectStyle(r.rect, scale, 1), background: hexToRgba(sentenceColor, 0.55) }
                : { left: r.rect.x * scale, top: (r.rect.y + r.rect.h) * scale, width: r.rect.w * scale, height: 2, background: sentenceColor }
            }
          />
        ))}
      {wordStyle !== "off" &&
        [w1, w2].map((ref, i) => <div key={i} ref={ref} className="word-hl" data-testid={i === 0 ? "word-hl" : undefined} style={{ display: "none", color: wordColor, background: hexToRgba(wordColor, wordStyle === "fill" ? 0.5 : 1) }} />)}
    </div>
  );
}

function AnnotationOverlay({ page, scale, annotations }: { page: number; scale: number; annotations: AnnotationRow[] }) {
  return (
    <div className="overlay" aria-hidden>
      {annotations.flatMap((a) =>
        a.rects
          .filter((r) => r.page === page)
          .map((r, i) => (
            <div key={`${a.id}-${i}`} className="hl" title={a.note || a.quote} data-testid="annotation-hl" style={{ ...rectStyle(r.rect, scale, 1), background: hexToRgba(a.color, 0.45) }} />
          )),
      )}
      {annotations
        .filter((a) => a.note && a.rects[0]?.page === page)
        .map((a) => (
          <div key={`n-${a.id}`} className="absolute h-2.5 w-2.5 rounded-full border border-white shadow" style={{ left: a.rects[0].rect.x * scale - 6, top: a.rects[0].rect.y * scale - 6, background: a.color }} />
        ))}
    </div>
  );
}

function SearchOverlay({ page, scale, ready }: { page: number; scale: number; ready: boolean }) {
  const hits = useReader((s) => s.searchHits);
  const active = useReader((s) => s.activeHit);
  const rects = useMemo(() => {
    const model = getSession()?.model;
    if (!model || !ready) return [];
    return hits.flatMap((h, i) => (h.page === page ? model.rectsFor(h.srcStart, h.srcEnd).map((r) => ({ ...r, active: i === active })) : []));
  }, [hits, active, page, ready]);
  return (
    <div className="overlay" aria-hidden>
      {rects.map((r, i) => (
        <div key={i} className="hl" style={{ ...rectStyle(r.rect, scale, 1), background: r.active ? "rgba(249,115,22,0.55)" : "rgba(250,204,21,0.45)", outline: r.active ? "2px solid #f97316" : undefined }} />
      ))}
    </div>
  );
}

function DebugOverlay({ page, scale, ready }: { page: number; scale: number; ready: boolean }) {
  const pt = ready ? getSession()?.text.peekPageText(page) : undefined;
  if (!pt) return null;
  const colors: Record<string, string> = { body: "#3b82f6", header: "#ef4444", footer: "#ef4444", pageNum: "#ef4444", footnote: "#a855f7", caption: "#10b981", table: "#f59e0b", rotated: "#6b7280" };
  return (
    <div className="overlay" aria-hidden>
      {pt.blocks.map((b, i) => (
        <div key={`b${i}`} className="absolute border border-dashed" style={{ ...rectStyle(b.rect, scale, 2), borderColor: colors[b.role] }}>
          <span className="absolute -left-4 -top-2 rounded bg-black px-1 text-[10px] text-white">{i + 1}</span>
        </div>
      ))}
      {pt.lines.map((l, i) => (
        <div key={`l${i}`} className="absolute" style={{ ...rectStyle(l.rect, scale), outline: `1px solid ${colors[l.role]}`, opacity: 0.6 }} title={`${l.role}: ${l.text}`} />
      ))}
    </div>
  );
}

export const PageView = memo(function PageView({ page, top, left, width, height, scale, annotations }: Props) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const debug = useSettings((s) => s.ui.debug);

  // Canvas rendering (old canvas stays visible, stretched, until the new one is ready).
  useEffect(() => {
    const s = getSession();
    if (!s) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let release: (() => void) | null = null;
    const timer = setTimeout(async () => {
      try {
        release = await acquireRenderSlot();
        if (cancelled) return;
        const pg = await s.pdf.getPage(page);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const cssW = pg.getViewport({ scale }).width;
        const cssH = pg.getViewport({ scale }).height;
        const out = Math.min(dpr, Math.sqrt(16e6 / Math.max(1, cssW * cssH)));
        const vp = pg.getViewport({ scale: scale * out });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.setAttribute("aria-hidden", "true");
        task = pg.render({ canvas, viewport: vp });
        await task.promise;
        if (cancelled) return;
        const host = canvasHost.current;
        if (host) {
          for (const old of host.querySelectorAll("canvas")) {
            old.width = 0;
            old.height = 0;
          }
          host.replaceChildren(canvas);
          setRendered(true);
        }
      } catch (e) {
        if ((e as Error)?.name !== "RenderingCancelledException") console.warn(`Render failed for page ${page}`, e);
      } finally {
        release?.();
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
      release?.();
    };
  }, [page, scale]);

  // Free canvas memory when unmounted.
  useEffect(
    () => () => {
      for (const c of canvasHost.current?.querySelectorAll("canvas") ?? []) {
        c.width = 0;
        c.height = 0;
      }
    },
    [],
  );

  // Text extraction (for hit-testing/highlights) and the selectable pdf.js text layer.
  useEffect(() => {
    const s = getSession();
    if (!s) return;
    let cancelled = false;
    let tl: TextLayer | null = null;
    void s.text.getPageText(page).then(() => !cancelled && setReady(true)).catch(() => {});
    (async () => {
      try {
        const pg = await s.pdf.getPage(page);
        const tc = await s.text.getTextContent(page);
        if (cancelled || !textLayerRef.current) return;
        const div = textLayerRef.current;
        div.replaceChildren();
        tl = new TextLayer({ textContentSource: tc as never, container: div, viewport: pg.getViewport({ scale }) });
        await tl.render();
        if (cancelled) return;
        tl.textDivs.forEach((d, i) => (d.dataset.raw = String(i)));
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      tl?.cancel();
    };
  }, [page, scale]);

  return (
    <div
      className="pdf-page"
      data-page={page}
      data-rendered={rendered ? "1" : "0"}
      data-testid="pdf-page"
      style={{ top, left, width, height, ["--total-scale-factor" as string]: scale } as CSSProperties}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      <AnnotationOverlay page={page} scale={scale} annotations={annotations} />
      <SearchOverlay page={page} scale={scale} ready={ready} />
      <SyncOverlay page={page} scale={scale} ready={ready} />
      {debug && <DebugOverlay page={page} scale={scale} ready={ready} />}
      <div ref={textLayerRef} className="textLayer" />
    </div>
  );
});
