import { syllables } from "../text/syllables";
import type { WordTiming } from "./types";

export interface WordSpan {
  start: number;
  end: number;
}

interface Gap {
  start: number;
  end: number;
}

const FRAME = 0.01;

function pauseWeight(between: string): number {
  if (/[.?!]/.test(between)) return 2.5;
  if (/[;:—–]/.test(between)) return 1.8;
  if (/,/.test(between)) return 1.2;
  if (/[)\]"”]/.test(between)) return 0.4;
  return 0;
}

/** Voiced span and internal silences of a speech clip. */
export function analyzeSilence(pcm: Float32Array, sr: number): { t0: number; t1: number; gaps: Gap[] } {
  const hop = Math.max(1, Math.round(sr * FRAME));
  const n = Math.floor(pcm.length / hop);
  if (n === 0) return { t0: 0, t1: pcm.length / sr, gaps: [] };
  const e = new Float32Array(n);
  let peak = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += pcm[i] * pcm[i];
    e[f] = Math.sqrt(s / hop);
    peak = Math.max(peak, e[f]);
  }
  const sorted = Array.from(e).sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)];
  const thr = Math.max(0.04 * peak, 3 * noise, 1e-4);
  let first = -1;
  let last = -1;
  for (let f = 0; f < n; f++)
    if (e[f] > thr) {
      if (first < 0) first = f;
      last = f;
    }
  if (first < 0) return { t0: 0, t1: pcm.length / sr, gaps: [] };
  const gaps: Gap[] = [];
  let run = -1;
  for (let f = first; f <= last; f++) {
    if (e[f] <= thr) {
      if (run < 0) run = f;
    } else if (run >= 0) {
      if (f - run >= 9) gaps.push({ start: run * FRAME, end: f * FRAME });
      run = -1;
    }
  }
  return { t0: first * FRAME, t1: (last + 1) * FRAME, gaps };
}

/**
 * Estimates per-word timings when an engine provides none: words are weighted by syllables,
 * punctuation adds expected pauses, and expected pauses are anchored to detected silences
 * (dynamic programming), then words are spread proportionally inside each anchored segment.
 */
export function estimateWordTimings(pcm: Float32Array, sr: number, text: string, words: WordSpan[]): WordTiming[] {
  if (words.length === 0) return [];
  const { t0, t1, gaps } = analyzeSilence(pcm, sr);
  const wWeight = words.map((w) => 0.5 + syllables(text.slice(w.start, w.end)));
  const pWeight = words.map((w, i) => (i + 1 < words.length ? pauseWeight(text.slice(w.end, words[i + 1].start)) : 0));

  // Expected (unanchored) time of each pause slot.
  const total = wWeight.reduce((a, b) => a + b, 0) + pWeight.reduce((a, b) => a + b, 0);
  const scale = (t1 - t0) / Math.max(total, 1e-6);
  const slots: { word: number; t: number }[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += wWeight[i];
    if (pWeight[i] > 0) slots.push({ word: i, t: t0 + (acc + pWeight[i] / 2) * scale });
    acc += pWeight[i];
  }

  // DP alignment of slots to gaps (monotone, either may stay unmatched).
  const S = slots.length;
  const G = gaps.length;
  const SKIP_SLOT = 0.25;
  const SKIP_GAP = 0.12;
  const tol = Math.max(0.35, 0.25 * (t1 - t0));
  const dp: number[][] = Array.from({ length: S + 1 }, () => new Array(G + 1).fill(Infinity));
  const back: number[][] = Array.from({ length: S + 1 }, () => new Array(G + 1).fill(0));
  dp[0][0] = 0;
  for (let i = 0; i <= S; i++)
    for (let j = 0; j <= G; j++) {
      const cur = dp[i][j];
      if (cur === Infinity) continue;
      if (i < S && cur + SKIP_SLOT < dp[i + 1][j]) {
        dp[i + 1][j] = cur + SKIP_SLOT;
        back[i + 1][j] = 1;
      }
      if (j < G && cur + SKIP_GAP < dp[i][j + 1]) {
        dp[i][j + 1] = cur + SKIP_GAP;
        back[i][j + 1] = 2;
      }
      if (i < S && j < G) {
        const mid = (gaps[j].start + gaps[j].end) / 2;
        const d = Math.abs(slots[i].t - mid);
        if (d < tol && cur + d < dp[i + 1][j + 1]) {
          dp[i + 1][j + 1] = cur + d;
          back[i + 1][j + 1] = 3;
        }
      }
    }
  const anchors: { word: number; gap: Gap }[] = [];
  for (let i = S, j = G; i > 0 || j > 0; ) {
    const b = back[i][j];
    if (b === 3) {
      anchors.push({ word: slots[i - 1].word, gap: gaps[j - 1] });
      i--;
      j--;
    } else if (b === 1) i--;
    else j--;
  }
  anchors.reverse();

  // Spread words within segments delimited by anchors.
  const out: WordTiming[] = new Array(words.length);
  let segStartWord = 0;
  let segStartT = t0;
  const bounds = [...anchors, { word: words.length - 1, gap: { start: t1, end: t1 } }];
  for (const a of bounds) {
    const endWord = a.word;
    const segEndT = a.gap.start;
    let segW = 0;
    for (let k = segStartWord; k <= endWord; k++) segW += wWeight[k] + (k < endWord ? pWeight[k] : 0);
    const sc = (segEndT - segStartT) / Math.max(segW, 1e-6);
    let t = segStartT;
    for (let k = segStartWord; k <= endWord; k++) {
      const d = wWeight[k] * sc;
      out[k] = { start: t, end: t + d, charStart: words[k].start, charEnd: words[k].end };
      t += d + (k < endWord ? pWeight[k] * sc : 0);
    }
    segStartWord = endWord + 1;
    segStartT = a.gap.end;
    if (segStartWord >= words.length) break;
  }
  return out;
}

/** Converts per-character alignment (e.g. ElevenLabs) into word timings. */
export function alignmentToTimings(chars: string[], starts: number[], ends: number[], text: string, words: WordSpan[]): WordTiming[] {
  // Map each text char to an alignment index by walking both strings (alignment text may differ slightly).
  const at = new Int32Array(text.length).fill(-1);
  let j = 0;
  for (let i = 0; i < text.length && j < chars.length; i++) {
    if (text[i] === chars[j]) {
      at[i] = j++;
    } else {
      // try to resync within a small window
      let k = j;
      while (k < Math.min(chars.length, j + 4) && chars[k] !== text[i]) k++;
      if (k < chars.length && chars[k] === text[i]) {
        at[i] = k;
        j = k + 1;
      }
    }
  }
  const out: WordTiming[] = [];
  let lastEnd = 0;
  for (const w of words) {
    let s = -1;
    let e = -1;
    for (let i = w.start; i < w.end; i++) if (at[i] >= 0) {
      if (s < 0) s = at[i];
      e = at[i];
    }
    const start = s >= 0 ? starts[s] : lastEnd;
    const end = e >= 0 ? ends[e] : start;
    out.push({ start, end: Math.max(end, start), charStart: w.start, charEnd: w.end });
    lastEnd = Math.max(end, start);
  }
  return out;
}

/** Index of the word being spoken at time t (seconds, rate 1), or -1 before the first. */
export function wordAtTime(timings: WordTiming[], t: number): number {
  let lo = 0;
  let hi = timings.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (timings[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
