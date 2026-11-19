import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LocateFixed } from "lucide-react";
import { getSession, player } from "../../app/session";
import { db } from "../../db/schema";
import { PDF_TO_CSS } from "../../pdf/pdfjs";
import { srcPos } from "../../pdf/types";
import { usePlayer } from "../../state/player";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { selectionToSource } from "./selection";
import { computeLayout, fitScale, pageAtY, type DocLayout } from "./layout";
import { PageView } from "./PageView";
import { RulerLayer, rulerTargetFromPlayer } from "./RulerLayer";
import { SelectionMenu } from "./SelectionMenu";
import { cx } from "../ui";

const USER_SCROLL_HOLD = 4000;

export function DocumentView() {
  const sizes = useReader((s) => s.sizes);
  const docId = useReader((s) => s.docId);
  const zoomMode = useSettings((s) => s.ui.zoomMode);
  const zoom = useSettings((s) => s.ui.zoom);
  const followMode = useSettings((s) => s.reading.followMode);
  const clickToRead = useSettings((s) => s.reading.clickToRead);
  const ruler = useSettings((s) => s.ruler);
  const pageTint = useSettings((s) => s.appearance.pageTint);
  const showBack = useUi((s) => s.showBackToReading);
  const container = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [range, setRange] = useState({ first: 0, last: 2 });
  const programmaticUntil = useRef(0);

  const annotations = useLiveQuery(() => (docId ? db.annotations.where("docId").equals(docId).toArray() : []), [docId]) ?? [];

  // Viewport size.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
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
    programmaticUntil.current = performance.now() + (smooth ? 900 : 150);
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
      programmaticUntil.current = performance.now() + 150;
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

  const markUserScroll = useCallback(() => {
    useUi.setState({ userScrollAt: performance.now() });
    if (player.isActive && !useUi.getState().showBackToReading) useUi.setState({ showBackToReading: true });
  }, []);

  const onScroll = () => {
    updateRange();
    if (performance.now() > programmaticUntil.current) markUserScroll();
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
      if (!force && performance.now() - useUi.getState().userScrollAt < USER_SCROLL_HOLD) return;
      const s = scaleRef.current;
      const lineTop = L.tops[target.page - 1] + target.rect.y * s;
      const lineBottom = lineTop + target.rect.h * s;
      const vh = el.clientHeight;
      const st = el.scrollTop;
      if (mode === "center-line") scrollToY(lineTop - vh * 0.35, true);
      else if (force || lineTop < st + vh * 0.12 || lineBottom > st + vh * 0.72) scrollToY(lineTop - vh * 0.3, true);
      useUi.setState({ showBackToReading: false });
    },
    [scrollToY],
  );

  useEffect(
    () =>
      usePlayer.subscribe((s, p) => {
        if (s.position && s.position !== p.position) followNow(false);
        if (s.state === "idle" && p.state !== "idle") useUi.setState({ showBackToReading: false });
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
    useUi.setState({ userScrollAt: 0, showBackToReading: false });
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
        className={cx("h-full overflow-auto bg-bg", pageTint && "tinted")}
        onScroll={onScroll}
        onWheel={(e) => !e.ctrlKey && markUserScroll()}
        onTouchMove={markUserScroll}
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
            useUi.setState({ userScrollAt: 0 });
            followNow(true);
          }}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-lg"
        >
          <LocateFixed size={16} /> Back to reading position
        </button>
      )}
      <SelectionMenu />
    </div>
  );
}
