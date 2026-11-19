import { getSession, player, rememberDocPrefs } from "./session";
import { toast } from "./toast";
import { addBookmark, addHighlight, HIGHLIGHT_COLORS } from "../db/annotations";
import { PDF_TO_CSS } from "../pdf/pdfjs";
import { usePlayer } from "../state/player";
import { requestScroll, useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { resumeFollow, useUi } from "../state/ui";

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function togglePlay(): void {
  resumeFollow();
  if (player.state === "idle" || player.state === "error") {
    void player.play(undefined, useReader.getState().currentPage);
  } else player.toggle();
}

export function nextSentence(): void {
  resumeFollow();
  void player.next();
}

export function prevSentence(): void {
  resumeFollow();
  void player.prev();
}

/** Jumps to the next/previous paragraph start. */
export async function jumpParagraph(dir: 1 | -1): Promise<void> {
  resumeFollow();
  const model = getSession()?.model;
  const pos = player.position;
  if (!model || !pos) return;
  let s = pos.sentence;
  for (let k = 0; k < 200; k++) {
    if (dir === 1) {
      const wasEnd = s.pauseAfter === "paragraph";
      const n = await model.next(s);
      if (!n) return;
      s = n;
      if (wasEnd) break;
    } else {
      const p = await model.prev(s);
      if (!p) break;
      if (p.pauseAfter === "paragraph" && s.id !== pos.sentence.id) break;
      s = p;
    }
  }
  await player.jumpTo(s.srcStart);
}

export function gotoPage(page: number): void {
  const n = useReader.getState().numPages;
  requestScroll(Math.min(n, Math.max(1, page)));
}

export function zoomBy(dir: 1 | -1): void {
  const s = useSettings.getState();
  const cur = useReader.getState().scale / PDF_TO_CSS;
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1] : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? ZOOM_STEPS[0];
  s.set("ui", { zoomMode: "custom", zoom: next });
}

export const setZoomMode = (m: "fit-width" | "fit-page") => useSettings.getState().set("ui", { zoomMode: m });

export function changeSpeed(delta: number): void {
  const s = useSettings.getState();
  const v = Math.round(Math.min(3, Math.max(0.5, s.tts.speed + delta)) * 100) / 100;
  setSpeed(v);
}

let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** Applies voice/speed/pitch changes to ongoing playback (debounced). */
export function applyPlaybackChange(): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    rememberDocPrefs();
    void player.restartAtCurrentWord();
  }, 350);
}

export function setSpeed(v: number): void {
  useSettings.getState().set("tts", { speed: v });
  applyPlaybackChange();
}

export function setVoice(engine: string, voice: string): void {
  const s = useSettings.getState();
  s.set("tts", { voices: { ...s.tts.voices, [engine]: voice } });
  applyPlaybackChange();
}

export function setVolume(v: number): void {
  useSettings.getState().set("tts", { volume: v });
  player.setVolume(v);
}

export function toggleRuler(): void {
  const s = useSettings.getState();
  s.set("ruler", { enabled: !s.ruler.enabled });
}

export function toggleMask(): void {
  const s = useSettings.getState();
  s.set("ruler", { mask: !s.ruler.mask, enabled: true });
}

export function cycleTheme(): void {
  const s = useSettings.getState();
  const order = ["light", "sepia", "dark", "system"] as const;
  const i = order.indexOf(s.appearance.theme);
  s.set("appearance", { theme: order[(i + 1) % order.length] });
}

export async function bookmarkHere(): Promise<void> {
  const pos = usePlayer.getState().position;
  const page = pos?.page ?? useReader.getState().currentPage;
  const label = pos ? `p. ${page} — ${pos.text.slice(0, 60)}${pos.text.length > 60 ? "…" : ""}` : `Page ${page}`;
  const row = await addBookmark(page, pos?.srcStart, label);
  if (row) toast(`Bookmarked page ${page}.`, "success");
}

export async function highlightSelection(): Promise<void> {
  const sel = useReader.getState().selection;
  if (!sel) {
    toast("Select some text first.");
    return;
  }
  await addHighlight(sel.srcStart, sel.srcEnd, sel.text, HIGHLIGHT_COLORS[0]);
  useReader.setState({ selection: null });
  window.getSelection()?.removeAllRanges();
}

/** Moves the manual reading line by one line (when not playing). */
export function moveManualRuler(dir: 1 | -1): boolean {
  const s = getSession();
  if (!s) return false;
  const st = usePlayer.getState();
  if (st.position && st.state !== "idle" && st.state !== "error") return false;
  const cur = useUi.getState().manualRuler;
  let page = cur?.page ?? useReader.getState().currentPage;
  let idx = cur?.lineIndex ?? (dir === 1 ? -1 : Infinity);
  for (let guard = 0; guard < 5; guard++) {
    const pt = s.text.peekPageText(page);
    if (!pt) return false;
    const body = pt.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.role === "body" || l.role === "caption");
    const next = dir === 1 ? body.find(({ i }) => i > idx) : [...body].reverse().find(({ i }) => i < idx);
    if (next) {
      const ruler = useSettings.getState().ruler;
      const block = pt.blocks[next.l.block];
      const rect = ruler.span === "column" ? { ...next.l.rect, x: block.rect.x, w: block.rect.w } : ruler.span === "page" ? { ...next.l.rect, x: 0, w: pt.width } : next.l.rect;
      useUi.setState({ manualRuler: { page, rect, lineIndex: next.i } });
      if (!useSettings.getState().ruler.enabled) useSettings.getState().set("ruler", { enabled: true });
      requestScroll(page, next.l.rect.y, true);
      return true;
    }
    page += dir;
    if (page < 1 || page > s.pdf.numPages) return false;
    idx = dir === 1 ? -1 : Infinity;
    void s.text.getPageText(page);
  }
  return false;
}
