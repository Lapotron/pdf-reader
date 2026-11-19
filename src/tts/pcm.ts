/** PCM helpers (mono Float32 in [-1, 1]). */

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** Decodes little-endian signed 16-bit PCM bytes. */
export function s16leBytesToFloat(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const n = Math.floor(buf.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function hasInvalidSamples(f: Float32Array): boolean {
  for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i])) return true;
  return false;
}

export function rms(f: Float32Array, start = 0, end = f.length): number {
  let s = 0;
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) s += f[i] * f[i];
  return Math.sqrt(s / n);
}

/**
 * Trims leading/trailing silence, keeping `keepMs` of margin. Returns the trimmed copy and
 * the number of samples removed from the start (to shift timings).
 */
export function trimSilence(f: Float32Array, sr: number, keepMs = 30, threshold = 0.004): { pcm: Float32Array; offset: number } {
  const win = Math.max(1, Math.round(sr * 0.005));
  let a = 0;
  while (a + win < f.length && rms(f, a, a + win) < threshold) a += win;
  let b = f.length;
  while (b - win > a && rms(f, b - win, b) < threshold) b -= win;
  const keep = Math.round((sr * keepMs) / 1000);
  a = Math.max(0, a - keep);
  b = Math.min(f.length, b + keep);
  if (a === 0 && b === f.length) return { pcm: f, offset: 0 };
  return { pcm: f.slice(a, b), offset: a };
}

/** Peak-safe loudness normalization toward a target RMS (dBFS). */
export function normalizeLoudness(f: Float32Array, targetDb = -20): Float32Array {
  const r = rms(f);
  if (r < 1e-5) return f;
  let peak = 0;
  for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i]));
  const target = Math.pow(10, targetDb / 20);
  const gain = Math.min(target / r, 0.98 / Math.max(peak, 1e-6), 4);
  if (Math.abs(gain - 1) < 0.05) return f;
  const out = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i] * gain;
  return out;
}

/** Linear-interpolation resampler (adequate for speech export/concat). */
export function resample(f: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return f;
  const ratio = from / to;
  const n = Math.floor(f.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(f.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = f[i0] * (1 - t) + f[i1] * t;
  }
  return out;
}

/**
 * WSOLA time-stretch: changes duration by 1/rate without changing pitch.
 * rate > 1 speeds up. Frames of ~30 ms with 50% overlap; each new frame is aligned to the
 * output by searching ±10 ms for the best cross-correlation.
 */
export function timeStretch(f: Float32Array, sr: number, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.01 || f.length < sr * 0.05) return f;
  const N = Math.round(sr * 0.03) & ~1; // frame length
  const Hs = N / 2; // synthesis hop
  const Ha = Hs * rate; // analysis hop
  const tol = Math.round(sr * 0.01);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.ceil(f.length / rate) + N;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  let prevPos = 0; // where the previous frame was read from (input)
  let k = 0;
  for (let outPos = 0; outPos + N < outLen; outPos += Hs, k++) {
    const target = Math.round(k * Ha);
    if (target + N >= f.length) break;
    let best = target;
    if (k > 0) {
      // Natural continuation of the previous frame, to match against.
      const nat = prevPos + Hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, target - tol);
      const hi = Math.min(f.length - N - 1, target + tol);
      for (let c = lo; c <= hi; c += 2) {
        let s = 0;
        for (let i = 0; i < Hs; i += 4) s += f[nat + i] * f[c + i];
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      out[outPos + i] += f[best + i] * win[i];
      norm[outPos + i] += win[i];
    }
    prevPos = best;
  }
  const n = Math.round(f.length / rate);
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}
