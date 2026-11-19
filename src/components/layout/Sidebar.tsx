import { BookMarked, Highlighter, Library, ListTree, Search, LayoutGrid } from "lucide-react";
import { useSettings, type UiSettings } from "../../state/settings";
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

export function Sidebar() {
  const tab = useSettings((s) => s.ui.sidebarTab);
  const set = (t: UiSettings["sidebarTab"]) => useSettings.getState().set("ui", { sidebarTab: t });
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel max-md:absolute max-md:inset-y-12 max-md:left-0 max-md:z-20 max-md:shadow-xl" aria-label="Sidebar">
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
