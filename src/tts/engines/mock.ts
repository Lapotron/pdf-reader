import { AbortError, type EngineStatus, type SynthesisRequest, type SynthesisResult, type TtsEngine, type VoiceInfo, type WordTiming } from "../types";

/**
 * Deterministic test engine: quiet tone bursts per word with exact word timings.
 * Used by unit/e2e tests and selectable with ?engine=mock. No network or GPU needed.
 */
export class MockEngine implements TtsEngine {
  readonly id = "mock" as const;
  readonly label = "Test tones (mock)";
  readonly caps = { wordTimings: true, speedRange: [0.25, 4] as [number, number], offline: true, maxChars: 350, concurrency: 2, needsKey: false };
  calls = 0;
  delayMs: number;
  /** Multiplies all durations (tests use < 1 to run faster). */
  timeScale: number;

  constructor(delayMs = 5, timeScale = 1) {
    this.delayMs = delayMs;
    this.timeScale = timeScale;
  }

  modelTag(): string {
    return "mock-v1";
  }

  async init(onStatus: (s: EngineStatus) => void): Promise<void> {
    onStatus({ state: "ready", device: "cpu" });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: "tone-a", name: "Tone A", lang: "en-US", engine: "mock", gender: "f" },
      { id: "tone-b", name: "Tone B", lang: "en-US", engine: "mock", gender: "m" },
    ];
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (req.signal?.aborted) throw new AbortError();
    const sr = 24000;
    const k = this.timeScale;
    const perChar = (0.05 * k) / req.speed;
    const freq = req.voice === "tone-b" ? 180 : 260;
    const segs: { start: number; end: number; voiced: boolean }[] = [];
    const timings: WordTiming[] = [];
    let t = 0.03;
    const re = /[\p{L}\p{N}'’]+/gu;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = re.exec(req.text)) !== null) {
      const between = req.text.slice(lastEnd, m.index);
      t += (/[.!?]/.test(between) ? 0.25 : /[,;:]/.test(between) ? 0.15 : lastEnd ? 0.04 : 0) * (k / req.speed);
      const d = Math.max(0.08 * k, m[0].length * perChar);
      segs.push({ start: t, end: t + d, voiced: true });
      timings.push({ start: t, end: t + d, charStart: m.index, charEnd: m.index + m[0].length });
      t += d;
      lastEnd = m.index + m[0].length;
    }
    t += 0.03;
    const pcm = new Float32Array(Math.ceil(t * sr));
    for (const s of segs) {
      const a = Math.floor(s.start * sr);
      const b = Math.min(pcm.length, Math.floor(s.end * sr));
      for (let i = a; i < b; i++) {
        const env = Math.min(1, (i - a) / 240, (b - i) / 240);
        pcm[i] = 0.06 * env * Math.sin((2 * Math.PI * freq * (i - a)) / sr);
      }
    }
    return { pcm, sampleRate: sr, timings, timingSource: "engine" };
  }

  dispose(): void {}
}
