import { player } from "./session";
import { chapterRange } from "../pdf/outline";
import { usePlayer } from "../state/player";
import { useReader } from "../state/reader";
import { toast } from "./toast";

let interval: ReturnType<typeof setInterval> | null = null;
let unsub: (() => void) | null = null;

function clear(): void {
  if (interval) clearInterval(interval);
  interval = null;
  unsub?.();
  unsub = null;
}

/** Sleep timer: stop after N minutes (with fade-out), or at the end of the page/chapter. */
export function setSleepTimer(mode: "off" | "time" | "page" | "chapter", minutes = 0): void {
  clear();
  usePlayer.setState({ sleepMode: mode, sleepUntil: mode === "time" ? Date.now() + minutes * 60_000 : null });
  if (mode === "off") return;
  if (mode === "time") {
    interval = setInterval(() => {
      const until = usePlayer.getState().sleepUntil;
      if (until && Date.now() >= until - 8000) {
        clear();
        usePlayer.setState({ sleepMode: "off", sleepUntil: null });
        player.fadeOutAndPause(8);
        toast("Sleep timer: playback paused.");
      }
    }, 1000);
    return;
  }
  const startPage = usePlayer.getState().position?.page ?? useReader.getState().currentPage;
  const r = useReader.getState();
  const endPage = mode === "page" ? startPage : (chapterRange(r.outline, startPage, r.numPages)?.[1] ?? startPage);
  unsub = usePlayer.subscribe((s) => {
    if (s.position && s.position.page > endPage) {
      clear();
      usePlayer.setState({ sleepMode: "off", sleepUntil: null });
      player.fadeOutAndPause(1.5);
      toast(mode === "page" ? "Sleep timer: end of page." : "Sleep timer: end of chapter.");
    }
  });
}
