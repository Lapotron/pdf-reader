// Module worker running Kokoro-82M via kokoro-js (transformers.js + ONNX Runtime Web).
import { KokoroTTS, env } from "kokoro-js";
import { KOKORO_MODEL_ID, type KIn, type KOut, type KokoroDtype } from "./kokoroProtocol";
import type { VoiceInfo } from "../types";

const ctx = self as unknown as {
  postMessage(m: KOut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<KIn>) => void) | null;
  navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } };
};

type Gen = Extract<KIn, { t: "gen" }>;

let tts: KokoroTTS | null = null;
let initPromise: Promise<void> | null = null;
const queue: Gen[] = [];
let busy = false;

const post = (m: KOut, transfer?: Transferable[]) => ctx.postMessage(m, transfer);

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = ctx.navigator.gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

function validAudio(a: Float32Array): boolean {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!Number.isFinite(v)) return false;
    s += v * v;
  }
  return a.length > 0 && Math.sqrt(s / a.length) > 1e-4;
}

async function load(device: "webgpu" | "wasm", dtype: Exclude<KokoroDtype, "auto">): Promise<KokoroTTS> {
  post({ t: "status", message: `Loading Kokoro (${device}, ${dtype})…` });
  const model = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
    dtype,
    device,
    progress_callback: (p: unknown) => {
      const e = p as { status: string; file?: string; loaded?: number; total?: number; progress?: number };
      post({ t: "progress", status: e.status, file: e.file, loaded: e.loaded, total: e.total, progress: e.progress });
    },
  });
  post({ t: "status", message: "Warming up the voice model…" });
  const warm = await model.generate("Hello.", { voice: "af_heart" });
  if (!validAudio(warm.audio)) throw new Error(`Kokoro produced invalid audio on ${device}/${dtype}`);
  return model;
}

function voiceList(model: KokoroTTS): VoiceInfo[] {
  const voices = model.voices as Record<string, { name: string; language: string; gender: string; overallGrade: string; traits?: string }>;
  return Object.entries(voices).map(([id, v]) => ({
    id,
    name: v.name,
    lang: v.language,
    gender: v.gender?.toLowerCase().startsWith("f") ? "f" : "m",
    grade: v.overallGrade,
    description: v.traits,
    engine: "kokoro",
  }));
}

async function init(msg: Extract<KIn, { t: "init" }>): Promise<void> {
  env.wasmPaths = msg.wasmPaths;
  const gpu = msg.device !== "wasm" && (await hasWebGPU());
  let device: "webgpu" | "wasm" = msg.device === "webgpu" ? (gpu ? "webgpu" : "wasm") : gpu && msg.device === "auto" ? "webgpu" : "wasm";
  let dtype: Exclude<KokoroDtype, "auto"> = msg.dtype === "auto" ? (device === "webgpu" ? "fp32" : "q8") : msg.dtype;
  try {
    tts = await load(device, dtype);
  } catch (e) {
    if (device !== "webgpu") throw e;
    post({ t: "status", message: `WebGPU failed (${(e as Error).message}); falling back to WASM.` });
    device = "wasm";
    dtype = "q8";
    tts = await load(device, dtype);
  }
  post({ t: "ready", device, dtype, voices: voiceList(tts) });
}

async function pump(): Promise<void> {
  if (busy || !tts) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  const t0 = performance.now();
  try {
    const out = await tts.generate(job.text, { voice: job.voice as never, speed: job.speed });
    let pcm = out.audio as Float32Array;
    if (pcm.byteOffset !== 0 || pcm.byteLength !== pcm.buffer.byteLength) pcm = pcm.slice();
    post({ t: "audio", id: job.id, pcm, sr: out.sampling_rate, ms: performance.now() - t0 }, [pcm.buffer as ArrayBuffer]);
  } catch (e) {
    post({ t: "error", id: job.id, msg: (e as Error).message ?? String(e) });
  } finally {
    busy = false;
    void pump();
  }
}

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.t) {
    case "init":
      if (!initPromise) {
        initPromise = init(msg).catch((err) => {
          initPromise = null;
          post({ t: "error", msg: (err as Error).message ?? String(err), fatal: true });
        });
      }
      initPromise.then(() => pump());
      break;
    case "gen":
      queue.push(msg);
      queue.sort((a, b) => a.prio - b.prio || a.id - b.id);
      void pump();
      break;
    case "cancel": {
      const ids = new Set(msg.ids);
      for (let i = queue.length - 1; i >= 0; i--) {
        if (ids.has(queue[i].id)) {
          post({ t: "cancelled", id: queue[i].id });
          queue.splice(i, 1);
        }
      }
      break;
    }
  }
};
