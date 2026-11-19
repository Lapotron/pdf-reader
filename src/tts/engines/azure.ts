import type { EngineStatus, SynthesisRequest, SynthesisResult, TtsEngine, VoiceInfo, WordTiming } from "../types";
import { s16leBytesToFloat } from "../pcm";

export interface AzureConfig {
  apiKey?: string;
  region: string;
}

const FALLBACK_VOICES = [
  "en-US-AvaMultilingualNeural",
  "en-US-AndrewMultilingualNeural",
  "en-US-EmmaMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
];

/** XML-escapes text and returns, for each escaped char, the index of its source char. */
export function escapeWithMap(text: string): { escaped: string; srcIndex: number[] } {
  let escaped = "";
  const srcIndex: number[] = [];
  const ent: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  for (let i = 0; i < text.length; i++) {
    const e = ent[text[i]] ?? text[i];
    escaped += e;
    for (let k = 0; k < e.length; k++) srcIndex.push(i);
  }
  return { escaped, srcIndex };
}

export function buildSsml(text: string, voice: string, speed: number): { ssml: string; prefixLen: number; srcIndex: number[] } {
  const lang = voice.split("-").slice(0, 2).join("-") || "en-US";
  const pct = Math.round((speed - 1) * 100);
  const prefix = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${pct >= 0 ? "+" : ""}${pct}%">`;
  const { escaped, srcIndex } = escapeWithMap(text);
  return { ssml: `${prefix}${escaped}</prosody></voice></speak>`, prefixLen: prefix.length, srcIndex };
}

export class AzureEngine implements TtsEngine {
  readonly id = "azure" as const;
  readonly label = "Azure Neural voices (API key)";
  readonly caps = { wordTimings: true, speedRange: [0.5, 2] as [number, number], offline: false, maxChars: 3000, concurrency: 2, needsKey: true };
  private cfg: () => AzureConfig;
  private voicesCache: VoiceInfo[] | null = null;

  constructor(cfg: () => AzureConfig) {
    this.cfg = cfg;
  }

  modelTag(): string {
    return `azure-${this.cfg().region}`;
  }

  async init(onStatus: (s: EngineStatus) => void): Promise<void> {
    const c = this.cfg();
    if (!c.apiKey || !c.region) {
      const msg = "Azure Speech key/region missing — add them in Settings › Voice & engine.";
      onStatus({ state: "error", error: msg });
      throw new Error(msg);
    }
    onStatus({ state: "ready", device: "cloud" });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.voicesCache) return this.voicesCache;
    const c = this.cfg();
    const fallback = FALLBACK_VOICES.map((v) => ({ id: v, name: v.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, ""), lang: v.slice(0, 5), engine: "azure" as const }));
    if (!c.apiKey || !c.region) return fallback;
    try {
      const res = await fetch(`https://${c.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": c.apiKey } });
      if (!res.ok) return fallback;
      const list = (await res.json()) as { ShortName: string; DisplayName: string; Locale: string; Gender: string }[];
      this.voicesCache = list
        .filter((v) => v.Locale.startsWith("en"))
        .map((v) => ({ id: v.ShortName, name: `${v.DisplayName}`, lang: v.Locale, gender: v.Gender === "Female" ? "f" : "m", engine: "azure" as const }));
      return this.voicesCache;
    } catch {
      return fallback;
    }
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const c = this.cfg();
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");
    const config = sdk.SpeechConfig.fromSubscription(c.apiKey ?? "", c.region);
    config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
    // Passing null audio config: return audio data instead of playing it.
    const synth = new sdk.SpeechSynthesizer(config, null as unknown as undefined);
    const { ssml, prefixLen, srcIndex } = buildSsml(req.text, req.voice, req.speed);
    const timings: WordTiming[] = [];
    synth.wordBoundary = (_s, e) => {
      if (e.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return;
      const escStart = e.textOffset - prefixLen;
      const escEnd = escStart + e.wordLength;
      if (escStart < 0 || escStart >= srcIndex.length) return;
      const charStart = srcIndex[escStart];
      const charEnd = (srcIndex[Math.min(escEnd, srcIndex.length) - 1] ?? charStart) + 1;
      const start = e.audioOffset / 1e7;
      timings.push({ start, end: start + e.duration / 1e7, charStart, charEnd });
    };
    const audio = await new Promise<ArrayBuffer>((resolve, reject) => {
      const onAbort = () => {
        synth.close();
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });
      synth.speakSsmlAsync(
        ssml,
        (result) => {
          req.signal?.removeEventListener("abort", onAbort);
          synth.close();
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) resolve(result.audioData);
          else reject(new Error(`Azure TTS failed: ${result.errorDetails || sdk.ResultReason[result.reason]}`));
        },
        (err) => {
          synth.close();
          reject(new Error(`Azure TTS failed: ${err}`));
        },
      );
    });
    return { pcm: s16leBytesToFloat(audio), sampleRate: 24000, timings, timingSource: timings.length ? "engine" : "estimated" };
  }

  dispose(): void {}
}
