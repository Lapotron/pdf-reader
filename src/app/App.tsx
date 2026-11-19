import { useEffect } from "react";
import { useHashRoute } from "./useHashRoute";
import { useSettings } from "../state/settings";
import { usePlayer } from "../state/player";
import { LibraryView } from "../components/library/LibraryView";
import { ReaderView } from "../components/reader/ReaderView";
import { useToasts, toast } from "./toast";
import { cx } from "../components/ui";
import { audioCache } from "../tts/audioCache";
import { usePwa } from "./pwa";
import { PageColorFilters } from "../components/reader/pageColorsUi";

function UpdateBanner() {
  const need = usePwa((s) => s.needRefresh);
  const update = usePwa((s) => s.update);
  if (!need) return null;
  return (
    <div role="status" className="fixed right-4 top-4 z-[60] flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-xl">
      A new version of Mega Reader is available.
      <button className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-fg" onClick={() => void update?.()}>
        Reload
      </button>
      <button className="text-muted hover:text-fg" onClick={() => usePwa.setState({ needRefresh: false })}>
        Later
      </button>
    </div>
  );
}

function useTheme() {
  const theme = useSettings((s) => s.appearance.theme);
  useEffect(() => {
    const apply = () => {
      const t = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = t;
    };
    apply();
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cx("pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg", t.kind === "error" ? "bg-danger text-white" : "bg-fg text-bg")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  useTheme();
  const route = useHashRoute();
  const cacheMB = useSettings((s) => s.reading.audioCacheMB);
  useEffect(() => {
    audioCache.maxBytes = cacheMB * 1024 * 1024;
  }, [cacheMB]);
  // Surface engine notices (e.g. fallback) as toasts.
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (s.notice && s.notice !== prev.notice) {
          toast(s.notice, "info", 7000);
          usePlayer.setState({ notice: null });
        }
      }),
    [],
  );
  return (
    <>
      {route.name === "doc" ? <ReaderView key={route.id} docId={route.id} /> : <LibraryView />}
      <Toasts />
      <UpdateBanner />
      <PageColorFilters />
    </>
  );
}
