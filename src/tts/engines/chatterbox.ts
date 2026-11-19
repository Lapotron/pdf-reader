import { db } from "../../db/schema";
import { int16ToFloat } from "../pcm";
import { AbortError, type EngineStatus, type SynthesisRequest, type SynthesisResult, type TtsEngine, type VoiceInfo } from "../types";
import type { CIn, COut } from "./chatterboxProtocol";

const NOOP = () => {};

export type ChatterboxWorkerLike = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((e: MessageEvent<COut>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

const defaultWorker = (): ChatterboxWorkerLike =>
  new Worker(new URL("./chatterbox.worker.ts", import.meta.url), { type: "module", name: "chatterbox" }) as ChatterboxWorkerLike;

/** Reference audio (24 kHz) for a saved cloned voice: the stored reference window. */
async function loadRefFromDb(id: string): Promise<Float32Array | null> {
  const row = await db.voices.get(id);
  if (!row) return null;
  const all = int16ToFloat(new Int16Array(row.pcm24k));
  return all.slice(row.refStart, row.refEnd || all.length);
}

interface Job {
  id: number;
  prio: number;
  text: string;
  voice: string;
  exaggeration: number;
  ref?: Float32Array;
  resolve(r: SynthesisResult): void;
  reject(e: Error): void;
  aborted?: boolean;
}

/**
 * Cloned voices on device: Chatterbox (zero-shot voice cloning) in a worker. Like the Kokoro
 * proxy, the queue lives here and the worker receives one job at a time. The reference audio is
 * sent with a voice's first request; the worker computes the speaker conditioning once.
 */
export class ChatterboxEngine implements TtsEngine {
  readonly id = "chatterbox" as const;
  readonly label = "My voices (cloned, on device)";
  /** No duration control: speed changes go through the player's time-stretch. */
  readonly caps = { wordTimings: false, speedRange: [1, 1] as [number, number], offline: true, maxChars: 120, concurrency: 1, needsKey: false };
  private worker: ChatterboxWorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private isReady = false;
  private queue: Job[] = [];
  private inflight: Job | null = null;
  private nextId = 1;
  private listeners = new Set<(s: EngineStatus) => void>();
  private files = new Map<string, { loaded: number; total: number }>();
  /** Voices whose reference the current worker already has. */
  private sent = new Set<string>();
  /** Unsaved voices (previewed in the voice creator). */
  private temp = new Map<string, Float32Array>();
  private cfg: () => { exaggeration: number };
  private createWorker: () => ChatterboxWorkerLike;
  private loadRef: (id: string) => Promise<Float32Array | null>;
  device: "webgpu" | "wasm" | null = null;
  rtf = 0;

  constructor(cfg: () => { exaggeration: number }, createWorker: () => ChatterboxWorkerLike = defaultWorker, loadRef = loadRefFromDb) {
    this.cfg = cfg;
    this.createWorker = createWorker;
    this.loadRef = loadRef;
  }

  modelTag(): string {
    return `chatterbox-${this.device ?? "x"}-${this.cfg().exaggeration.toFixed(2)}`;
  }

  /** Registers an unsaved voice for previews. */
  setTempVoice(id: string, ref: Float32Array): void {
    this.temp.set(id, ref);
  }

  clearTempVoice(id: string): void {
    this.temp.delete(id);
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
      const fail = (msg: string) => {
        this.emit({ state: "error", error: msg });
        this.ready = null;
        this.isReady = false;
        this.sent.clear();
        worker.terminate();
        this.worker = null;
        this.failAll(new Error(msg));
        reject(new Error(msg));
      };
      worker.onmessage = (e: MessageEvent<COut>) => {
        const m = e.data;
        switch (m.t) {
          case "progress":
            if (m.file && m.status === "progress" && m.total) {
              this.files.set(m.file, { loaded: m.loaded ?? 0, total: m.total });
              let loaded = 0;
              let total = 0;
              for (const f of this.files.values()) {
                loaded += f.loaded;
                total += f.total;
              }
              this.emit({ state: "downloading", progress: { loaded, total, file: m.file }, message: "Downloading the voice-cloning model…" });
              if (total > 0 && loaded >= total) this.emit({ state: "loading", message: "Preparing the model — this can take a minute the first time…" });
            }
            break;
          case "status":
            this.emit({ state: this.isReady ? "ready" : "loading", message: m.message, device: this.device ?? undefined });
            break;
          case "ready":
            this.device = m.device;
            this.isReady = true;
            this.emit({ state: "ready", device: m.device });
            resolve();
            this.dispatch();
            break;
          case "audio": {
            const job = this.settle(m.id);
            const dur = m.pcm.length / m.sr;
            if (dur > 0) this.rtf = this.rtf ? this.rtf * 0.7 + (m.ms / 1000 / dur) * 0.3 : m.ms / 1000 / dur;
            if (dur > 1) this.emit({ state: "ready", device: this.device ?? undefined, rtf: this.rtf });
            if (job && !job.aborted) job.resolve({ pcm: m.pcm, sampleRate: m.sr, timingSource: "estimated" });
            break;
          }
          case "error":
            if (m.id !== undefined) {
              const job = this.settle(m.id);
              if (job) {
                this.sent.delete(job.voice);
                if (!job.aborted) job.reject(new Error(m.msg));
              }
            } else if (m.fatal) fail(m.msg);
            break;
        }
      };
      worker.onerror = (e) => fail(e.message || "The voice-cloning worker failed to start");
      const base = new URL(`${import.meta.env.BASE_URL}vendor/ort4/`, location.href).href;
      this.emit({ state: "loading", message: "Starting the voice-cloning model…" });
      worker.postMessage({ t: "init", device: "auto", wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`, mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs` } satisfies CIn);
    });
    return this.ready;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const rows = await db.voices.where("engine").equals("chatterbox").sortBy("createdAt");
    return rows.map((r) => ({ id: r.id, name: r.name, lang: "en", engine: "chatterbox" as const, description: "Cloned voice" }));
  }

  private async resolveVoice(voice: string): Promise<string> {
    if (voice && (this.temp.has(voice) || (await db.voices.get(voice)))) return voice;
    const first = (await this.listVoices())[0];
    if (!first) throw new Error("No cloned voice yet. Create one in Settings › Voice › My voices.");
    return first.id;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    await this.init(NOOP);
    if (req.signal?.aborted) throw new AbortError();
    const voice = await this.resolveVoice(req.voice);
    const id = this.nextId++;
    return new Promise<SynthesisResult>((resolve, reject) => {
      const job: Job = { id, prio: req.priority ?? id, text: req.text, voice, exaggeration: this.cfg().exaggeration, resolve, reject };
      let i = this.queue.findIndex((q) => q.prio > job.prio || (q.prio === job.prio && q.id > job.id));
      if (i < 0) i = this.queue.length;
      this.queue.splice(i, 0, job);
      req.signal?.addEventListener(
        "abort",
        () => {
          const k = this.queue.indexOf(job);
          if (k >= 0) this.queue.splice(k, 1);
          else if (this.inflight === job) job.aborted = true;
          else return;
          reject(new AbortError());
        },
        { once: true },
      );
      this.dispatch();
    });
  }

  private dispatch(): void {
    if (this.inflight || !this.isReady || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight = job;
    const send = (ref?: Float32Array) => {
      if (this.inflight !== job || !this.worker) return;
      if (ref) this.sent.add(job.voice);
      const msg: CIn = { t: "gen", id: job.id, text: job.text, voice: job.voice, exaggeration: job.exaggeration, ref };
      this.worker.postMessage(msg);
    };
    if (this.sent.has(job.voice)) send();
    else {
      const temp = this.temp.get(job.voice);
      void (temp ? Promise.resolve(temp) : this.loadRef(job.voice)).then((ref) => {
        if (!ref) {
          this.settle(job.id);
          if (!job.aborted) job.reject(new Error("This cloned voice no longer exists."));
          return;
        }
        send(ref.slice());
      });
    }
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

  /** Forgets a deleted voice in the running worker session. */
  forgetVoice(id: string): void {
    this.sent.delete(id);
    this.temp.delete(id);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.isReady = false;
    this.sent.clear();
    this.failAll(new AbortError());
    this.files.clear();
    this.emit({ state: "idle" });
  }
}
