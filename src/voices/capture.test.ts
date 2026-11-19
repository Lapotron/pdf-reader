import { describe, expect, it } from "vitest";
import { bestWindow, ClipError, prepareClip, VOICE_SR } from "./capture";

/** Speech-like test signal: voiced bursts (amplitude-modulated tones) separated by pauses. */
function speechLike(segments: [seconds: number, voiced: boolean][], amp = 0.3): Float32Array {
  const total = segments.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * VOICE_SR));
  let o = 0;
  for (const [d, v] of segments) {
    const n = Math.round(d * VOICE_SR);
    if (v) for (let i = 0; i < n; i++) out[o + i] = amp * Math.sin((2 * Math.PI * 180 * i) / VOICE_SR) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / VOICE_SR));
    o += n;
  }
  return out;
}

describe("voice capture", () => {
  it("accepts a clean recording and picks a speech-dense reference window", () => {
    // 5 s mostly silent, then 30 s of dense speech, then 10 s sparse.
    const segs: [number, boolean][] = [[1, true], [4, false]];
    for (let i = 0; i < 15; i++) segs.push([1.6, true], [0.4, false]);
    for (let i = 0; i < 5; i++) segs.push([0.5, true], [1.5, false]);
    const clip = prepareClip(speechLike(segs));
    expect(clip.speechSec).toBeGreaterThan(20);
    const refSec = (clip.refEnd - clip.refStart) / VOICE_SR;
    expect(refSec).toBeGreaterThan(18);
    expect(refSec).toBeLessThanOrEqual(20.01);
    // The window sits inside the dense part (which starts ~4 s after the leading burst once trimmed).
    expect(clip.refStart / VOICE_SR).toBeGreaterThan(3);
  });

  it("rejects too little speech", () => {
    expect(() => prepareClip(speechLike([[3, true], [10, false], [2, true]]))).toThrow(ClipError);
  });

  it("rejects clipped (distorted) audio", () => {
    const loud = speechLike(Array.from({ length: 20 }, (_, i) => [1, i % 2 === 0] as [number, boolean]), 1.6).map((x) => Math.max(-1, Math.min(1, x)));
    expect(() => prepareClip(loud)).toThrow(/too loud/);
  });

  it("uses the whole clip when it is shorter than the window", () => {
    const pcm = speechLike([[3, true], [0.5, false], [3, true]]);
    expect(bestWindow(pcm, VOICE_SR)).toEqual({ start: 0, end: pcm.length });
  });
});
