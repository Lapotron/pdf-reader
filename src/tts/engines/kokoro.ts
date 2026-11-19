import { AbortError, type EngineStatus, type SynthesisRequest, type SynthesisResult, type TtsEngine, type VoiceInfo } from "../types";
import type { KIn, KOut, KokoroDevice, KokoroDtype } from "./kokoroProtocol";

interface Pending {
  resolve(r: SynthesisResult): void;
  reject(e: Error): void;
}

/** Main-thread proxy for the Kokoro worker. One worker per app (singleton). */
export class KokoroEngine implements TtsEngine {
  readonly id = "kokoro" as const;
  readonly label = "Kokoro — natural local voices";
  readonly caps = { wordTimings: false, speedRange: [0.5, 2] as [number, number], offline: true, maxChars: 350, concurrency: 1, needsKey: false };
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private listeners = new Set<(s: EngineStatus) => void>();
  private files = new Map<string, { loaded: number; total: number }>();
  private config: () => { device: KokoroDevice; dtype: KokoroDtype };
  voices: VoiceInfo[] = [];
  device: string | null = null;
  dtype: string | null = null;
  /** Rolling real-time factor (synthesis time / audio duration). */
  rtf = 0;

  constructor(config: () => { device: KokoroDevice; dtype: KokoroDtype }) {
    this.config = config;
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
      const worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module", name: "kokoro" });
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
            this.emit({ state: "ready", device: m.device, dtype: m.dtype });
            resolve();
            break;
          case "audio": {
            const p = this.pending.get(m.id);
            this.pending.delete(m.id);
            const dur = m.pcm.length / m.sr;
            if (dur > 0) this.rtf = this.rtf ? this.rtf * 0.7 + (m.ms / 1000 / dur) * 0.3 : m.ms / 1000 / dur;
            console.debug(`[kokoro] ${dur.toFixed(2)} s audio in ${(m.ms / 1000).toFixed(2)} s (RTF ${(m.ms / 1000 / Math.max(dur, 1e-3)).toFixed(2)})`);
            p?.resolve({ pcm: m.pcm, sampleRate: m.sr, timingSource: "estimated" });
            break;
          }
          case "cancelled": {
            const p = this.pending.get(m.id);
            this.pending.delete(m.id);
            p?.reject(new AbortError());
            break;
          }
          case "error":
            if (m.id !== undefined) {
              const p = this.pending.get(m.id);
              this.pending.delete(m.id);
              p?.reject(new Error(m.msg));
            } else if (m.fatal) {
              this.emit({ state: "error", error: m.msg });
              this.ready = null;
              worker.terminate();
              this.worker = null;
              reject(new Error(m.msg));
            }
            break;
        }
      };
      worker.onerror = (e) => {
        const msg = e.message || "Kokoro worker failed to start";
        this.emit({ state: "error", error: msg });
        this.ready = null;
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
    await this.init(() => {});
    if (req.signal?.aborted) throw new AbortError();
    const id = this.nextId++;
    return new Promise<SynthesisResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      req.signal?.addEventListener("abort", () => this.post({ t: "cancel", ids: [id] }), { once: true });
      this.post({ t: "gen", id, text: req.text, voice: req.voice, speed: req.speed, prio: req.priority ?? id });
    });
  }

  /** Terminates the worker (e.g. to switch device/precision). */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new AbortError());
    this.pending.clear();
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
