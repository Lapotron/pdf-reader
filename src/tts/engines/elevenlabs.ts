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

  /**
   * Instant voice cloning: uploads the samples and returns the new voice id. Requires an
   * ElevenLabs plan with voice cloning and the speaker's consent.
   */
  async cloneVoice(name: string, samples: Blob[], description = "Cloned in Simple Reader"): Promise<string> {
    const key = this.cfg().apiKey;
    if (!key) throw new Error("ElevenLabs API key missing — add it in Settings › Voice & engine.");
    const form = new FormData();
    form.append("name", name);
    form.append("description", description);
    form.append("remove_background_noise", "false");
    samples.forEach((b, i) => form.append("files", b, `sample-${i + 1}.wav`));
    let res: Response;
    try {
      res = await fetch(`${API}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": key }, body: form });
    } catch (e) {
      throw new Error(`Could not reach ElevenLabs (${(e as Error).message}). If your browser blocks this request, create the clone at elevenlabs.io — it will then appear in the ElevenLabs voice list here.`);
    }
    if (!res.ok) throw new Error(`ElevenLabs voice cloning failed — ${await readApiError(res)}`);
    const j = (await res.json()) as { voice_id: string };
    this.voicesCache = null;
    return j.voice_id;
  }

  async deleteVoice(voiceId: string): Promise<void> {
    const key = this.cfg().apiKey;
    if (!key) throw new Error("ElevenLabs API key missing.");
    const res = await fetch(`${API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { "xi-api-key": key } });
    if (!res.ok && res.status !== 404) throw new Error(`ElevenLabs delete failed — ${await readApiError(res)}`);
    this.voicesCache = null;
  }

  /** Forces the next listVoices() to refetch. */
  invalidateVoices(): void {
    this.voicesCache = null;
  }

  /** Some plans refuse raw PCM; remember and use MP3 (decoded locally) instead. */
  private useMp3 = false;

  private request(req: SynthesisRequest, format: string): Promise<Response> {
    const c = this.cfg();
    return fetch(`${API}/v1/text-to-speech/${encodeURIComponent(req.voice)}/with-timestamps?output_format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": c.apiKey ?? "" },
      body: JSON.stringify({
        text: req.text,
        model_id: c.model,
        voice_settings: { stability: c.stability, similarity_boost: c.similarity, speed: req.speed },
      }),
      signal: req.signal,
    });
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    let res = this.useMp3 ? null : await this.request(req, "pcm_24000");
    if (res && !res.ok && [400, 403, 422].includes(res.status)) {
      const msg = await readApiError(res);
      if (!/format|pcm|tier|subscription|plan/i.test(msg)) throw new Error(`ElevenLabs TTS failed — ${msg}`);
      this.useMp3 = true;
      res = null;
    }
    if (!res) res = await this.request(req, "mp3_44100_128");
    if (!res.ok) throw new Error(`ElevenLabs TTS failed — ${await readApiError(res)}`);
    const j = (await res.json()) as {
      audio_base64: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
    };
    const bytes = base64ToBytes(j.audio_base64);
    let pcm: Float32Array;
    let sampleRate = 24000;
    if (this.useMp3) {
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
      pcm = buf.getChannelData(0).slice();
      sampleRate = buf.sampleRate;
    } else pcm = s16leBytesToFloat(bytes);
    const a = j.alignment;
    const timings = a ? elevenAlignmentToTimings(req.text, a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : undefined;
    return { pcm, sampleRate, timings, timingSource: timings ? "engine" : "estimated" };
  }

  dispose(): void {}
}
