import { describe, expect, it } from "vitest";
import { alignmentToTimings, analyzeSilence, estimateWordTimings, wordAtTime } from "./timing";

const SR = 24000;
/** Synthetic speech: tone bursts for words, silence for pauses. */
function synth(segments: [number, boolean][]): Float32Array {
  const total = segments.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * SR));
  let o = 0;
  for (const [d, voiced] of segments) {
    const n = Math.round(d * SR);
    if (voiced) for (let i = 0; i < n; i++) out[o + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
    o += n;
  }
  return out;
}

describe("timing", () => {
  it("finds voiced span and internal gaps", () => {
    const pcm = synth([[0.2, false], [0.5, true], [0.3, false], [0.5, true], [0.1, false]]);
    const { t0, t1, gaps } = analyzeSilence(pcm, SR);
    expect(t0).toBeCloseTo(0.2, 1);
    expect(t1).toBeCloseTo(1.5, 1);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].start).toBeCloseTo(0.7, 1);
  });

  it("anchors punctuation pauses to silences and stays monotonic", () => {
    const text = "Hello there, my friend. How are you?";
    const words = [...text.matchAll(/[A-Za-z]+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
    // "Hello there" 0.8s, pause 0.25, "my friend" 0.7s, pause 0.4, "How are you" 0.9s
    const pcm = synth([[0.8, true], [0.25, false], [0.7, true], [0.4, false], [0.9, true]]);
    const t = estimateWordTimings(pcm, SR, text, words);
    expect(t).toHaveLength(words.length);
    for (let i = 0; i < t.length; i++) {
      expect(t[i].end).toBeGreaterThanOrEqual(t[i].start);
      if (i) expect(t[i].start).toBeGreaterThanOrEqual(t[i - 1].end - 1e-9);
    }
    // "my" starts after the first gap (~1.05s); "How" after the second (~2.15s)
    expect(t[2].start).toBeCloseTo(1.05, 1);
    expect(t[4].start).toBeCloseTo(2.15, 1);
    expect(wordAtTime(t, 2.2)).toBe(4);
    expect(wordAtTime(t, 0)).toBe(0);
  });

  it("groups character alignment into words", () => {
    const text = "Hi you";
    const chars = text.split("");
    const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const ends = starts.map((s) => s + 0.1);
    const t = alignmentToTimings(chars, starts, ends, text, [{ start: 0, end: 2 }, { start: 3, end: 6 }]);
    expect(t[0]).toMatchObject({ start: 0, end: 0.2 });
    expect(t[1]).toMatchObject({ start: 0.3 });
    expect(t[1].end).toBeCloseTo(0.6);
  });
});

import { timeStretch } from "./pcm";

describe("timeStretch", () => {
  it("changes duration but keeps pitch (zero-crossing rate)", () => {
    const sr = 24000;
    const f = new Float32Array(sr); // 1 s of 200 Hz
    for (let i = 0; i < f.length; i++) f[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / sr);
    const fast = timeStretch(f, sr, 1.5);
    expect(fast.length).toBe(Math.round(sr / 1.5));
    const zc = (x: Float32Array) => {
      let n = 0;
      for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) n++;
      return n / (x.length / sr);
    };
    expect(zc(fast)).toBeGreaterThan(380);
    expect(zc(fast)).toBeLessThan(420); // ~400 crossings/s for 200 Hz
  });
});
