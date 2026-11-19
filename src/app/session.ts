import { db } from "../db/schema";
import { saveReadingState } from "../db/library";
import { PdfDocText } from "../pdf/document";
import { loadOutline } from "../pdf/outline";
import { destroyPdf, openPdf, type PDFDocumentProxy } from "../pdf/pdfjs";
import { pageOf } from "../pdf/types";
import { usePlayer, type PositionView } from "../state/player";
import { useReader, requestScroll } from "../state/reader";
import { DEFAULT_VOICES, getSettings, useSettings } from "../state/settings";
import type { CleanupOptions } from "../text/cleanup";
import { compileRules } from "../text/pronunciation";
import { ReadingModel } from "../text/readingModel";
import { audioCache } from "../tts/audioCache";
import { WebAudioSink } from "../tts/audioSink";
import { Player, type PlaybackPrefs, type PlayerPosition } from "../tts/player";
import { activeEngine, selectedEngineId } from "../tts/registry";
import type { EngineId } from "../tts/types";

export interface DocSession {
  docId: string;
  title: string;
  pdf: PDFDocumentProxy;
  text: PdfDocText;
  model: ReadingModel;
}

export const sink = new WebAudioSink();

export function playbackPrefs(engineId: EngineId): PlaybackPrefs {
  const s = getSettings();
  return {
    voice: s.tts.voices[engineId] ?? DEFAULT_VOICES[engineId],
    speed: s.tts.speed,
    pitch: s.tts.pitch,
    volume: s.tts.volume,
    pauseSentence: s.reading.pauseSentence,
    pauseParagraph: s.reading.pauseParagraph,
    prefetchSeconds: s.reading.prefetchSeconds,
    prefetchChunks: 3,
    trimSilence: s.reading.trimSilence,
    normalize: s.reading.normalize,
  };
}

let session: DocSession | null = null;

export const player: Player = new Player({
  sink,
  cache: audioCache,
  getEngine: activeEngine,
  prefs: () => playbackPrefs((player.engine?.id as EngineId | undefined) ?? selectedEngineId()),
  docId: () => session?.docId,
});

export function getSession(): DocSession | null {
  return session;
}

function toView(p: PlayerPosition): PositionView {
  const w = p.wordIdx >= 0 ? p.sentence.words[p.wordIdx] : undefined;
  return {
    sentenceId: p.sentence.id,
    srcStart: p.sentence.srcStart,
    srcEnd: p.sentence.srcEnd,
    text: p.sentence.text,
    wordIdx: p.wordIdx,
    wordStart: w?.srcStart ?? null,
    wordEnd: w?.srcEnd ?? null,
    page: pageOf(w?.srcStart ?? p.sentence.srcStart),
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = session;
    const pos = usePlayer.getState().position;
    if (!s || !pos) return;
    void saveReadingState(s.docId, pos.page, pos.sentenceId, s.pdf.numPages).catch(() => {});
  }, 1500);
}

player.on("state", (state) => usePlayer.setState({ state, ...(state === "playing" ? { error: null } : {}) }));
player.on("position", (p) => {
  const prev = usePlayer.getState().position;
  usePlayer.setState({ position: p ? toView(p) : null });
  if (p && (!prev || prev.sentenceId !== p.sentence.id)) scheduleSave();
});
player.on("error", (e) => usePlayer.setState({ error: e.message }));

// Release the Kokoro/engine status when tab closes is automatic; persist position on hide.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const s = session;
      const pos = usePlayer.getState().position;
      if (s && pos) void saveReadingState(s.docId, pos.page, pos.sentenceId, s.pdf.numPages).catch(() => {});
    }
  });
}

export async function effectiveCleanup(docId: string): Promise<CleanupOptions> {
  const prefs = await db.docPrefs.get(docId).catch(() => undefined);
  return { ...getSettings().cleanup, ...((prefs?.cleanupOverrides as Partial<CleanupOptions>) ?? {}) };
}

let openSeq = 0;

export async function openDocument(docId: string): Promise<DocSession | null> {
  const seq = ++openSeq;
  closeDocument();
  useReader.setState({ docId, loading: true, loadError: null, title: "", numPages: 0, sizes: [], outline: [], currentPage: 1, searchHits: [], activeHit: -1, selection: null });
  try {
    const row = await db.documents.get(docId);
    const file = await db.files.get(docId);
    if (!row || !file) throw new Error("This document is not in your library anymore.");
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const pdf = await openPdf(bytes);
    if (seq !== openSeq) {
      destroyPdf(pdf);
      return null;
    }
    const cleanup = await effectiveCleanup(docId);
    const text = new PdfDocText(pdf, docId, { columnDetection: cleanup.columnDetection });
    const rules = compileRules(await db.pronunciations.toArray(), docId);
    const model = new ReadingModel(text, cleanup, rules);
    session = { docId, title: row.title, pdf, text, model };
    player.setModel(model);

    const p1 = await pdf.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    const sizes = Array.from({ length: pdf.numPages }, () => ({ w: vp.width, h: vp.height }));
    useReader.setState({ title: row.title, numPages: pdf.numPages, sizes, loading: false });
    void db.documents.update(docId, { lastOpenedAt: Date.now() });
    void loadOutline(pdf).then((outline) => seq === openSeq && useReader.setState({ outline })).catch(() => {});
    void refineSizes(pdf, seq);

    // Per-document voice/speed memory.
    const prefs = await db.docPrefs.get(docId).catch(() => undefined);
    const st = getSettings();
    if (st.reading.rememberPerDoc && prefs && (prefs.voice || prefs.speed)) {
      const engine = (prefs.engine as EngineId) ?? st.tts.engine;
      useSettings.getState().set("tts", {
        engine,
        speed: prefs.speed ?? st.tts.speed,
        voices: prefs.voice ? { ...st.tts.voices, [engine]: prefs.voice } : st.tts.voices,
      });
    }

    // Resume position.
    const rs = await db.readingState.get(docId).catch(() => undefined);
    if (rs?.sentenceId !== undefined) {
      requestScroll(rs.page);
      void player.jumpTo(rs.sentenceId);
    } else if (rs?.page) requestScroll(rs.page);
    return session;
  } catch (e) {
    if (seq === openSeq) useReader.setState({ loading: false, loadError: (e as Error).message });
    return null;
  }
}

/** Loads real page sizes in the background (documents can mix page sizes). */
async function refineSizes(pdf: PDFDocumentProxy, seq: number): Promise<void> {
  const n = pdf.numPages;
  const sizes = [...useReader.getState().sizes];
  let changed = false;
  for (let p = 1; p <= n; p++) {
    if (seq !== openSeq) return;
    try {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const cur = sizes[p - 1];
      if (!cur || Math.abs(cur.w - vp.width) > 0.5 || Math.abs(cur.h - vp.height) > 0.5) {
        sizes[p - 1] = { w: vp.width, h: vp.height };
        changed = true;
      }
    } catch {
      /* ignore */
    }
    if (changed && (p % 50 === 0 || p === n)) {
      useReader.setState({ sizes: [...sizes] });
      changed = false;
    }
    if (p % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

export function closeDocument(): void {
  player.setModel(null);
  usePlayer.setState({ position: null });
  const s = session;
  session = null;
  if (s) destroyPdf(s.pdf);
}

/** Re-applies cleanup options / pronunciation rules to the open document. */
export async function refreshTextOptions(): Promise<void> {
  const s = session;
  if (!s) return;
  const cleanup = await effectiveCleanup(s.docId);
  const rules = compileRules(await db.pronunciations.toArray(), s.docId);
  s.text.setLayout({ columnDetection: cleanup.columnDetection });
  s.model.setOptions(cleanup, rules);
  const pos = usePlayer.getState().position;
  if (player.isActive && player.state !== "paused" && pos) {
    await player.play(pos.wordStart ?? pos.srcStart);
  } else if (pos) {
    await player.jumpTo(pos.wordStart ?? pos.srcStart);
  }
}

/** Saves the current voice/speed for this document (when enabled). */
export function rememberDocPrefs(): void {
  const s = session;
  const st = getSettings();
  if (!s || !st.reading.rememberPerDoc) return;
  const engine = st.tts.engine;
  void db.docPrefs
    .get(s.docId)
    .then((prev) => db.docPrefs.put({ ...(prev ?? { docId: s.docId }), docId: s.docId, engine, voice: st.tts.voices[engine], speed: st.tts.speed }))
    .catch(() => {});
}
