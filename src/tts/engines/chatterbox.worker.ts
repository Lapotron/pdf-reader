// Module worker running Chatterbox (zero-shot voice cloning) via transformers.js v4.
import { AutoProcessor, ChatterboxModel, Tensor, env } from "@huggingface/transformers";
import { CHATTERBOX_MODEL_ID, type CIn, type COut } from "./chatterboxProtocol";

const ctx = self as unknown as {
  postMessage(m: COut, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<CIn>) => void) | null;
  navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } };
};
const post = (m: COut, transfer?: Transferable[]) => ctx.postMessage(m, transfer);

type Processor = (text: string) => Promise<Record<string, unknown>>;
let processor: Processor | null = null;
let model: ChatterboxModel | null = null;
let initPromise: Promise<void> | null = null;
/** Speaker conditioning per voice (computed once from the reference audio). */
const speakers = new Map<string, Record<string, unknown>>();

async function hasWebGPU(): Promise<boolean> {
  try {
    return !!(await ctx.navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

const DTYPES = {
  webgpu: { embed_tokens: "fp32", speech_encoder: "fp32", language_model: "q4f16", conditional_decoder: "fp32" },
  wasm: { embed_tokens: "fp32", speech_encoder: "fp32", language_model: "q4", conditional_decoder: "fp32" },
} as const;

async function load(device: "webgpu" | "wasm"): Promise<void> {
  post({ t: "status", message: `Loading the voice-cloning model (${device === "webgpu" ? "WebGPU" : "CPU"})…` });
  const progress_callback = (p: unknown) => {
    const e = p as { status: string; file?: string; loaded?: number; total?: number };
    post({ t: "progress", status: e.status, file: e.file, loaded: e.loaded, total: e.total });
  };
  const proc = await AutoProcessor.from_pretrained(CHATTERBOX_MODEL_ID, { progress_callback });
  processor = (text) => (proc as unknown as Processor)(text);
  model = (await ChatterboxModel.from_pretrained(CHATTERBOX_MODEL_ID, { device, dtype: DTYPES[device] as never, progress_callback })) as ChatterboxModel;
}

async function init(msg: Extract<CIn, { t: "init" }>): Promise<void> {
  env.backends.onnx.wasm!.wasmPaths = { wasm: msg.wasm, mjs: msg.mjs };
  const gpu = msg.device !== "wasm" && (await hasWebGPU());
  let device: "webgpu" | "wasm" = gpu ? "webgpu" : "wasm";
  try {
    await load(device);
  } catch (e) {
    if (device !== "webgpu") throw e;
    post({ t: "status", message: `WebGPU failed (${(e as Error).message}); using the CPU instead.` });
    device = "wasm";
    await load(device);
  }
  post({ t: "ready", device });
}

async function generate(job: Extract<CIn, { t: "gen" }>): Promise<void> {
  if (!model || !processor) throw new Error("Model not loaded");
  let cond = speakers.get(job.voice);
  if (!cond) {
    if (!job.ref) throw new Error("Voice reference missing");
    post({ t: "status", message: "Learning the voice from your recording…" });
    cond = (await model.encode_speech(new Tensor("float32", job.ref, [1, job.ref.length]))) as unknown as Record<string, unknown>;
    speakers.set(job.voice, cond);
  }
  const t0 = performance.now();
  const inputs = await processor(job.text);
  // ~2.4 speech tokens per character; leave headroom but stop runaways.
  const max_new_tokens = Math.min(800, Math.max(128, Math.round(job.text.length * 4 + 60)));
  const out = (await model.generate({ ...inputs, ...cond, exaggeration: job.exaggeration, max_new_tokens } as never)) as unknown as { data: Float32Array };
  let pcm = out.data;
  if (pcm.byteOffset !== 0 || pcm.byteLength !== pcm.buffer.byteLength) pcm = pcm.slice();
  post({ t: "audio", id: job.id, pcm, sr: 24000, ms: performance.now() - t0 }, [pcm.buffer as ArrayBuffer]);
}

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.t === "init") {
    if (!initPromise) {
      initPromise = init(msg).catch((err) => {
        initPromise = null;
        post({ t: "error", msg: (err as Error).message ?? String(err), fatal: true });
      });
    }
    return;
  }
  // The main thread sends one job at a time (it owns the queue).
  void (initPromise ?? Promise.reject(new Error("Not initialized")))
    .then(() => generate(msg))
    .catch((err) => post({ t: "error", id: msg.id, msg: (err as Error).message ?? String(err) }));
};
