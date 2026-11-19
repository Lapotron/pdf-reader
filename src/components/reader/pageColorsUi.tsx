import { useEffect, useState } from "react";
import { allFilterSpecs, filterId, isDarkSet, PAGE_COLOR_DEFAULT_FOR_THEME, PAGE_COLOR_SETS, resolvePageColors, type PageColorSet, type PageImageMode } from "../../pdf/pageColors";
import { useSettings } from "../../state/settings";
import { Segmented, cx } from "../ui";

/** The app theme actually in effect ("system" resolved). */
export function useResolvedTheme(): "light" | "dark" | "sepia" {
  const theme = useSettings((s) => s.appearance.theme);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export interface PageColorsState {
  set: PageColorSet;
  mode: PageImageMode;
  dark: boolean;
  /** CSS filter value for page canvases and thumbnails. */
  filter: string;
}

export function usePageColors(): PageColorsState {
  const theme = useResolvedTheme();
  const setting = useSettings((s) => s.appearance.pageColors);
  const mode = useSettings((s) => s.appearance.pageImages);
  const set = resolvePageColors(setting, theme);
  const id = filterId(set, mode);
  return { set, mode, dark: isDarkSet(set), filter: id ? `url(#${id})` : "none" };
}

const f = (n: number) => n.toFixed(4);

/** Hidden SVG with one recoloring filter per color set and image mode. Mount once. */
export function PageColorFilters() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {allFilterSpecs().map((s) => (
          <filter key={s.id} id={s.id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            {s.luminance && <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0" />}
            {s.invertHue && (
              <>
                <feComponentTransfer>
                  <feFuncR type="table" tableValues="1 0" />
                  <feFuncG type="table" tableValues="1 0" />
                  <feFuncB type="table" tableValues="1 0" />
                </feComponentTransfer>
                <feColorMatrix type="hueRotate" values="180" />
              </>
            )}
            <feComponentTransfer>
              <feFuncR type="linear" slope={f(s.to[0] - s.from[0])} intercept={f(s.from[0])} />
              <feFuncG type="linear" slope={f(s.to[1] - s.from[1])} intercept={f(s.from[1])} />
              <feFuncB type="linear" slope={f(s.to[2] - s.from[2])} intercept={f(s.from[2])} />
            </feComponentTransfer>
          </filter>
        ))}
      </defs>
    </svg>
  );
}

/** Swatch grid for choosing page colors, plus the image mode. */
export function PageColorPicker({ onPick }: { onPick?: () => void }) {
  const setting = useSettings((s) => s.appearance.pageColors);
  const mode = useSettings((s) => s.appearance.pageImages);
  const theme = useResolvedTheme();
  const set = (p: Partial<{ pageColors: string; pageImages: PageImageMode }>) => useSettings.getState().set("appearance", p);
  const autoSet = resolvePageColors("auto", theme);
  const swatch = (s: PageColorSet, id: string, label: string, sub: string) => {
    const active = setting === id;
    return (
      <button
        key={id}
        role="radio"
        aria-checked={active}
        aria-label={`Page colors: ${label}`}
        data-testid={`page-colors-${id}`}
        onClick={() => {
          set({ pageColors: id });
          onPick?.();
        }}
        className={cx("flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors", active ? "border-accent ring-1 ring-accent" : "border-line hover:bg-panel-2")}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-black/10 text-sm font-semibold" style={{ background: s.paper, color: s.ink }}>
          Aa
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{label}</span>
          <span className="block truncate text-[11px] text-muted">{sub}</span>
        </span>
      </button>
    );
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Page colors" className="grid grid-cols-2 gap-1.5">
        {swatch(autoSet, "auto", "Auto", `Follows theme · ${autoSet.name}`)}
        {PAGE_COLOR_SETS.map((s) => swatch(s, s.id, s.name, s.note))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[13px]">Images</span>
        <Segmented<PageImageMode>
          label="Images"
          value={mode}
          onChange={(v) => set({ pageImages: v })}
          options={[
            { value: "keep", label: "Keep colors", title: "Flip lightness but keep hues (charts, colored text)" },
            { value: "duotone", label: "Duotone", title: "Everything in the two page colors (text-only documents)" },
          ]}
        />
      </div>
    </div>
  );
}

export { PAGE_COLOR_DEFAULT_FOR_THEME };
