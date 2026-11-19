import { floatToInt16, normalizeLoudness, trimSilence } from "../tts/pcm";

/** Sample rate used for cloning references (Chatterbox and storage). */
export const VOICE_SR = 24000;
export const MIN_SPEECH_SECONDS = 8;
export const MAX_CLIP_SECONDS = 90;
/** Reference window length for on-device cloning (the model works best with ~10–20 s). */
export const REF_SECONDS = 20;

const FRAME = 0.02;

export interface PreparedClip {
  /** Cleaned, loudness-normalized mono audio at 24 kHz. */
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
  speechSec: number;
  /** Best reference window, in samples. */
  refStart: number;
  refEnd: number;
}

export class ClipError extends Error {}

/** Decodes any browser-supported audio file/recording to mono Float32 at 24 kHz. */
export async function decodeToMono24k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  // decodeAudioData resamples to the context's rate.
  const ctx = new OfflineAudioContext(1, 1, VOICE_SR);
  const audio = await ctx.decodeAudioData(buf);
  const n = audio.length;
  const out = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
}

/** Per-frame voiced flags using an adaptive energy threshold. */
export function voicedFrames(pcm: Float32Array, sr: number): { voiced: Uint8Array; hop: number } {
  const hop = Math.max(1, Math.round(sr * FRAME));
  const n = Math.floor(pcm.length / hop);
  const e = new Float32Array(n);
  let peak = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += pcm[i] * pcm[i];
    e[f] = Math.sqrt(s / hop);
    peak = Math.max(peak, e[f]);
  }
  const sorted = Array.from(e).sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)] ?? 0;
  const thr = Math.max(0.05 * peak, 3 * noise, 1e-4);
  const voiced = new Uint8Array(n);
  for (let f = 0; f < n; f++) voiced[f] = e[f] > thr ? 1 : 0;
  return { voiced, hop };
}

/**
 * Picks the window (≤ maxSeconds) with the most speech, snapping its edges to nearby silence so
 * words are not cut.
 */
export function bestWindow(pcm: Float32Array, sr: number, maxSeconds = REF_SECONDS): { start: number; end: number } {
  const { voiced, hop } = voicedFrames(pcm, sr);
  const n = voiced.length;
  const w = Math.min(n, Math.round(maxSeconds / FRAME));
  if (w >= n) return { start: 0, end: pcm.length };
  let sum = 0;
  for (let f = 0; f < w; f++) sum += voiced[f];
  let best = sum;
  let bestAt = 0;
  for (let f = w; f < n; f++) {
    sum += voiced[f] - voiced[f - w];
    if (sum > best) {
      best = sum;
      bestAt = f - w + 1;
    }
  }
  // Snap edges inward to the nearest unvoiced frame (within 0.6 s).
  const reach = Math.round(0.6 / FRAME);
  let s = bestAt;
  for (let k = 0; k <= reach && s + k < n; k++) if (!voiced[s + k]) {
    s += k;
    break;
  }
  let e = bestAt + w - 1;
  for (let k = 0; k <= reach && e - k > s; k++) if (!voiced[e - k]) {
    e -= k;
    break;
  }
  return { start: s * hop, end: Math.min(pcm.length, (e + 1) * hop) };
}

/** Cleans a recording and validates it for cloning. Throws ClipError with a helpful message. */
export function prepareClip(raw: Float32Array, sr = VOICE_SR): PreparedClip {
  if (raw.length < sr * 2) throw new ClipError("The recording is too short. Please record at least 15 seconds of speech.");
  let clipped = 0;
  for (let i = 0; i < raw.length; i++) if (Math.abs(raw[i]) > 0.995) clipped++;
  if (clipped / raw.length > 0.005) throw new ClipError("The recording is distorted (too loud). Move a little away from the microphone or lower its volume, then try again.");
  let pcm = trimSilence(raw, sr, 120, 0.004).pcm;
  if (pcm.length > MAX_CLIP_SECONDS * sr) pcm = pcm.slice(0, MAX_CLIP_SECONDS * sr);
  pcm = normalizeLoudness(pcm, -20);
  const { voiced, hop } = voicedFrames(pcm, sr);
  const speechSec = (voiced.reduce((a, b) => a + b, 0) * hop) / sr;
  if (speechSec < MIN_SPEECH_SECONDS) {
    throw new ClipError(`Only about ${Math.round(speechSec)} s of speech was detected. Please provide at least ${MIN_SPEECH_SECONDS} s of clear speech (about a minute works best).`);
  }
  const { start, end } = bestWindow(pcm, sr);
  return { pcm, sampleRate: sr, durationSec: pcm.length / sr, speechSec, refStart: start, refEnd: end };
}

export const clipToInt16Buffer = (pcm: Float32Array): ArrayBuffer => floatToInt16(pcm).buffer as ArrayBuffer;

export interface Recorder {
  /** 0..1 input level for a meter. */
  level(): number;
  /** Seconds recorded so far. */
  elapsed(): number;
  stop(): Promise<Blob>;
  cancel(): void;
}

/** Records from the microphone (with echo cancellation / noise suppression). */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = performance.now();
  rec.start(250);
  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  return {
    level() {
      analyser.getFloatTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      return Math.min(1, Math.sqrt(s / data.length) * 4);
    },
    elapsed: () => (performance.now() - t0) / 1000,
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
    cancel() {
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      cleanup();
    },
  };
}

/** A passage that covers varied sounds; reading it for ~1 minute gives a good clone. */
export const READING_PASSAGE =
  "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. " +
  "The rainbow is a division of white light into many beautiful colors. These take the shape of a long round arch, " +
  "with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end. " +
  "People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow. " +
  "Throughout the centuries people have explained the rainbow in various ways. Some have accepted it as a miracle without physical explanation.";
