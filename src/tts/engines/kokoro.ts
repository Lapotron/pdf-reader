import { AbortError, type EngineStatus, type SynthesisRequest, type SynthesisResult, type TtsEngine, type VoiceInfo } from "../types";
import type { KIn, KOut, KokoroDevice, KokoroDtype } from "./kokoroProtocol";

const NOOP = () => {};

interface Job {
  id: number;
  prio: number;
  text: string;
  voice: string;
  speed: number;
  resolve(r: SynthesisResult): void;
  reject(e: Error): void;
  /** Aborted while generating: the caller was already rejected; drop the result. */
  aborted?: boolean;
}

export type WorkerLike = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((e: MessageEvent<KOut>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

const defaultWorker = (): WorkerLike => new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module", name: "kokoro" }) as WorkerLike;

/**
 * Main-thread proxy for the Kokoro worker. One worker per app (singleton).
 *
 * The request queue lives here and the worker gets one job at a time. Inference blocks the
 * worker thread, so a queue inside it could not see "cancel" messages until it was too late;
 * here, cancelling a queued job is instant and only the job being generated has to finish.
 */
export class KokoroEngine implements TtsEngine {
  readonly id = "kokoro" as const;
  readonly label = "Kokoro — natural local voices";
  readonly caps = { wordTimings: false, speedRange: [0.5, 2] as [number, number], offline: true, maxChars: 200, concurrency: 1, needsKey: false };
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private isReady = false;
  private queue: Job[] = [];
  private inflight: Job | null = null;
  private nextId = 1;
  private createWorker: () => WorkerLike;
  private listeners = new Set<(s: EngineStatus) => void>();
  private files = new Map<string, { loaded: number; total: number }>();
  private config: () => { device: KokoroDevice; dtype: KokoroDtype };
  voices: VoiceInfo[] = [];
  device: string | null = null;
  dtype: string | null = null;
  /** Rolling real-time factor (synthesis time / audio duration). */
  rtf = 0;

  constructor(config: () => { device: KokoroDevice; dtype: KokoroDtype }, createWorker: () => WorkerLike = defaultWorker) {
    this.config = config;
    this.createWorker = createWorker;
  }

  modelTag(): string {
    return `kokoro-v1.0-${this.dtype ?? "unknown"}`;
  }

  private emit(s: EngineStatus): void {
    for (const l of this.listeners) l(s);
  }

  init(onStatus: (s: EngineStatus) => void): Promise<void> {
    this.listeners.add(onStatus);
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const worker = this.createWorker();
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<KOut>) => {
        const m = e.data;
        switch (m.t) {
          case "progress": {
            if (m.file && m.status === "progress" && m.total) {
              this.files.set(m.file, { loaded: m.loaded ?? 0, total: m.total });
              let loaded = 0;
              let total = 0;
              for (const f of this.files.values()) {
                loaded += f.loaded;
                total += f.total;
              }
              this.emit({ state: "downloading", progress: { loaded, total, file: m.file }, message: "Downloading voice model…" });
            }
            break;
          }
          case "status":
            this.emit({ state: "loading", message: m.message });
            break;
          case "ready":
            this.voices = m.voices;
            this.device = m.device;
            this.dtype = m.dtype;
            this.isReady = true;
            this.emit({ state: "ready", device: m.device, dtype: m.dtype });
            resolve();
            this.dispatch();
            break;
          case "audio": {
            const job = this.settle(m.id);
            const dur = m.pcm.length / m.sr;
            if (dur > 0) this.rtf = this.rtf ? this.rtf * 0.7 + (m.ms / 1000 / dur) * 0.3 : m.ms / 1000 / dur;
            console.debug(`[kokoro] ${dur.toFixed(2)} s audio in ${(m.ms / 1000).toFixed(2)} s (RTF ${(m.ms / 1000 / Math.max(dur, 1e-3)).toFixed(2)})`);
            if (dur > 1) this.emit({ state: "ready", device: this.device ?? undefined, dtype: this.dtype ?? undefined, rtf: this.rtf });
            if (job && !job.aborted) job.resolve({ pcm: m.pcm, sampleRate: m.sr, timingSource: "estimated" });
            break;
          }
          case "cancelled":
            this.settle(m.id);
            break;
          case "error":
            if (m.id !== undefined) {
              const job = this.settle(m.id);
              if (job && !job.aborted) job.reject(new Error(m.msg));
            } else if (m.fatal) {
              this.emit({ state: "error", error: m.msg });
              this.ready = null;
              this.isReady = false;
              worker.terminate();
              this.worker = null;
              this.failAll(new Error(m.msg));
              reject(new Error(m.msg));
            }
            break;
        }
      };
      worker.onerror = (e) => {
        const msg = e.message || "Kokoro worker failed to start";
        this.emit({ state: "error", error: msg });
        this.ready = null;
        this.isReady = false;
        this.failAll(new Error(msg));
        reject(new Error(msg));
      };
      const { device, dtype } = this.config();
      const wasmPaths = new URL(`${import.meta.env.BASE_URL}vendor/ort/`, location.href).href;
      this.emit({ state: "loading", message: "Starting Kokoro…" });
      this.post({ t: "init", device, dtype, wasmPaths });
    });
    return this.ready;
  }

  private post(m: KIn): void {
    this.worker?.postMessage(m);
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return this.voices.length ? this.voices : KOKORO_VOICES;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    await this.init(NOOP); // shared no-op: the listener Set doesn't grow per call
    if (req.signal?.aborted) throw new AbortError();
    const id = this.nextId++;
    return new Promise<SynthesisResult>((resolve, reject) => {
      const job: Job = { id, prio: req.priority ?? id, text: req.text, voice: req.voice, speed: req.speed, resolve, reject };
      // Keep the queue ordered by priority, then arrival.
      let i = this.queue.findIndex((q) => q.prio > job.prio || (q.prio === job.prio && q.id > job.id));
      if (i < 0) i = this.queue.length;
      this.queue.splice(i, 0, job);
      req.signal?.addEventListener(
        "abort",
        () => {
          const k = this.queue.indexOf(job);
          if (k >= 0) this.queue.splice(k, 1); // never reaches the worker
          else if (this.inflight === job) job.aborted = true; // can't interrupt; drop the result
          else return;
          reject(new AbortError());
        },
        { once: true },
      );
      this.dispatch();
    });
  }

  /** Sends the next queued job when the worker is idle. */
  private dispatch(): void {
    if (this.inflight || !this.isReady || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight = job;
    this.post({ t: "gen", id: job.id, text: job.text, voice: job.voice, speed: job.speed, prio: job.prio });
  }

  private settle(id: number): Job | null {
    const job = this.inflight && this.inflight.id === id ? this.inflight : null;
    if (job) this.inflight = null;
    queueMicrotask(() => this.dispatch());
    return job;
  }

  private failAll(e: Error): void {
    const jobs = [...this.queue, ...(this.inflight ? [this.inflight] : [])];
    this.queue = [];
    this.inflight = null;
    for (const j of jobs) if (!j.aborted) j.reject(e);
  }

  /** Terminates the worker (e.g. to switch device/precision). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.isReady = false;
    this.failAll(new AbortError());
    this.files.clear();
    this.emit({ state: "idle" });
  }
}

/** Static voice catalog (shown before the model loads). Grades from the Kokoro model card. */
export const KOKORO_VOICES: VoiceInfo[] = (
  [
    ["af_heart", "Heart", "en-us", "f", "A"],
    ["af_bella", "Bella", "en-us", "f", "A-"],
    ["af_nicole", "Nicole", "en-us", "f", "B-"],
    ["af_aoede", "Aoede", "en-us", "f", "C+"],
    ["af_kore", "Kore", "en-us", "f", "C+"],
    ["af_sarah", "Sarah", "en-us", "f", "C+"],
    ["af_alloy", "Alloy", "en-us", "f", "C"],
    ["af_nova", "Nova", "en-us", "f", "C"],
    ["af_sky", "Sky", "en-us", "f", "C-"],
    ["af_jessica", "Jessica", "en-us", "f", "D"],
    ["af_river", "River", "en-us", "f", "D"],
    ["am_fenrir", "Fenrir", "en-us", "m", "C+"],
    ["am_michael", "Michael", "en-us", "m", "C+"],
    ["am_puck", "Puck", "en-us", "m", "C+"],
    ["am_echo", "Echo", "en-us", "m", "D"],
    ["am_eric", "Eric", "en-us", "m", "D"],
    ["am_liam", "Liam", "en-us", "m", "D"],
    ["am_onyx", "Onyx", "en-us", "m", "D"],
    ["am_santa", "Santa", "en-us", "m", "D-"],
    ["am_adam", "Adam", "en-us", "m", "F+"],
    ["bf_emma", "Emma", "en-gb", "f", "B-"],
    ["bf_isabella", "Isabella", "en-gb", "f", "C"],
    ["bf_alice", "Alice", "en-gb", "f", "D"],
    ["bf_lily", "Lily", "en-gb", "f", "D"],
    ["bm_fable", "Fable", "en-gb", "m", "C"],
    ["bm_george", "George", "en-gb", "m", "C"],
    ["bm_lewis", "Lewis", "en-gb", "m", "D+"],
    ["bm_daniel", "Daniel", "en-gb", "m", "D"],
  ] as const
).map(([id, name, lang, gender, grade]) => ({ id, name, lang, gender, grade, engine: "kokoro" as const }));
