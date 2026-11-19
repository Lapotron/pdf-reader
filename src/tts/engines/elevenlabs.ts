import { s16leBytesToFloat } from "../pcm";
import type { EngineStatus, SynthesisRequest, SynthesisResult, TtsEngine, VoiceInfo, WordTiming } from "../types";
import { readApiError } from "./openai";

export interface ElevenLabsConfig {
  apiKey?: string;
  model: string;
  stability: number;
  similarity: number;
}

const API = "https://api.elevenlabs.io";

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Groups character alignment into words of `text` (whitespace-delimited). */
export function elevenAlignmentToTimings(text: string, chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const out: WordTiming[] = [];
  // Alignment characters correspond 1:1 to the input text in practice; guard by length.
  const n = Math.min(text.length, chars.length);
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    const s = i;
    while (i < n && !/\s/.test(text[i])) i++;
    out.push({ start: starts[s], end: ends[i - 1], charStart: s, charEnd: i });
  }
  return out;
}

export class ElevenLabsEngine implements TtsEngine {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs (API key)";
  readonly caps = { wordTimings: true, speedRange: [0.7, 1.2] as [number, number], offline: false, maxChars: 2500, concurrency: 2, needsKey: true };
  private cfg: () => ElevenLabsConfig;
  private voicesCache: VoiceInfo[] | null = null;

  constructor(cfg: () => ElevenLabsConfig) {
    this.cfg = cfg;
  }

  modelTag(): string {
    const c = this.cfg();
    return `eleven-${c.model}-${c.stability}-${c.similarity}`;
  }

  async init(onStatus: (s: EngineStatus) => void): Promise<void> {
    if (!this.cfg().apiKey) {
      const msg = "ElevenLabs API key missing — add it in Settings › Voice & engine.";
      onStatus({ state: "error", error: msg });
      throw new Error(msg);
    }
    onStatus({ state: "ready", device: "cloud" });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.voicesCache) return this.voicesCache;
    const key = this.cfg().apiKey;
    if (!key) return [];
    const res = await fetch(`${API}/v1/voices`, { headers: { "xi-api-key": key } });
    if (!res.ok) throw new Error(`ElevenLabs voices failed — ${await readApiError(res)}`);
    const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    this.voicesCache = j.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      lang: v.labels?.accent ?? "multi",
      gender: v.labels?.gender === "female" ? "f" : v.labels?.gender === "male" ? "m" : undefined,
      description: v.labels?.description,
      engine: "elevenlabs" as const,
    }));
    return this.voicesCache;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const c = this.cfg();
    const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(req.voice)}/with-timestamps?output_format=pcm_24000`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": c.apiKey ?? "" },
      body: JSON.stringify({
        text: req.text,
        model_id: c.model,
        voice_settings: { stability: c.stability, similarity_boost: c.similarity, speed: req.speed },
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed — ${await readApiError(res)}`);
    const j = (await res.json()) as {
      audio_base64: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
    };
    const pcm = s16leBytesToFloat(base64ToBytes(j.audio_base64));
    const a = j.alignment;
    const timings = a ? elevenAlignmentToTimings(req.text, a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : undefined;
    return { pcm, sampleRate: 24000, timings, timingSource: timings ? "engine" : "estimated" };
  }

  dispose(): void {}
}
