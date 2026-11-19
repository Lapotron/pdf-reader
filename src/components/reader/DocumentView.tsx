import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LocateFixed } from "lucide-react";
import { getSession, player } from "../../app/session";
import { db, type AnnotationRow } from "../../db/schema";
import { PDF_TO_CSS } from "../../pdf/pdfjs";
import { srcPos } from "../../pdf/types";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { pauseFollow, resumeFollow, useUi } from "../../state/ui";
import { selectionToSource } from "./selection";
import { computeLayout, fitScale, pageAtY, type DocLayout } from "./layout";
import { PageView } from "./PageView";
import { RulerLayer, rulerTargetFromPlayer } from "./RulerLayer";
import { SelectionMenu } from "./SelectionMenu";
import { cx } from "../ui";

const NO_ANNOTATIONS: AnnotationRow[] = [];
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

export function DocumentView() {
  const sizes = useReader((s) => s.sizes);
  const docId = useReader((s) => s.docId);
  const zoomMode = useSettings((s) => s.ui.zoomMode);
  const zoom = useSettings((s) => s.ui.zoom);
  const followMode = useSettings((s) => s.reading.followMode);
  const clickToRead = useSettings((s) => s.reading.clickToRead);
  const ruler = useSettings((s) => s.ruler);
  const pageTint = useSettings((s) => s.appearance.pageTint);
  const followPaused = useUi((s) => s.followPaused);
  const playerState = usePlayer((s) => s.state);
  const showBack = followPaused && (playerState === "playing" || playerState === "buffering" || playerState === "loading" || playerState === "paused");
  const container = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [range, setRange] = useState({ first: 0, last: 2 });
  const draggingScrollbar = useRef(false);
  const resumeCheck = useRef<ReturnType<typeof setTimeout> | null>(null);

  const annotations = useLiveQuery(() => (docId ? db.annotations.where("docId").equals(docId).toArray() : NO_ANNOTATIONS), [docId]) ?? NO_ANNOTATIONS;

  // Viewport size.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    // While the sidebar is being dragged, skip relayout (fit-width would re-render every page on
    // every pixel); measure once when the drag ends.
    const ro = new ResizeObserver(() => !useUi.getState().resizingSidebar && measure());
    ro.observe(el);
    measure();
    const unsub = useUi.subscribe((s, p) => p.resizingSidebar && !s.resizingSidebar && measure());
    return () => {
      ro.disconnect();
      unsub();
    };
  }, []);

  const scale = useMemo(() => fitScale(zoomMode, zoom, sizes, vp.w, vp.h, PDF_TO_CSS), [zoomMode, zoom, sizes, vp.w, vp.h]);
  const layout = useMemo(() => computeLayout(sizes, scale, vp.w), [sizes, scale, vp.w]);
  const layoutRef = useRef<DocLayout>(layout);
  const scaleRef = useRef(scale);

  useEffect(() => {
    useReader.setState({ scale });
  }, [scale]);

  const scrollToY = useCallback((top: number, smooth: boolean) => {
    const el = container.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Keep the viewport anchored when the scale changes (zoom / resize).
  useLayoutEffect(() => {
    const el = container.current;
    const prev = layoutRef.current;
    if (el && prev.tops.length && prev !== layout && scaleRef.current !== scale) {
      const center = el.scrollTop + el.clientHeight / 2;
      const i = pageAtY(prev, center);
      const frac = (center - prev.tops[i]) / Math.max(1, prev.heights[i]);
      const newTop = layout.tops[i] + frac * layout.heights[i] - el.clientHeight / 2;
      el.scrollTop = Math.max(0, newTop);
    }
    layoutRef.current = layout;
    scaleRef.current = scale;
  }, [layout, scale]);

  const updateRange = useCallback(() => {
    const el = container.current;
    const L = layoutRef.current;
    if (!el || !L.tops.length) return;
    const first = pageAtY(L, el.scrollTop - el.clientHeight * 0.5);
    const last = pageAtY(L, el.scrollTop + el.clientHeight * 1.5);
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    const cur = pageAtY(L, el.scrollTop + el.clientHeight * 0.35) + 1;
    if (useReader.getState().currentPage !== cur) useReader.setState({ currentPage: cur });
  }, []);

  useEffect(updateRange, [layout, updateRange]);

  // Following pauses only on real user input (wheel, touch, scroll keys, scrollbar drag,
  // navigation). Programmatic smooth scrolls never count, however long they take.
  useEffect(() => {
    const up = () => (draggingScrollbar.current = false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (resumeCheck.current) clearTimeout(resumeCheck.current);
    };
  }, []);

  /** If the user scrolled the spoken line back into the comfortable band, follow again. */
  const resumeIfLineInView = useCallback(() => {
    const el = container.current;
    const L = layoutRef.current;
    if (!el || !L.tops.length || !useUi.getState().followPaused) return;
    const target = rulerTargetFromPlayer(useSettings.getState().ruler);
    if (!target) return;
    const top = L.tops[target.page - 1] + target.rect.y * scaleRef.current;
    const bottom = top + target.rect.h * scaleRef.current;
    if (top >= el.scrollTop + el.clientHeight * 0.12 && bottom <= el.scrollTop + el.clientHeight * 0.72) resumeFollow();
  }, []);

  const onScroll = () => {
    updateRange();
    if (draggingScrollbar.current) pauseFollow();
    if (useUi.getState().followPaused) {
      // Check once the scrolling settles, so small scrolls don't flicker the button.
      if (resumeCheck.current) clearTimeout(resumeCheck.current);
      resumeCheck.current = setTimeout(resumeIfLineInView, 350);
    }
  };

  // Ctrl/Cmd + wheel zoom.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const s = useSettings.getState();
      const current = scaleRef.current / PDF_TO_CSS;
      const next = Math.min(4, Math.max(0.25, current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      s.set("ui", { zoomMode: "custom", zoom: Math.round(next * 100) / 100 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Scroll requests (outline, search, bookmarks, resume).
  useEffect(
    () =>
      useReader.subscribe((s, p) => {
        const req = s.scrollRequest;
        if (!req || req === p.scrollRequest) return;
        const L = layoutRef.current;
        if (!L.tops.length) return;
        const i = Math.min(L.tops.length - 1, Math.max(0, req.page - 1));
        const el = container.current;
        const top = req.y !== undefined ? L.tops[i] + req.y * scaleRef.current - (el?.clientHeight ?? 0) * 0.3 : L.tops[i] - 8;
        pauseFollow(); // user navigation (outline, search, bookmarks, page keys)
        scrollToY(top, !!req.smooth);
      }),
    [scrollToY],
  );

  // Apply a pending scroll request once layout exists (e.g. resume position on open).
  useEffect(() => {
    const req = useReader.getState().scrollRequest;
    if (req && layout.tops.length && container.current && container.current.scrollTop === 0 && req.page > 1) {
      const i = Math.min(layout.tops.length - 1, req.page - 1);
      scrollToY(layout.tops[i] - 8, false);
    }
  }, [layout.tops.length, scrollToY]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-follow the spoken line.
  const lastLine = useRef("");
  const followNow = useCallback(
    (force: boolean) => {
      const el = container.current;
      const L = layoutRef.current;
      const target = rulerTargetFromPlayer(useSettings.getState().ruler);
      if (!el || !L.tops.length) return;
      if (!target) {
        const pos = usePlayer.getState().position;
        if (pos && force) scrollToY(L.tops[pos.page - 1] - 8, true);
        return;
      }
      const key = `${target.page}:${target.lineIndex}`;
      if (!force && key === lastLine.current) return;
      lastLine.current = key;
      const mode = useSettings.getState().reading.followMode;
      if (mode === "off" && !force) return;
      if (!force && useUi.getState().followPaused) return;
      const s = scaleRef.current;
      const lineTop = L.tops[target.page - 1] + target.rect.y * s;
      const lineBottom = lineTop + target.rect.h * s;
      const vh = el.clientHeight;
      const st = el.scrollTop;
      if (mode === "center-line") scrollToY(lineTop - vh * 0.35, true);
      else if (force || lineTop < st + vh * 0.12 || lineBottom > st + vh * 0.72) scrollToY(lineTop - vh * 0.3, true);
    },
    [scrollToY],
  );

  useEffect(
    () =>
      usePlayer.subscribe((s, p) => {
        if (s.position && s.position !== p.position) followNow(false);
      }),
    [followNow, followMode],
  );

  // Click-to-read and manual ruler.
  const pointToSource = (e: React.MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
    if (!pageEl) return null;
    const page = Number(pageEl.dataset.page);
    const r = pageEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / scaleRef.current;
    const y = (e.clientY - r.top) / scaleRef.current;
    return { page, x, y };
  };

  const startReadingAt = (e: React.MouseEvent) => {
    const p = pointToSource(e);
    const s = getSession();
    if (!p || !s) return;
    const pos = s.model.hitTest(p.page, p.x, p.y);
    window.getSelection()?.removeAllRanges();
    resumeFollow();
    void player.play(pos ?? srcPos(p.page, 0), p.page);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (clickToRead === "double" || e.altKey) startReadingAt(e);
  };

  const onClick = (e: React.MouseEvent) => {
    if (e.altKey && clickToRead !== "double") return startReadingAt(e);
    if (clickToRead !== "single" || e.detail > 1) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    startReadingAt(e);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!ruler.enabled || ruler.manual === "off") return;
    const st = usePlayer.getState();
    if (st.position && st.state !== "idle" && st.state !== "error") return;
    const p = pointToSource(e);
    const s = getSession();
    if (!p || !s) return;
    const pt = s.text.peekPageText(p.page);
    if (!pt) return;
    if (ruler.manual === "mouse") {
      const h = ruler.heightPx / scaleRef.current;
      useUi.setState({ manualRuler: { page: p.page, rect: { x: 0, y: p.y - h / 2, w: pt.width, h } } });
      return;
    }
    let best = -1;
    let bestD = Infinity;
    pt.lines.forEach((l, i) => {
      if (l.role !== "body" && l.role !== "caption" && l.role !== "footnote") return;
      const cy = l.rect.y + l.rect.h / 2;
      const inX = p.x >= l.rect.x - 30 && p.x <= l.rect.x + l.rect.w + 30;
      const d = Math.abs(cy - p.y) + (inX ? 0 : 1000);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD > 40) return;
    const line = pt.lines[best];
    const block = pt.blocks[line.block];
    const rect = ruler.span === "column" ? { ...line.rect, x: block.rect.x, w: block.rect.w } : ruler.span === "page" ? { ...line.rect, x: 0, w: pt.width } : line.rect;
    const cur = useUi.getState().manualRuler;
    if (cur?.page === p.page && cur.lineIndex === best) return;
    useUi.setState({ manualRuler: { page: p.page, rect, lineIndex: best } });
  };

  const onMouseUp = () => {
    setTimeout(() => {
      const sel = selectionToSource();
      useReader.setState({ selection: sel });
    }, 0);
  };

  const pages: number[] = [];
  for (let i = Math.max(0, range.first - 1); i <= Math.min(sizes.length - 1, range.last + 1); i++) pages.push(i + 1);

  return (
    <div className="relative h-full min-w-0 flex-1">
      <div
        ref={container}
        className={cx("isolate h-full overflow-auto bg-bg", pageTint && "tinted")}
        onScroll={onScroll}
        onWheel={(e) => !e.ctrlKey && !e.metaKey && pauseFollow()}
        onTouchMove={pauseFollow}
        onKeyDown={(e) => SCROLL_KEYS.has(e.key) && pauseFollow()}
        onPointerDown={(e) => {
          // A press on the container itself (not its content) is the scrollbar.
          if (e.target === e.currentTarget) draggingScrollbar.current = true;
        }}
        data-testid="document-view"
        tabIndex={-1}
      >
        <div
          className="relative"
          style={{ height: layout.totalHeight, width: layout.contentWidth }}
          onDoubleClick={onDoubleClick}
          onClick={onClick}
          onMouseMove={onMouseMove}
          onMouseLeave={() => useUi.setState({ manualRuler: null })}
          onMouseUp={onMouseUp}
        >
          {pages.map((p) => (
            <PageView
              key={p}
              page={p}
              top={layout.tops[p - 1]}
              left={layout.lefts[p - 1]}
              width={layout.widths[p - 1]}
              height={layout.heights[p - 1]}
              scale={scale}
              annotations={annotations}
            />
          ))}
          <RulerLayer layout={layout} scale={scale} />
        </div>
      </div>
      {showBack && (
        <button
          onClick={() => {
            resumeFollow();
            followNow(true);
          }}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-lg"
          data-testid="back-to-reading"
        >
          <LocateFixed size={16} /> Back to reading position
        </button>
      )}
      <SelectionMenu />
    </div>
  );
}
