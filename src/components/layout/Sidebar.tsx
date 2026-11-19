import { useEffect, useRef, useState } from "react";
import { BookMarked, Highlighter, Library, ListTree, Search, LayoutGrid } from "lucide-react";
import { useSettings, type UiSettings } from "../../state/settings";
import { useUi } from "../../state/ui";
import { cx } from "../ui";
import { AnnotationsPanel, BookmarksPanel, LibraryPanel, OutlinePanel, SearchPanel, ThumbnailsPanel } from "../sidebar/Panels";

const TABS: { id: UiSettings["sidebarTab"]; label: string; icon: typeof ListTree }[] = [
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "thumbnails", label: "Pages", icon: LayoutGrid },
  { id: "search", label: "Search", icon: Search },
  { id: "bookmarks", label: "Bookmarks", icon: BookMarked },
  { id: "annotations", label: "Highlights & notes", icon: Highlighter },
  { id: "library", label: "Library", icon: Library },
];

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 560;
export const SIDEBAR_DEFAULT = 288;

const clampWidth = (w: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w, window.innerWidth * 0.6)));
const commitWidth = (w: number) => useSettings.getState().set("ui", { sidebarWidth: clampWidth(w) });

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const mq = matchMedia("(max-width: 767.98px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Drag handle on the sidebar's right edge (pointer, double-click reset, arrow keys). */
function ResizeHandle({ aside, width }: { aside: React.RefObject<HTMLElement | null>; width: number }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (aside.current) commitWidth(aside.current.offsetWidth);
    useUi.setState({ resizingSidebar: false });
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none focus-visible:outline-none"
      onPointerDown={(e) => {
        if (!aside.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: aside.current.offsetWidth };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        useUi.setState({ resizingSidebar: true });
      }}
      onPointerMove={(e) => {
        if (!drag.current || !aside.current) return;
        // Only the element style changes while dragging; the setting is committed on release.
        aside.current.style.width = `${clampWidth(drag.current.w + e.clientX - drag.current.x)}px`;
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          commitWidth(width + (e.key === "ArrowRight" ? 16 : -16));
        }
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100 group-active:opacity-100" />
    </div>
  );
}

export function Sidebar() {
  const tab = useSettings((s) => s.ui.sidebarTab);
  const stored = useSettings((s) => s.ui.sidebarWidth);
  const set = (t: UiSettings["sidebarTab"]) => useSettings.getState().set("ui", { sidebarTab: t });
  const aside = useRef<HTMLElement>(null);
  const narrow = useIsNarrow();
  const width = clampWidth(stored || SIDEBAR_DEFAULT);
  return (
    <aside
      ref={aside}
      style={{ width: narrow ? `min(85vw, ${width}px)` : width }}
      className="relative flex shrink-0 flex-col border-r border-line bg-panel max-md:absolute max-md:inset-y-12 max-md:left-0 max-md:z-20 max-md:shadow-xl"
      aria-label="Sidebar"
      data-testid="sidebar"
    >
      {!narrow && <ResizeHandle aside={aside} width={width} />}
      <div role="tablist" aria-label="Sidebar panels" className="flex border-b border-line px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-label={t.label}
            title={t.label}
            onClick={() => set(t.id)}
            className={cx("flex flex-1 items-center justify-center border-b-2 py-2.5", tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg")}
          >
            <t.icon size={17} />
          </button>
        ))}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        role="tabpanel"
        onClickCapture={(e) => {
          // On phones the sidebar overlays the page: close it after navigating.
          if (window.innerWidth < 768 && (e.target as HTMLElement).closest("li button")) setTimeout(() => useSettings.getState().set("ui", { sidebarOpen: false }), 0);
        }}
      >
        <h2 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{TABS.find((t) => t.id === tab)?.label}</h2>
        {tab === "outline" && <OutlinePanel />}
        {tab === "thumbnails" && <ThumbnailsPanel />}
        {tab === "search" && <SearchPanel />}
        {tab === "bookmarks" && <BookmarksPanel />}
        {tab === "annotations" && <AnnotationsPanel />}
        {tab === "library" && <LibraryPanel />}
      </div>
    </aside>
  );
}
