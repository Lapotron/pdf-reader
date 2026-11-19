import { Emitter } from "../lib/emitter";
import { sha256Hex } from "../lib/hash";
import type { SrcPos } from "../pdf/types";
import type { ReadingModel } from "../text/readingModel";
import { chunkSentence, type Chunk, type Sentence } from "../text/segment";
import type { AudioCache } from "./audioCache";
import type { AudioSink, ScheduledSound } from "./audioSink";
import { normalizeLoudness, timeStretch, trimSilence } from "./pcm";
import { estimateWordTimings, wordAtTime } from "./timing";
import { isLive, type AnyEngine, type LiveTtsEngine, type TtsEngine, type WordTiming } from "./types";

/** Bump when text normalization or post-processing changes cached audio. */
export const NORMALIZER_VERSION = 2;

export type PlayerState = "idle" | "loading" | "buffering" | "playing" | "paused" | "error";

export interface PlaybackPrefs {
  voice: string;
  speed: number;
  /** 0.85..1.15, applied via playback rate. */
  pitch: number;
  volume: number;
  pauseSentence: number;
  pauseParagraph: number;
  prefetchSeconds: number;
  prefetchChunks: number;
  trimSilence: boolean;
  normalize: boolean;
}

export interface PlayerPosition {
  sentence: Sentence;
  /** Index into sentence.words, or -1 when no word is active. */
  wordIdx: number;
}

type Events = {
  state: [PlayerState];
  position: [PlayerPosition | null];
  error: [Error];
  ended: [];
};

export interface PlayerDeps {
  sink: AudioSink;
  cache: AudioCache | null;
  getEngine(): Promise<AnyEngine>;
  prefs(): PlaybackPrefs;
  docId?(): string | undefined;
}

interface Prepared {
  pcm: Float32Array;
  sampleRate: number;
  /** Aligned 1:1 with the chunk's words; seconds at rate 1. */
  timings: WordTiming[];
  duration: number;
}

interface Item {
  idx: number;
  sentence: Sentence;
  chunk: Chunk;
  /** Index in sentence.words of the chunk's first word. */
  wordOffset: number;
  wordCount: number;
  pauseAfter: number;
  rate: number;
  abort: AbortController;
  ready: Promise<Prepared>;
  prepared?: Prepared;
  when?: number;
  sound?: ScheduledSound;
  ended: boolean;
}

/** Words of a sentence that fall inside a chunk, as spans relative to the chunk text. */
function chunkWords(s: Sentence, c: Chunk): { first: number; spans: { start: number; end: number }[] } {
  let first = -1;
  const spans: { start: number; end: number }[] = [];
  s.words.forEach((w, i) => {
    if (w.start >= c.start && w.end <= c.end) {
      if (first < 0) first = i;
      spans.push({ start: w.start - c.start, end: w.end - c.start });
    }
  });
  return { first: Math.max(0, first), spans };
}

/** Maps engine timings (by char overlap) onto our word list; fills gaps by interpolation. */
export function alignTimings(timings: WordTiming[], words: { start: number; end: number }[], duration: number): WordTiming[] {
  const out: WordTiming[] = words.map((w) => {
    const hit = timings.find((t) => t.charStart < w.end && t.charEnd > w.start);
    return hit ? { start: hit.start, end: hit.end, charStart: w.start, charEnd: w.end } : { start: NaN, end: NaN, charStart: w.start, charEnd: w.end };
  });
  for (let i = 0; i < out.length; i++) {
    if (!Number.isNaN(out[i].start)) continue;
    const prev = i > 0 ? out[i - 1].end : 0;
    let j = i;
    while (j < out.length && Number.isNaN(out[j].start)) j++;
    const next = j < out.length ? out[j].start : duration;
    const step = (next - prev) / (j - i);
    for (let k = i; k < j; k++) {
      out[k].start = prev + step * (k - i);
      out[k].end = out[k].start + step;
    }
  }
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const EMPTY_PCM = new Float32Array(0);

/**
 * Read-aloud player: plans chunks from the reading model, prefetches synthesis ahead,
 * schedules gapless Web Audio playback and reports the current sentence/word.
 */
export class Player {
  private emitter = new Emitter<Events>();
  private deps: PlayerDeps;
  private model: ReadingModel | null = null;
  private session: PcmSession | LiveSession | null = null;
  private clockHandle: number | null = null;
  private clockIsRaf = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  state: PlayerState = "idle";
  position: PlayerPosition | null = null;
  engine: AnyEngine | null = null;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
  }

  on<K extends keyof Events>(e: K, fn: (...a: Events[K]) => void): () => void {
    return this.emitter.on(e, fn);
  }

  get readingModel(): ReadingModel | null {
    return this.model;
  }

  setModel(model: ReadingModel | null): void {
    this.stop();
    this.model = model;
    this.setPosition(null);
  }

  /** Starts playback from src, the current position, or the first sentence on `page`. */
  async play(from?: SrcPos, page?: number): Promise<void> {
    const model = this.model;
    if (!model) return;
    const sink = this.deps.sink;
    this.cancelSession();
    this.setState("loading");
    const token = Symbol();
    this.playToken = token;
    try {
      // Start the audio context first, while still inside the user gesture (autoplay policies,
      // notably Safari); engine initialization can take seconds on first use.
      const running = sink.ensureRunning();
      const engine = await this.deps.getEngine();
      if (this.playToken !== token) return;
      this.engine = engine;
      if (!isLive(engine)) await running;
      else await running.catch(() => {});
      if (this.playToken !== token) return;
      sink.setVolume(this.deps.prefs().volume, 0.01);
      let start: { sentence: Sentence; wordIdx: number } | null = null;
      if (from !== undefined) start = await model.sentenceAt(from);
      else if (this.position) start = { sentence: this.position.sentence, wordIdx: Math.max(0, this.position.wordIdx) };
      else {
        const s = await model.firstSentenceFrom(page ?? 1);
        start = s ? { sentence: s, wordIdx: 0 } : null;
      }
      if (this.playToken !== token) return;
      if (!start) {
        this.fail(new Error("No readable text from here to the end. Scanned (image-only) PDFs need OCR before they can be read aloud."));
        return;
      }
      this.setPosition({ sentence: start.sentence, wordIdx: start.wordIdx });
      const session = isLive(engine)
        ? new LiveSession(this, engine, model, start)
        : new PcmSession(this, engine, model, start);
      this.session = session;
      this.startClock();
      session.run().catch((e) => this.fail(e));
    } catch (e) {
      if (this.playToken === token) this.fail(e);
    }
  }

  private playToken: symbol | null = null;

  pause(): void {
    if (this.state !== "playing" && this.state !== "buffering" && this.state !== "loading") return;
    if (!this.session) return;
    this.session.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused" || !this.session) return;
    this.session.resume();
    this.setState(this.session.isBuffering() ? "buffering" : "playing");
  }

  toggle(): void {
    if (this.state === "paused") this.resume();
    else if (this.state === "playing" || this.state === "buffering" || this.state === "loading") this.pause();
    else void this.play();
  }

  stop(): void {
    this.playToken = null;
    this.cancelSession();
    if (this.state !== "error") this.setState("idle");
  }

  get isActive(): boolean {
    return this.state === "playing" || this.state === "buffering" || this.state === "loading" || this.state === "paused";
  }

  async next(): Promise<void> {
    const model = this.model;
    const cur = this.position?.sentence;
    if (!model || !cur) return;
    const n = await model.next(cur);
    if (n) await this.jumpTo(n.srcStart);
  }

  async prev(): Promise<void> {
    const model = this.model;
    const pos = this.position;
    if (!model || !pos) return;
    const target = pos.wordIdx > 2 && this.isActive ? pos.sentence : await model.prev(pos.sentence);
    if (target) await this.jumpTo(target.srcStart);
  }

  /** Moves the cursor; keeps playing if active. */
  async jumpTo(src: SrcPos): Promise<void> {
    if (this.isActive && this.state !== "paused") return this.play(src);
    const hit = await this.model?.sentenceAt(src);
    if (!hit) return;
    this.cancelSession();
    this.setState("idle");
    this.setPosition({ sentence: hit.sentence, wordIdx: hit.wordIdx });
  }

  /** Re-applies voice/speed/pitch changes by restarting at the current word. */
  async restartAtCurrentWord(): Promise<void> {
    const pos = this.position;
    if (!pos || !this.isActive || this.state === "paused") return;
    const w = pos.sentence.words[Math.max(0, pos.wordIdx)];
    await this.play(w ? w.srcStart : pos.sentence.srcStart);
  }

  setVolume(v: number): void {
    this.deps.sink.setVolume(v);
  }

  /** Fades out over `seconds`, then pauses and restores the volume. */
  fadeOutAndPause(seconds = 8): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.deps.sink.setVolume(0, seconds);
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.pause();
      this.deps.sink.setVolume(this.deps.prefs().volume, 0.05);
    }, seconds * 1000);
  }

  // ---- internals used by sessions ----

  /** @internal */
  get sink(): AudioSink {
    return this.deps.sink;
  }

  /** @internal */
  get prefs(): PlaybackPrefs {
    return this.deps.prefs();
  }

  /** @internal */
  get cache(): AudioCache | null {
    return this.deps.cache;
  }

  /** @internal */
  get docId(): string | undefined {
    return this.deps.docId?.();
  }

  /** @internal */
  setState(s: PlayerState): void {
    if (this.state === s) return;
    this.state = s;
    this.emitter.emit("state", s);
    if (s === "idle" || s === "error") this.stopClock();
  }

  /** @internal */
  setPosition(p: PlayerPosition | null): void {
    const cur = this.position;
    if (cur && p && cur.sentence.id === p.sentence.id && cur.wordIdx === p.wordIdx) return;
    if (!cur && !p) return;
    this.position = p;
    this.emitter.emit("position", p);
  }

  /** @internal */
  sessionEnded(s: PcmSession | LiveSession): void {
    if (this.session !== s) return;
    this.session = null;
    this.setState("idle");
    this.emitter.emit("ended");
  }

  /** @internal */
  fail(e: unknown): void {
    if ((e as Error)?.name === "AbortError") return;
    console.error(e);
    this.cancelSession();
    this.setState("error");
    this.emitter.emit("error", e instanceof Error ? e : new Error(String(e)));
  }

  private cancelSession(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
      this.deps.sink.setVolume(this.deps.prefs().volume, 0.05);
    }
    const s = this.session;
    this.session = null;
    s?.cancel();
  }

  /** Advances the reported word/sentence from the audio clock. Public for tests. */
  tick(): void {
    this.session?.tick();
  }

  private startClock(): void {
    if (this.clockHandle !== null) return;
    const loop = () => {
      this.clockHandle = null;
      if (!this.session) return;
      this.tick();
      const visible = typeof document === "undefined" || !document.hidden;
      if (visible && typeof requestAnimationFrame === "function") {
        this.clockIsRaf = true;
        this.clockHandle = requestAnimationFrame(loop);
      } else {
        this.clockIsRaf = false;
        this.clockHandle = setTimeout(loop, 250) as unknown as number;
      }
    };
    loop();
  }

  private stopClock(): void {
    if (this.clockHandle === null) return;
    if (this.clockIsRaf) cancelAnimationFrame(this.clockHandle);
    else clearTimeout(this.clockHandle);
    this.clockHandle = null;
  }
}

/** PCM engines: prefetch + gapless Web Audio scheduling. */
class PcmSession {
  private items: Item[] = [];
  private cancelled = false;
  private planSentence: Sentence | null;
  private planChunks: Chunk[] = [];
  private planChunkIdx = 0;
  private planDone = false;
  private filling: Promise<void> | null = null;
  private prevEnd = 0;
  private firstWord: number;
  private player: Player;
  private engine: TtsEngine;
  private model: ReadingModel;
  private prefs: PlaybackPrefs;
  private synthSpeed: number;
  /** Playback rate (pitch factor only). */
  private rate: number;
  /** Pitch-preserving time-stretch for speeds outside the engine's native range. */
  private stretch: number;
  private waitingFor: Item | null = null;
  /** Index of the first item that has not finished playing (moves forward only). */
  private firstLive = 0;

  constructor(player: Player, engine: TtsEngine, model: ReadingModel, start: { sentence: Sentence; wordIdx: number }) {
    this.player = player;
    this.engine = engine;
    this.model = model;
    this.prefs = player.prefs;
    this.planSentence = start.sentence;
    this.firstWord = start.wordIdx;
    const [lo, hi] = engine.caps.speedRange;
    const pitch = clamp(this.prefs.pitch || 1, 0.85, 1.15);
    // speed = synthSpeed * stretch * pitch; pitch is applied by the playback rate.
    this.synthSpeed = clamp(this.prefs.speed / pitch, lo, hi);
    const stretch = this.prefs.speed / pitch / this.synthSpeed;
    this.stretch = Math.abs(stretch - 1) < 0.02 ? 1 : stretch;
    this.rate = this.prefs.speed / (this.synthSpeed * this.stretch);
  }

  isBuffering(): boolean {
    return this.waitingFor !== null && !this.waitingFor.prepared;
  }

  pause(): void {
    void this.player.sink.suspend();
  }

  resume(): void {
    void this.player.sink.resume();
  }

  cancel(): void {
    this.cancelled = true;
    for (const it of this.items) {
      it.abort.abort();
      it.sound?.stop();
    }
    this.items = [];
  }

  async run(): Promise<void> {
    const sink = this.player.sink;
    // Ensure the audio clock runs (it may have been suspended by a previous pause).
    await sink.resume();
    this.prevEnd = sink.now;
    void this.fill();
    let i = 0;
    while (!this.cancelled) {
      while (i >= this.items.length) {
        if (this.planDone) {
          const last = this.items[this.items.length - 1];
          if (last?.sound) await last.sound.ended;
          if (!this.cancelled) this.player.sessionEnded(this);
          return;
        }
        await this.fill();
        if (this.cancelled) return;
      }
      const item = this.items[i];
      if (!item.prepared) {
        this.waitingFor = item;
        if (this.prevEnd <= sink.now + 0.05 && this.player.state === "playing") this.player.setState("buffering");
      }
      let prep: Prepared;
      try {
        prep = await item.ready;
      } catch (e) {
        if (this.cancelled) return;
        throw e;
      }
      this.waitingFor = null;
      if (this.cancelled) return;
      // At most two scheduled-but-unfinished items: wait for item i-2 to end.
      if (i >= 2) {
        const older = this.items[i - 2];
        if (older?.sound && !older.ended) await older.sound.ended;
        if (this.cancelled) return;
      }
      const pause = i > 0 ? this.items[i - 1].pauseAfter : 0;
      const when = Math.max(sink.now + 0.04, this.prevEnd + pause);
      item.when = when;
      item.sound = sink.schedule(prep.pcm, prep.sampleRate, when, { rate: item.rate });
      this.prevEnd = when + prep.duration / item.rate;
      // The audio buffer now owns a copy of the samples; free ours (long sessions would leak).
      prep.pcm = EMPTY_PCM;
      item.sound.ended.then(() => {
        item.ended = true;
        while (this.firstLive < this.items.length && this.items[this.firstLive].ended) this.firstLive++;
        if (!this.cancelled) void this.fill();
      });
      if (this.player.state === "loading" || this.player.state === "buffering") this.player.setState("playing");
      i++;
      void this.fill();
    }
  }

  tick(): void {
    const sink = this.player.sink;
    const t = sink.now - sink.latency;
    let cur: Item | null = null;
    for (let k = Math.max(0, this.firstLive - 1); k < this.items.length; k++) {
      const it = this.items[k];
      if (it.when === undefined) break;
      if (it.when <= t) cur = it;
      else break;
    }
    if (!cur || !cur.prepared) return;
    const local = (t - (cur.when ?? 0)) * cur.rate;
    const w = wordAtTime(cur.prepared.timings, local);
    const wordIdx = cur.wordCount === 0 ? -1 : cur.wordOffset + Math.max(0, w);
    this.player.setPosition({ sentence: cur.sentence, wordIdx });
  }

  private activeIndex(): number {
    return this.firstLive;
  }

  private needMore(): boolean {
    const ahead = this.items.slice(this.activeIndex());
    const count = ahead.length;
    if (count < this.prefs.prefetchChunks) return true;
    if (count >= Math.max(this.prefs.prefetchChunks * 3, 8)) return false;
    let secs = 0;
    for (const it of ahead) secs += it.prepared ? it.prepared.duration / it.rate : (it.chunk.text.length * 0.065) / this.prefs.speed;
    return secs < this.prefs.prefetchSeconds;
  }

  fill(): Promise<void> {
    if (!this.filling) {
      this.filling = this.doFill().finally(() => {
        this.filling = null;
      });
    }
    return this.filling;
  }

  private async doFill(): Promise<void> {
    while (!this.cancelled && !this.planDone && this.needMore()) {
      const item = await this.planNext();
      if (this.cancelled) return;
      if (!item) {
        this.planDone = true;
        return;
      }
      this.items.push(item);
    }
  }

  private async planNext(): Promise<Item | null> {
    while (this.planSentence && this.planChunkIdx >= this.planChunks.length) {
      if (this.planChunks.length > 0) {
        // Finished the current sentence: move on.
        this.planSentence = await this.model.next(this.planSentence);
        this.planChunks = [];
        this.planChunkIdx = 0;
        if (!this.planSentence) return null;
      }
      const s = this.planSentence;
      const startOffset = this.firstWord > 0 && s.words[this.firstWord] ? s.words[this.firstWord].start : 0;
      this.firstWord = 0;
      const chunks = chunkSentence(s.text, this.engine.caps.maxChars, startOffset);
      if (chunks.length === 0) {
        this.planSentence = await this.model.next(s);
        if (!this.planSentence) return null;
        continue;
      }
      this.planChunks = chunks;
    }
    const s = this.planSentence;
    if (!s) return null;
    const chunk = this.planChunks[this.planChunkIdx++];
    const lastOfSentence = this.planChunkIdx >= this.planChunks.length;
    const { first, spans } = chunkWords(s, chunk);
    const p = this.prefs;
    const speedScale = Math.sqrt(Math.max(0.5, p.speed));
    const pauseAfter = lastOfSentence ? (s.pauseAfter === "paragraph" ? p.pauseParagraph : p.pauseSentence) / speedScale : 0.04;
    const abort = new AbortController();
    const idx = this.items.length;
    const item: Item = {
      idx,
      sentence: s,
      chunk,
      wordOffset: first,
      wordCount: spans.length,
      pauseAfter,
      rate: this.rate,
      abort,
      ended: false,
      ready: null as unknown as Promise<Prepared>,
    };
    item.ready = this.prepare(chunk.text, spans, abort.signal, idx).then((prep) => {
      item.prepared = prep;
      return prep;
    });
    item.ready.catch(() => {});
    return item;
  }

  private async prepare(text: string, spans: { start: number; end: number }[], signal: AbortSignal, priority: number): Promise<Prepared> {
    const engine = this.engine;
    const p = this.prefs;
    const cache = this.player.cache;
    const key = await sha256Hex([engine.id, engine.modelTag(), p.voice, this.synthSpeed.toFixed(2), NORMALIZER_VERSION, p.trimSilence ? 1 : 0, p.normalize ? 1 : 0, text].join("␟"));
    const hit = cache ? await cache.get(key) : null;
    if (hit && hit.timings && hit.timings.length === spans.length) {
      return this.applyStretch({ pcm: hit.pcm, sampleRate: hit.sampleRate, timings: hit.timings, duration: hit.pcm.length / hit.sampleRate });
    }
    if (signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    const res = await engine.synthesize({ text, voice: p.voice, speed: this.synthSpeed, signal, priority });
    let pcm = res.pcm;
    let timings = res.timings;
    if (p.trimSilence) {
      const tr = trimSilence(pcm, res.sampleRate);
      if (tr.offset && timings) {
        const d = tr.offset / res.sampleRate;
        timings = timings.map((t) => ({ ...t, start: Math.max(0, t.start - d), end: Math.max(0, t.end - d) }));
      }
      pcm = tr.pcm;
    }
    const duration = pcm.length / res.sampleRate;
    const aligned = timings && timings.length ? alignTimings(timings, spans, duration) : estimateWordTimings(pcm, res.sampleRate, text, spans);
    if (p.normalize) pcm = normalizeLoudness(pcm);
    if (cache) void cache.put(key, { pcm, sampleRate: res.sampleRate, timings: aligned, timingSource: timings?.length ? "engine" : "estimated" }, this.player.docId);
    return this.applyStretch({ pcm, sampleRate: res.sampleRate, timings: aligned, duration });
  }

  private applyStretch(p: Prepared): Prepared {
    const s = this.stretch;
    if (s === 1) return p;
    const pcm = timeStretch(p.pcm, p.sampleRate, s);
    return { pcm, sampleRate: p.sampleRate, duration: pcm.length / p.sampleRate, timings: p.timings.map((t) => ({ ...t, start: t.start / s, end: t.end / s })) };
  }
}

/** Live engines (Web Speech): one utterance per sentence, word events from boundaries. */
class LiveSession {
  private cancelled = false;
  private player: Player;
  private engine: LiveTtsEngine;
  private model: ReadingModel;
  private sentence: Sentence;
  private firstWord: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(player: Player, engine: LiveTtsEngine, model: ReadingModel, start: { sentence: Sentence; wordIdx: number }) {
    this.player = player;
    this.engine = engine;
    this.model = model;
    this.sentence = start.sentence;
    this.firstWord = start.wordIdx;
  }

  isBuffering(): boolean {
    return false;
  }

  async run(): Promise<void> {
    this.speakCurrent();
  }

  private speakCurrent(): void {
    if (this.cancelled) return;
    const s = this.sentence;
    const offset = this.firstWord > 0 && s.words[this.firstWord] ? s.words[this.firstWord].start : 0;
    this.firstWord = 0;
    const text = s.text.slice(offset);
    const p = this.player.prefs;
    this.player.setState("playing");
    this.player.setPosition({ sentence: s, wordIdx: s.words.findIndex((w) => w.start >= offset) });
    this.engine.speak(
      text,
      { voice: p.voice, rate: p.speed, pitch: p.pitch, volume: p.volume },
      {
        onWord: (ci) => {
          if (this.cancelled) return;
          const abs = offset + ci;
          let idx = s.words.findIndex((w) => w.end > abs);
          if (idx < 0) idx = s.words.length - 1;
          this.player.setPosition({ sentence: s, wordIdx: idx });
        },
        onEnd: () => {
          if (this.cancelled) return;
          const pause = s.pauseAfter === "paragraph" ? p.pauseParagraph : p.pauseSentence;
          void this.model.next(s).then((n) => {
            if (this.cancelled) return;
            if (!n) {
              this.player.sessionEnded(this);
              return;
            }
            this.sentence = n;
            this.timer = setTimeout(() => this.speakCurrent(), pause * 1000);
          });
        },
        onError: (e) => {
          if (!this.cancelled) this.player.fail(e);
        },
      },
    );
  }

  tick(): void {}

  pause(): void {
    this.engine.pause();
  }

  resume(): void {
    this.engine.resume();
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
    this.engine.cancel();
  }
}
