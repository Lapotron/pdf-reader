import { sha256Hex } from "../lib/hash";
import { pageOf } from "../pdf/types";
import type { ReadingModel } from "../text/readingModel";
import { chunkSentence } from "../text/segment";
import type { AudioCache } from "../tts/audioCache";
import { NORMALIZER_VERSION, type PlaybackPrefs } from "../tts/player";
import { normalizeLoudness, resample, trimSilence } from "../tts/pcm";
import type { TtsEngine } from "../tts/types";
import type { Cue } from "./subtitles";

export interface ExportProgress {
  done: number;
  total: number;
  phase: "planning" | "synthesizing" | "encoding";
}

export interface ExportResult {
  pcm: Float32Array;
  sampleRate: number;
  cues: Cue[];
}

/**
 * Synthesizes pages [from, to] into one PCM track (reusing the audio cache), with sentence
 * and paragraph pauses, plus sentence-level subtitle cues.
 */
export async function exportRange(
  model: ReadingModel,
  engine: TtsEngine,
  prefs: PlaybackPrefs,
  from: number,
  to: number,
  cache: AudioCache | null,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  onProgress({ done: 0, total: 0, phase: "planning" });
  const sentences = [];
  for (let p = from; p <= to; p++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    for (const s of await model.sentencesOfPage(p)) sentences.push(s);
  }
  const [lo, hi] = engine.caps.speedRange;
  const synthSpeed = Math.min(hi, Math.max(lo, prefs.speed));
  const parts: { pcm: Float32Array; sr: number; pauseAfter: number; text: string; first: boolean }[] = [];
  let done = 0;
  const total = sentences.length;
  onProgress({ done, total, phase: "synthesizing" });
  for (const s of sentences) {
    const chunks = chunkSentence(s.text, engine.caps.maxChars);
    for (let ci = 0; ci < chunks.length; ci++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const text = chunks[ci].text;
      const key = await sha256Hex([engine.id, engine.modelTag(), prefs.voice, synthSpeed.toFixed(2), NORMALIZER_VERSION, prefs.trimSilence ? 1 : 0, prefs.normalize ? 1 : 0, text].join("␟"));
      let pcm: Float32Array;
      let sr: number;
      const hit = cache ? await cache.get(key) : null;
      if (hit) {
        pcm = hit.pcm;
        sr = hit.sampleRate;
      } else {
        const r = await engine.synthesize({ text, voice: prefs.voice, speed: synthSpeed, signal, priority: 0 });
        pcm = prefs.trimSilence ? trimSilence(r.pcm, r.sampleRate).pcm : r.pcm;
        if (prefs.normalize) pcm = normalizeLoudness(pcm);
        sr = r.sampleRate;
      }
      const last = ci === chunks.length - 1;
      parts.push({ pcm, sr, pauseAfter: last ? (s.pauseAfter === "paragraph" ? prefs.pauseParagraph : prefs.pauseSentence) : 0.04, text: s.text, first: ci === 0 });
    }
    done++;
    onProgress({ done, total, phase: "synthesizing" });
  }
  const sampleRate = parts[0]?.sr ?? 24000;
  const resampled = parts.map((p) => ({ ...p, pcm: resample(p.pcm, p.sr, sampleRate) }));
  const length = resampled.reduce((n, p) => n + p.pcm.length + Math.round(p.pauseAfter * sampleRate), 0);
  const out = new Float32Array(length);
  const cues: Cue[] = [];
  let o = 0;
  for (const p of resampled) {
    const start = o / sampleRate;
    out.set(p.pcm, o);
    o += p.pcm.length;
    const end = o / sampleRate;
    if (p.first) cues.push({ start, end, text: p.text });
    else if (cues.length) cues[cues.length - 1].end = end;
    o += Math.round(p.pauseAfter * sampleRate);
  }
  void pageOf;
  return { pcm: out, sampleRate, cues };
}
