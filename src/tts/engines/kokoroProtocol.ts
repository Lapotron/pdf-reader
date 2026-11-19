import type { VoiceInfo } from "../types";

export type KokoroDevice = "auto" | "webgpu" | "wasm";
export type KokoroDtype = "auto" | "fp32" | "fp16" | "q8" | "q4f16";

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Approximate model download sizes (MB) per precision. */
export const KOKORO_SIZES_MB: Record<Exclude<KokoroDtype, "auto">, number> = { fp32: 326, fp16: 163, q8: 92, q4f16: 155 };

export type KIn =
  | { t: "init"; device: KokoroDevice; dtype: KokoroDtype; wasmPaths: string }
  | { t: "gen"; id: number; text: string; voice: string; speed: number; prio: number }
  | { t: "cancel"; ids: number[] };

export type KOut =
  | { t: "progress"; status: string; file?: string; loaded?: number; total?: number; progress?: number }
  | { t: "status"; message: string }
  | { t: "ready"; device: "webgpu" | "wasm"; dtype: string; voices: VoiceInfo[] }
  | { t: "audio"; id: number; pcm: Float32Array; sr: number; ms: number }
  | { t: "cancelled"; id: number }
  | { t: "error"; id?: number; msg: string; fatal?: boolean };
