import type { SrcPos } from "../pdf/types";
import type { MappedString } from "./mappedString";
import { NON_TERMINAL_ABBR } from "./rules";

export interface Word {
  /** Offsets within Sentence.text. */
  start: number;
  end: number;
  srcStart: SrcPos;
  srcEnd: SrcPos;
}

export interface Sentence {
  /** Stable id = srcStart. */
  id: SrcPos;
  text: string;
  /** Offsets within the speech MappedString of the window it was built from. */
  outStart: number;
  outEnd: number;
  srcStart: SrcPos;
  srcEnd: SrcPos;
  words: Word[];
  pauseAfter: "sentence" | "paragraph";
}

export interface Chunk {
  text: string;
  /** Offset of the chunk within Sentence.text. */
  start: number;
  end: number;
}

const sentenceSeg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;
const wordSeg = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "word" }) : null;

function rawSentenceBreaks(text: string): number[] {
  // Returns segment start offsets (always includes 0).
  if (sentenceSeg) return [...sentenceSeg.segment(text)].map((s) => s.index);
  const out = [0];
  const re = /[.!?]+["”’)\]]*\s+|\u2029/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m.index + m[0].length);
  return out.filter((v, i, a) => v < text.length && a.indexOf(v) === i);
}

function endsWithNonTerminalAbbr(seg: string): boolean {
  const t = seg.replace(/[\s"”’)\]]+$/u, "");
  if (!t.endsWith(".")) return false;
  const m = /(?:^|[\s(\[“"])([\p{L}][\p{L}.]*)\.$/u.exec(t);
  if (!m) return false;
  const word = m[1];
  if (NON_TERMINAL_ABBR.has(word.toLowerCase())) return true;
  if (/^\p{Lu}$/u.test(word)) return true; // initials: "J. R. R. Tolkien"
  return false;
}

/** Sentence segmentation with abbreviation/initial/lowercase-continuation fixes. */
export function splitSentences(ms: MappedString): Sentence[] {
  const text = ms.text;
  const starts = rawSentenceBreaks(text);
  starts.push(text.length);
  // Build raw segments then merge.
  const segs: [number, number][] = [];
  for (let i = 0; i < starts.length - 1; i++) if (starts[i + 1] > starts[i]) segs.push([starts[i], starts[i + 1]]);
  const merged: [number, number][] = [];
  for (const seg of segs) {
    const last = merged[merged.length - 1];
    if (last) {
      const prevText = text.slice(last[0], last[1]);
      const curText = text.slice(seg[0], seg[1]);
      const hardBreak = prevText.includes("\u2029");
      const continuesLower = /^\s*[\p{Ll}\d]/u.test(curText) && !/[!?]["”’)\]]*\s*$/u.test(prevText);
      if (!hardBreak && (endsWithNonTerminalAbbr(prevText) || continuesLower)) {
        last[1] = seg[1];
        continue;
      }
    }
    merged.push([seg[0], seg[1]]);
  }
  const out: Sentence[] = [];
  for (const [a0, b0] of merged) {
    // Also split at paragraph separators that Intl.Segmenter may not have honored.
    const piece = text.slice(a0, b0);
    let off = a0;
    for (const part of piece.split("\u2029")) {
      const a = off;
      const b = off + part.length;
      off = b + 1;
      const sentence = makeSentence(ms, a, b, b < b0 || /\u2029/.test(text.slice(b, b + 1)));
      if (sentence) out.push(sentence);
    }
  }
  return out;
}

function makeSentence(ms: MappedString, a: number, b: number, paraAfter: boolean): Sentence | null {
  const text = ms.text;
  while (a < b && /\s/u.test(text[a])) a++;
  while (b > a && /\s/u.test(text[b - 1])) b--;
  if (b <= a) return null;
  const t = text.slice(a, b);
  if (!/[\p{L}\p{N}]/u.test(t)) return null;
  const [srcStart, srcEnd] = ms.toSrcRange(a, b);
  const words: Word[] = [];
  const pushWord = (ws: number, we: number) => {
    const [s0, s1] = ms.toSrcRange(a + ws, a + we);
    words.push({ start: ws, end: we, srcStart: s0, srcEnd: s1 });
  };
  if (wordSeg) {
    for (const w of wordSeg.segment(t)) if (w.isWordLike) pushWord(w.index, w.index + w.segment.length);
  } else {
    for (const m of t.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)) pushWord(m.index!, m.index! + m[0].length);
  }
  return { id: srcStart, text: t, outStart: a, outEnd: b, srcStart, srcEnd, words, pauseAfter: paraAfter ? "paragraph" : "sentence" };
}

/** Splits a sentence into chunks no longer than maxChars, preferring clause boundaries. */
export function chunkSentence(text: string, maxChars: number, startOffset = 0): Chunk[] {
  const out: Chunk[] = [];
  const rec = (s: number, e: number) => {
    if (e - s <= maxChars) {
      const t = text.slice(s, e);
      if (t.trim()) out.push({ text: t.trim(), start: s + (t.length - t.trimStart().length), end: e - (t.length - t.trimEnd().length) });
      return;
    }
    const window = text.slice(s, s + maxChars);
    let cut = -1;
    for (const re of [/[;:—–]\s/g, /,\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(window)) !== null) if (m.index > maxChars * 0.3) last = m.index + m[0].length;
      if (last > 0) {
        cut = s + last;
        break;
      }
    }
    if (cut <= s) cut = s + maxChars; // no whitespace: hard split
    rec(s, cut);
    rec(cut, e);
  };
  rec(startOffset, text.length);
  return out;
}
