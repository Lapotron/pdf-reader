import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleHelp, Library, Minus, Moon, PanelLeft, Plus, Search, Settings, Sun, Coffee, Monitor, Focus, Rows3 } from "lucide-react";
import { navigate } from "../../app/useHashRoute";
import * as A from "../../app/actions";
import { PDF_TO_CSS } from "../../pdf/pdfjs";
import { useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { useUi, openSettings } from "../../state/ui";
import { IconButton, cx } from "../ui";

function PageInput() {
  const current = useReader((s) => s.currentPage);
  const n = useReader((s) => s.numPages);
  const [v, setV] = useState(String(current));
  useEffect(() => setV(String(current)), [current]);
  return (
    <div className="flex items-center gap-1 text-sm">
      <IconButton label="Previous page" onClick={() => A.gotoPage(current - 1)} disabled={current <= 1}>
        <ChevronLeft size={18} />
      </IconButton>
      <input
        aria-label="Page number"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") A.gotoPage(Number(v) || 1);
        }}
        onBlur={() => setV(String(current))}
        className="h-8 w-12 rounded-md border border-line bg-panel-2 text-center tabular-nums"
        data-testid="page-input"
      />
      <span className="text-muted tabular-nums" data-testid="page-count">
        / {n}
      </span>
      <IconButton label="Next page" onClick={() => A.gotoPage(current + 1)} disabled={current >= n}>
        <ChevronRight size={18} />
      </IconButton>
    </div>
  );
}

function ZoomControl() {
  const scale = useReader((s) => s.scale);
  const mode = useSettings((s) => s.ui.zoomMode);
  const pct = Math.round((scale / PDF_TO_CSS) * 100);
  return (
    <div className="hidden items-center gap-0.5 md:flex">
      <IconButton label="Zoom out" onClick={() => A.zoomBy(-1)}>
        <Minus size={16} />
      </IconButton>
      <select
        aria-label="Zoom"
        value={mode === "custom" ? "custom" : mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "fit-width" || v === "fit-page") A.setZoomMode(v);
          else if (v !== "custom") useSettings.getState().set("ui", { zoomMode: "custom", zoom: Number(v) });
        }}
        className="h-8 rounded-md border border-line bg-panel-2 px-1.5 text-sm tabular-nums"
      >
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        <option value="custom">{pct}%</option>
        {A.ZOOM_STEPS.map((z) => (
          <option key={z} value={z}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
      <IconButton label="Zoom in" onClick={() => A.zoomBy(1)}>
        <Plus size={16} />
      </IconButton>
    </div>
  );
}

const themeIcon = { light: Sun, dark: Moon, sepia: Coffee, system: Monitor } as const;

export function TopBar() {
  const title = useReader((s) => s.title);
  const sidebarOpen = useSettings((s) => s.ui.sidebarOpen);
  const ruler = useSettings((s) => s.ruler);
  const theme = useSettings((s) => s.appearance.theme);
  const ThemeIcon = themeIcon[theme];
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <IconButton label="Library" onClick={() => navigate({ name: "library" })}>
        <Library size={18} />
      </IconButton>
      <IconButton label="Toggle sidebar" active={sidebarOpen} onClick={() => useSettings.getState().set("ui", { sidebarOpen: !sidebarOpen })}>
        <PanelLeft size={18} />
      </IconButton>
      <h1 className="mx-2 min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </h1>
      <PageInput />
      <span className="mx-1 hidden h-6 w-px bg-line md:block" />
      <ZoomControl />
      <span className="mx-1 hidden h-6 w-px bg-line md:block" />
      <IconButton
        label="Search"
        onClick={() => {
          useSettings.getState().set("ui", { sidebarOpen: true, sidebarTab: "search" });
          setTimeout(() => document.querySelector<HTMLInputElement>("[data-search-input]")?.focus(), 50);
        }}
      >
        <Search size={18} />
      </IconButton>
      <IconButton label="Reading line (R)" active={ruler.enabled} onClick={A.toggleRuler} data-testid="toggle-ruler">
        <Rows3 size={18} />
      </IconButton>
      <IconButton label="Focus mask (M)" active={ruler.enabled && ruler.mask} onClick={A.toggleMask}>
        <Focus size={18} />
      </IconButton>
      <IconButton label={`Theme: ${theme}`} onClick={A.cycleTheme}>
        <ThemeIcon size={18} />
      </IconButton>
      <IconButton label="Keyboard shortcuts (?)" className={cx("hidden sm:inline-flex")} onClick={() => useUi.setState({ helpOpen: true })}>
        <CircleHelp size={18} />
      </IconButton>
      <IconButton label="Settings" onClick={() => openSettings()} data-testid="open-settings">
        <Settings size={18} />
      </IconButton>
    </header>
  );
}
