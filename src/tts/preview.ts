import { create } from "zustand";
import { sha256Hex } from "../lib/hash";
import { MappedString } from "../text/mappedString";
import { chunkSentence, splitSentences } from "../text/segment";
import type { AudioCache } from "./audioCache";
import type { AudioSink, ScheduledSound } from "./audioSink";
import { timeStretch, trimSilence } from "./pcm";
import { isLive, type AnyEngine, type EngineId, type EngineStatus, type LiveTtsEngine, type TtsEngine } from "./types";

export interface PreviewState {
  /** "<engine>:<voice>" of the preview in progress. */
  target: string | null;
  phase: "preparing" | "playing" | null;
}

export const usePreview = create<PreviewState>()(() => ({ target: null, phase: null }));

export const previewKey = (engine: string, voice: string) => `${engine}:${voice}`;

export interface PreviewDeps {
  sink: AudioSink;
  cache: AudioCache | null;
  getEngine(id: EngineId): AnyEngine;
  settings(): { speed: number; pitch: number; volume: number; previewText: string };
  /** Called before a preview starts (e.g. to stop the reader). */
  onStart?(): void;
  onStatus?(s: EngineStatus): void;
  /** Called when a preview fails or times out (not for cancellations). */
  onError?(e: Error): void;
  watchdogMs?: number;
}

interface Run {
  ctrl: AbortController;
  sounds: ScheduledSound[];
  live: LiveTtsEngine | null;
  timer: ReturnType<typeof setTimeout>;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

/**
 * Voice previews: one at a time and cancellable (a new preview aborts the previous one, so the
 * serial Kokoro queue never piles up), played sentence by sentence as soon as each is ready,
 * cached, and guarded by a watchdog so the UI can never stay stuck in "preparing".
 */
export function createPreviewer(deps: PreviewDeps) {
  let current: Run | null = null;
  const watchdogMs = deps.watchdogMs ?? 90_000;

  function finish(run: Run): void {
    if (current !== run) return;
    clearTimeout(run.timer);
    current = null;
    usePreview.setState({ target: null, phase: null });
  }

  function stop(): void {
    const run = current;
    if (!run) return;
    current = null;
    clearTimeout(run.timer);
    run.ctrl.abort();
    run.sounds.forEach((s) => s.stop());
    run.live?.cancel();
    usePreview.setState({ target: null, phase: null });
  }

  async function piece(e: TtsEngine, text: string, voice: string, synthSpeed: number, signal: AbortSignal): Promise<{ pcm: Float32Array; sampleRate: number }> {
    const key = await sha256Hex(["preview", e.id, e.modelTag(), voice, synthSpeed.toFixed(2), text].join("␟"));
    const hit = deps.cache ? await deps.cache.get(key) : null;
    if (hit) return hit;
    if (signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    const r = await e.synthesize({ text, voice, speed: synthSpeed, signal, priority: -1 });
    const pcm = trimSilence(r.pcm, r.sampleRate).pcm;
    if (deps.cache && !signal.aborted) void deps.cache.put(key, { pcm, sampleRate: r.sampleRate, timingSource: "estimated" });
    return { pcm, sampleRate: r.sampleRate };
  }

  async function play(engineId: EngineId, voice: string, text = deps.settings().previewText): Promise<void> {
    stop();
    const ctrl = new AbortController();
    const run: Run = {
      ctrl,
      sounds: [],
      live: null,
      timer: setTimeout(() => {
        if (current !== run) return;
        stop();
        deps.onError?.(new Error("The voice preview took too long. The voice model may still be loading; try again in a moment."));
      }, watchdogMs),
    };
    current = run;
    usePreview.setState({ target: previewKey(engineId, voice), phase: "preparing" });
    deps.onStart?.();
    const running = deps.sink.ensureRunning().catch(() => {}); // inside the click gesture
    try {
      const e = deps.getEngine(engineId);
      await e.init(deps.onStatus ?? (() => {}));
      if (ctrl.signal.aborted) return;
      const t = deps.settings();
      if (isLive(e)) {
        run.live = e;
        usePreview.setState({ phase: "playing" });
        e.speak(text, { voice, rate: t.speed, pitch: t.pitch, volume: t.volume }, {
          onWord() {},
          onEnd: () => finish(run),
          onError: (err) => {
            if (current !== run) return;
            stop();
            deps.onError?.(err instanceof Error ? err : new Error(String(err)));
          },
        });
        return;
      }
      await running;
      await deps.sink.resume();
      // Same speed/pitch math as the reader, so the preview sounds like playback.
      const [lo, hi] = e.caps.speedRange;
      const pitch = clamp(t.pitch || 1, 0.85, 1.15);
      const synthSpeed = clamp(t.speed / pitch, lo, hi);
      const stretchRaw = t.speed / pitch / synthSpeed;
      const stretch = Math.abs(stretchRaw - 1) < 0.02 ? 1 : stretchRaw;
      const rate = t.speed / (synthSpeed * stretch);
      const sentences = splitSentences(MappedString.identity(text, 0)).map((s) => s.text);
      const pieces = (sentences.length ? sentences : [text]).flatMap((s) => chunkSentence(s, e.caps.maxChars).map((c) => c.text));
      deps.sink.setVolume(t.volume, 0.01);
      let prevEnd = 0;
      for (let i = 0; i < pieces.length; i++) {
        const a = await piece(e, pieces[i], voice, synthSpeed, ctrl.signal);
        if (ctrl.signal.aborted || current !== run) return;
        const pcm = stretch === 1 ? a.pcm : timeStretch(a.pcm, a.sampleRate, stretch);
        const when = Math.max(deps.sink.now + 0.05, prevEnd + (i ? 0.12 : 0));
        const snd = deps.sink.schedule(pcm, a.sampleRate, when, { rate });
        run.sounds.push(snd);
        prevEnd = when + pcm.length / a.sampleRate / rate;
        if (i === 0) usePreview.setState({ phase: "playing" });
        if (i === pieces.length - 1) void snd.ended.then(() => finish(run));
      }
    } catch (err) {
      if (ctrl.signal.aborted || isAbort(err) || current !== run) return;
      stop();
      throw err;
    }
  }

  /** Starts a preview, or stops it if the same voice is already previewing. */
  function toggle(engineId: EngineId, voice: string): Promise<void> {
    if (usePreview.getState().target === previewKey(engineId, voice)) {
      stop();
      return Promise.resolve();
    }
    return play(engineId, voice);
  }

  return { play, stop, toggle, get active() {
    return current !== null;
  } };
}
