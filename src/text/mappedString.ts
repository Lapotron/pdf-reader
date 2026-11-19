import type { SrcPos } from "../pdf/types";

export interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * A string whose every char remembers the source position it came from.
 *
 * map[i] is the SrcPos of output char i; map[text.length] is an end sentinel.
 * Every transformation maps back to the ORIGINAL source (not the previous stage), so
 * transformations compose and `map` stays non-decreasing. Replaced text is "spread" over
 * the source range it replaces, so e.g. "SQL" → "sequel" still highlights "SQL".
 */
export class MappedString {
  readonly text: string;
  readonly map: Float64Array;

  constructor(text: string, map: Float64Array) {
    if (map.length !== text.length + 1) {
      throw new Error(`MappedString: map length ${map.length} != text length + 1 (${text.length + 1})`);
    }
    this.text = text;
    this.map = map;
  }

  get length(): number {
    return this.text.length;
  }

  static identity(text: string, base: SrcPos): MappedString {
    const map = new Float64Array(text.length + 1);
    for (let i = 0; i <= text.length; i++) map[i] = base + i;
    return new MappedString(text, map);
  }

  static empty(at: SrcPos = 0): MappedString {
    return new MappedString("", Float64Array.of(at));
  }

  /**
   * Concatenates parts. `separators[i]` (inserted between parts i and i+1) maps to the end
   * sentinel of part i, keeping the map monotonic.
   */
  static concat(parts: MappedString[], separators: string[] = []): MappedString {
    if (parts.length === 0) return MappedString.empty();
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      total += parts[i].length;
      if (i < parts.length - 1) total += (separators[i] ?? "").length;
    }
    const map = new Float64Array(total + 1);
    const chunks: string[] = [];
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      map.set(p.map.subarray(0, p.length), o);
      o += p.length;
      chunks.push(p.text);
      if (i < parts.length - 1) {
        const sep = separators[i] ?? "";
        const at = p.map[p.length];
        for (let j = 0; j < sep.length; j++) map[o + j] = at;
        o += sep.length;
        chunks.push(sep);
      }
    }
    map[total] = parts[parts.length - 1].map[parts[parts.length - 1].length];
    return new MappedString(chunks.join(""), map);
  }

  /** Applies non-overlapping edits (any order). */
  edit(edits: Edit[]): MappedString {
    if (edits.length === 0) return this;
    const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
    let newLen = this.length;
    for (const e of sorted) newLen += e.text.length - (e.end - e.start);
    const map = new Float64Array(newLen + 1);
    const out: string[] = [];
    let cursor = 0;
    let o = 0;
    for (const e of sorted) {
      if (e.start < cursor || e.end < e.start || e.end > this.length) {
        throw new Error(`MappedString.edit: invalid or overlapping edit [${e.start}, ${e.end})`);
      }
      // untouched span
      if (e.start > cursor) {
        out.push(this.text.slice(cursor, e.start));
        map.set(this.map.subarray(cursor, e.start), o);
        o += e.start - cursor;
      }
      // replacement, spread over the replaced source range
      const k = e.text.length;
      if (k > 0) {
        const a = this.map[e.start];
        const b = e.end > e.start ? this.map[e.end - 1] + 1 : a;
        const span = b - a;
        for (let j = 0; j < k; j++) map[o + j] = a + Math.floor((j * span) / k);
        out.push(e.text);
        o += k;
      }
      cursor = e.end;
    }
    if (cursor < this.length) {
      out.push(this.text.slice(cursor));
      map.set(this.map.subarray(cursor, this.length), o);
      o += this.length - cursor;
    }
    map[newLen] = this.map[this.length];
    return new MappedString(out.join(""), map);
  }

  /** Regex replace with String.replace-style `$1`, `$&`, `$<name>`, `$$` patterns, or a function. */
  replaceAll(re: RegExp, repl: string | ((m: RegExpExecArray) => string)): MappedString {
    const g = re.global ? re : new RegExp(re.source, re.flags + "g");
    g.lastIndex = 0;
    const edits: Edit[] = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.text)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      const text = typeof repl === "function" ? repl(m) : expandReplacement(repl, m);
      if (text !== m[0]) edits.push({ start: m.index, end: m.index + m[0].length, text });
    }
    return this.edit(edits);
  }

  deleteAll(re: RegExp): MappedString {
    return this.replaceAll(re, "");
  }

  slice(start: number, end: number = this.length): MappedString {
    const s = Math.max(0, Math.min(start, this.length));
    const e = Math.max(s, Math.min(end, this.length));
    const map = new Float64Array(e - s + 1);
    map.set(this.map.subarray(s, e), 0);
    map[e - s] = e < this.length ? this.map[e] : this.map[this.length];
    return new MappedString(this.text.slice(s, e), map);
  }

  /** Source range [start, end) covered by output chars [start, end). */
  toSrcRange(start: number, end: number): [SrcPos, SrcPos] {
    if (end <= start) {
      const p = this.map[Math.min(Math.max(start, 0), this.length)];
      return [p, p];
    }
    return [this.map[start], this.map[end - 1] + 1];
  }

  /** First output index whose source position is >= src (length if none). */
  toOut(src: SrcPos): number {
    let lo = 0;
    let hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.map[mid] < src) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

function expandReplacement(repl: string, m: RegExpExecArray): string {
  if (!repl.includes("$")) return repl;
  return repl.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (tok, k: string) => {
    if (k === "$") return "$";
    if (k === "&") return m[0];
    if (k === "`" || k === "'") return ""; // context patterns are not supported (rarely useful here)
    if (k.startsWith("<")) return m.groups?.[k.slice(1, -1)] ?? "";
    const n = Number(k);
    if (n > 0 && n < m.length) return m[n] ?? "";
    // "$12" with only 1 group → "$1" + "2"
    if (k.length === 2) {
      const n1 = Number(k[0]);
      if (n1 > 0 && n1 < m.length) return (m[n1] ?? "") + k[1];
    }
    return tok;
  });
}
