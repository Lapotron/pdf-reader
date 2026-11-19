import { useEffect } from "react";
import * as A from "./actions";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { useUi, openSettings } from "../state/ui";

export const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play / pause"],
  ["→ / L", "Next sentence"],
  ["← / J", "Previous sentence"],
  ["Shift + → / ←", "Next / previous paragraph"],
  ["PgDn / PgUp", "Next / previous page"],
  ["] / [", "Faster / slower"],
  ["R", "Toggle reading line"],
  ["M", "Toggle focus mask"],
  ["↑ / ↓", "Move reading line (when not playing)"],
  ["+ / − / 0", "Zoom in / out / fit width"],
  ["Ctrl/⌘ + F", "Search in document"],
  ["B", "Bookmark current position"],
  ["H", "Highlight selected text"],
  ["D", "Toggle layout debug overlay"],
  [",", "Settings"],
  ["?", "Show shortcuts"],
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** Global reader keyboard shortcuts. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        useSettings.getState().set("ui", { sidebarOpen: true, sidebarTab: "search" });
        setTimeout(() => document.querySelector<HTMLInputElement>("[data-search-input]")?.focus(), 50);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const ui = useUi.getState();
      if (ui.settingsOpen || ui.exportOpen || ui.helpOpen) return;
      const k = e.key;
      let handled = true;
      switch (k) {
        case " ":
        case "k":
          if ((e.target as HTMLElement)?.tagName === "BUTTON") return;
          A.togglePlay();
          break;
        case "ArrowRight":
        case "l":
          if (e.shiftKey) void A.jumpParagraph(1);
          else A.nextSentence();
          break;
        case "ArrowLeft":
        case "j":
          if (e.shiftKey) void A.jumpParagraph(-1);
          else A.prevSentence();
          break;
        case "PageDown":
          A.gotoPage(useReader.getState().currentPage + 1);
          break;
        case "PageUp":
          A.gotoPage(useReader.getState().currentPage - 1);
          break;
        case "]":
          A.changeSpeed(0.1);
          break;
        case "[":
          A.changeSpeed(-0.1);
          break;
        case "r":
        case "R":
          A.toggleRuler();
          break;
        case "m":
        case "M":
          A.toggleMask();
          break;
        case "ArrowDown":
          handled = A.moveManualRuler(1);
          break;
        case "ArrowUp":
          handled = A.moveManualRuler(-1);
          break;
        case "+":
        case "=":
          A.zoomBy(1);
          break;
        case "-":
          A.zoomBy(-1);
          break;
        case "0":
          A.setZoomMode("fit-width");
          break;
        case "b":
        case "B":
          void A.bookmarkHere();
          break;
        case "h":
        case "H":
          void A.highlightSelection();
          break;
        case "d":
        case "D": {
          const s = useSettings.getState();
          s.set("ui", { debug: !s.ui.debug });
          break;
        }
        case ",":
          openSettings();
          break;
        case "?":
          useUi.setState({ helpOpen: true });
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
