/**
 * Page color sets: how rendered PDF pages are recolored to match a reading theme.
 * Each set maps white ("paper") and black ("ink") to its own colors; the recoloring is done on
 * the GPU with SVG filters applied to the page canvas (no re-render).
 */

export interface PageColorSet {
  id: string;
  name: string;
  /** What white becomes. */
  paper: string;
  /** What black becomes. */
  ink: string;
  note: string;
}

export type PageImageMode = "keep" | "duotone";

export const PAGE_COLOR_SETS: PageColorSet[] = [
  { id: "original", name: "Original", paper: "#ffffff", ink: "#000000", note: "Unchanged" },
  { id: "soft-dark", name: "Soft dark", paper: "#1e1f22", ink: "#d7d9de", note: "Neutral dark gray" },
  { id: "night", name: "Warm night", paper: "#1f1b16", ink: "#e6d9c3", note: "Less blue light" },
  { id: "midnight", name: "Midnight", paper: "#0f172a", ink: "#cbd5e1", note: "Blue-gray" },
  { id: "oled", name: "OLED black", paper: "#000000", ink: "#c8cbd0", note: "True black" },
  { id: "low-glare", name: "Low glare", paper: "#2a2a2a", ink: "#b8b8b8", note: "Softer contrast" },
  { id: "high-contrast", name: "High contrast", paper: "#000000", ink: "#ffd84d", note: "Yellow on black" },
  { id: "sepia", name: "Sepia paper", paper: "#f3ead3", ink: "#3a2e1f", note: "Warm paper" },
];

export const PAGE_COLOR_DEFAULT_FOR_THEME: Record<"light" | "dark" | "sepia", string> = {
  light: "original",
  dark: "soft-dark",
  sepia: "sepia",
};

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};

/** WCAG relative luminance. */
export function relLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isDarkSet = (s: PageColorSet) => relLuminance(s.paper) < 0.2;

export function getPageColorSet(id: string): PageColorSet {
  return PAGE_COLOR_SETS.find((s) => s.id === id) ?? PAGE_COLOR_SETS[0];
}

/** The set in effect for a setting ("auto" follows the app theme). */
export function resolvePageColors(setting: string, theme: "light" | "dark" | "sepia"): PageColorSet {
  return getPageColorSet(setting === "auto" ? PAGE_COLOR_DEFAULT_FOR_THEME[theme] : setting);
}

/** SVG filter element id for a set + mode, or null when the page is shown unchanged. */
export function filterId(s: PageColorSet, mode: PageImageMode): string | null {
  return s.id === "original" ? null : `pc-${s.id}-${mode}`;
}

export interface FilterSpec {
  id: string;
  /** Invert lightness and rotate hue by 180° first (keep-colors mode on dark paper). */
  invertHue: boolean;
  /** Convert to luminance first (duotone). */
  luminance: boolean;
  /** Per channel: value at input 0 and at input 1 (after the optional steps above). */
  from: [number, number, number];
  to: [number, number, number];
}

/**
 * Filter recipe for a set:
 * - keep colors on dark paper: invert + hue-rotate(180°) (lightness flips, hues stay), then
 *   0 → paper, 1 → ink;
 * - keep colors on light paper: 0 → ink, 1 → paper (a gentle tint);
 * - duotone: luminance, then 0 → ink, 1 → paper (smooth, no banding).
 */
export function filterSpec(s: PageColorSet, mode: PageImageMode): FilterSpec | null {
  const id = filterId(s, mode);
  if (!id) return null;
  const paper = rgb(s.paper);
  const ink = rgb(s.ink);
  if (mode === "duotone") return { id, invertHue: false, luminance: true, from: ink, to: paper };
  if (isDarkSet(s)) return { id, invertHue: true, luminance: false, from: paper, to: ink };
  return { id, invertHue: false, luminance: false, from: ink, to: paper };
}

export function allFilterSpecs(): FilterSpec[] {
  const out: FilterSpec[] = [];
  for (const s of PAGE_COLOR_SETS) for (const m of ["keep", "duotone"] as const) {
    const f = filterSpec(s, m);
    if (f) out.push(f);
  }
  return out;
}
