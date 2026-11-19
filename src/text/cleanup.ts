import { srcPos, type LineRole, type PageText } from "../pdf/types";
import { MappedString, type Edit } from "./mappedString";
import { applyRules, type CompiledRule } from "./pronunciation";
import { EXPANSIONS, KEEP_HYPHEN_PREFIX, RE, SYMBOLS } from "./rules";

export interface CleanupOptions {
  removeHeadersFooters: boolean;
  removePageNumbers: boolean;
  dehyphenate: boolean;
  skipFootnotes: boolean;
  skipFootnoteMarkers: boolean;
  skipCaptions: boolean;
  skipTables: boolean;
  skipRotated: boolean;
  skipCitationsNumeric: boolean;
  skipCitationsAuthorYear: boolean;
  urls: "read" | "skip" | "domain";
  skipEmails: boolean;
  expandAbbreviations: boolean;
  columnDetection: "auto" | "off";
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  removeHeadersFooters: true,
  removePageNumbers: true,
  dehyphenate: true,
  skipFootnotes: true,
  skipFootnoteMarkers: true,
  skipCaptions: false,
  skipTables: false,
  skipRotated: true,
  skipCitationsNumeric: true,
  skipCitationsAuthorYear: false,
  urls: "domain",
  skipEmails: false,
  expandAbbreviations: true,
  columnDetection: "auto",
};

export const PARA = "\u2029";
const TERMINAL_END = /[.!?:;]["”’)\]]?$/;

export function skippedRoles(o: CleanupOptions): Set<LineRole> {
  const s = new Set<LineRole>();
  if (o.removeHeadersFooters) {
    s.add("header");
    s.add("footer");
  }
  if (o.removePageNumbers) s.add("pageNum");
  if (o.skipFootnotes) s.add("footnote");
  if (o.skipCaptions) s.add("caption");
  if (o.skipTables) s.add("table");
  if (o.skipRotated) s.add("rotated");
  return s;
}

/** Stage A: page source minus skipped-role lines and superscript markers. */
export function pageToMapped(pt: PageText, o: CleanupOptions): MappedString {
  const ms = MappedString.identity(pt.source, srcPos(pt.page, 0));
  const skip = skippedRoles(o);
  const edits: Edit[] = [];
  for (const line of pt.lines) {
    if (skip.has(line.role)) {
      if (line.srcEnd > line.srcStart) edits.push({ start: line.srcStart, end: line.srcEnd, text: "" });
      continue;
    }
    if (o.skipFootnoteMarkers) {
      for (const ii of line.items) {
        const it = pt.items[ii];
        if (!it.sup) continue;
        const s = pt.itemSrcStart[ii];
        if (s >= 0 && /^[\d*†‡§¶,\s]+$/.test(it.str)) edits.push({ start: s, end: s + it.str.length, text: "" });
      }
    }
  }
  return ms.edit(edits);
}

function buildVocabulary(text: string): { joined: Set<string>; hyphenated: Set<string> } {
  const joined = new Set<string>();
  const hyphenated = new Set<string>();
  for (const m of text.matchAll(/\p{L}+(?:-\p{L}+)*/gu)) {
    const w = m[0].toLowerCase();
    if (w.includes("-")) hyphenated.add(w);
    else joined.add(w);
  }
  return { joined, hyphenated };
}

/** Stage B: paragraph breaks, de-hyphenation, line joins, whitespace collapse. */
export function joinLines(ms: MappedString, o: CleanupOptions): MappedString {
  let cur = ms.replaceAll(/[\t\r   ]/g, " ");
  cur = cur.replaceAll(/[ ]*\n(?:[ ]*\n)+[ \n]*/g, PARA);
  if (o.dehyphenate) {
    const vocab = buildVocabulary(cur.text.replace(/-\n/g, " "));
    const re = /(\p{L}{1,})([-­‐])[ ]*\n[ ]*(\p{L}+)/gu;
    const edits: Edit[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(cur.text)) !== null) {
      const [whole, left, hyphen, rightWord] = m;
      const hyStart = m.index + left.length;
      const hyEnd = m.index + whole.length - rightWord.length;
      const keep = keepHyphen(left, hyphen, rightWord, vocab);
      edits.push({ start: hyStart, end: hyEnd, text: keep ? "-" : "" });
      re.lastIndex = hyEnd; // allow overlapping chains like "a-\nb-\nc"
    }
    cur = cur.edit(edits);
  }
  cur = cur.replaceAll(/[ ]*\n[ ]*/g, " ");
  cur = cur.replaceAll(/ {2,}/g, " ");
  cur = cur.replaceAll(/ ?\u2029[ \u2029]*/g, PARA);
  cur = cur.replaceAll(/^[ \u2029]+|[ \u2029]+$/g, "");
  return cur;
}

function keepHyphen(left: string, hyphen: string, right: string, vocab: { joined: Set<string>; hyphenated: Set<string> }): boolean {
  if (hyphen === "­") return false; // soft hyphen
  if (/^\p{Lu}/u.test(right)) return true; // "Jean-\nPaul", "non-\nEuclidean"
  const l = left.toLowerCase();
  const r = right.toLowerCase();
  if (vocab.joined.has(l + r)) return false;
  if (vocab.hyphenated.has(`${l}-${r}`)) return true;
  if (KEEP_HYPHEN_PREFIX.has(l)) return true;
  return false;
}

/**
 * Builds the display text for consecutive pages: stage A per page, page joins, stage B.
 * Pages ending without terminal punctuation continue the sentence on the next page.
 */
export function buildDisplay(pages: PageText[], o: CleanupOptions): MappedString {
  const parts = pages.map((p) => pageToMapped(p, o));
  const seps: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const prev = parts[i].text.replace(/\s+$/u, "");
    const next = parts[i + 1].text.replace(/^\s+/u, "");
    const continues = prev.length > 0 && !TERMINAL_END.test(prev) && (/^\p{Ll}/u.test(next) || /-$/.test(prev));
    seps.push(continues ? "\n" : "\n\n");
  }
  const joined = MappedString.concat(parts, seps);
  return joinLines(joined, o);
}

/** Stages C + D: skips (citations, URLs, emails), symbols, abbreviations, user rules. */
export function buildSpeech(display: MappedString, o: CleanupOptions, rules: CompiledRule[] = []): MappedString {
  let s = display;
  if (o.skipCitationsNumeric) s = s.deleteAll(RE.citeNumeric);
  if (o.skipCitationsAuthorYear) s = s.deleteAll(RE.citeAuthorYear);
  if (o.urls !== "read") {
    s = s.replaceAll(RE.url, (m) => (o.urls === "skip" ? "" : hostOf(m[0])));
    s = s.replaceAll(RE.doi, () => (o.urls === "skip" ? "" : "DOI link"));
  }
  if (o.skipEmails) s = s.deleteAll(RE.email);
  s = s.replaceAll(RE.ligature, (m) => m[0].normalize("NFKC"));
  s = s.replaceAll(RE.bullet, "$1");
  for (const [re, rep] of SYMBOLS) s = s.replaceAll(re, rep);
  if (o.expandAbbreviations) for (const [re, rep] of EXPANSIONS) s = s.replaceAll(re, rep);
  s = applyRules(s, rules);
  // Tidy spacing left behind by deletions: "word ." → "word.", double spaces, space before PARA.
  s = s.replaceAll(/ +(?=[.,;:!?)])/g, "");
  s = s.replaceAll(/\( *\)/g, "");
  s = s.replaceAll(/ {2,}/g, " ");
  s = s.replaceAll(/ ?\u2029 ?/g, PARA);
  return s;
}

function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}
