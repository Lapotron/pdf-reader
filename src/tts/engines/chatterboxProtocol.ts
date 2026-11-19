export const CHATTERBOX_MODEL_ID = "onnx-community/chatterbox-ONNX";
/** Approximate one-time download (WebGPU set: fp32 parts + q4f16 language model). */
export const CHATTERBOX_SIZE_MB = 1500;

export type CIn =
  /** `wasm` may point to a gzip-compressed binary (detected by its magic bytes). */
  | { t: "init"; device: "auto" | "webgpu" | "wasm"; wasm: string; mjs: string }
  /** `ref` (24 kHz mono reference audio) is sent with the first request for a voice. */
  | { t: "gen"; id: number; text: string; voice: string; exaggeration: number; ref?: Float32Array };

export type COut =
  | { t: "progress"; status: string; file?: string; loaded?: number; total?: number }
  | { t: "status"; message: string }
  | { t: "ready"; device: "webgpu" | "wasm" }
  | { t: "audio"; id: number; pcm: Float32Array; sr: number; ms: number }
  | { t: "error"; id?: number; msg: string; fatal?: boolean };
