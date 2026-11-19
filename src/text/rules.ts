/** Regexes and word lists used by the cleanup pipeline. */

const NAME = String.raw`[A-Z][\p{L}'’\-]+`;
const AUTHORS = String.raw`${NAME}(?:\s+(?:et\s+al\.?|(?:and|&)\s+${NAME}))?`;
const YEAR = String.raw`(?:1[5-9]|20)\d{2}[a-z]?`;
const CITE_ITEM = String.raw`(?:${AUTHORS},?\s+)?${YEAR}(?:,\s*(?:p|pp)\.\s*\d+(?:[–-]\d+)?)?`;

export const RE = {
  /** [12], [3, 4], [5–7], [1,2-4] (with an optional preceding space). */
  citeNumeric: /[  ]?\[\d{1,4}(?:\s*[,–\-]\s*\d{1,4})*\]/g,
  /** (Smith, 2020), (Smith and Lee 2019; Doe et al., 2018a), (see Smith, 2020) */
  citeAuthorYear: new RegExp(
    String.raw`[  ]?\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?${AUTHORS},?\s+${YEAR}(?:,\s*(?:p|pp)\.\s*\d+(?:[–-]\d+)?)?(?:\s*[;,]\s*${CITE_ITEM})*\)`,
    "gu",
  ),
  url: /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"'\u2029]+[^\s<>()[\]{}"'.,;:!?\u2029]/gi,
  doi: /\b(?:doi:\s*)10\.\d{4,9}\/[^\s\u2029]+[^\s.,;\u2029]/gi,
  email: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  ligature: /[ﬀ-ﬆ]/g,
  bullet: /(^|\u2029)\s*[•▪◦‣∙●○■□–-]\s+/g,
};

/** Hyphenated prefixes that keep their hyphen when split across lines. */
export const KEEP_HYPHEN_PREFIX = new Set([
  "self", "well", "non", "cross", "anti", "quasi", "pseudo", "half", "all", "ex", "ill",
  "high", "low", "long", "short", "state", "real", "multi", "semi", "co", "post", "pre",
]);

/** Abbreviations that do not end a sentence. Lowercase, without the trailing period. */
export const NON_TERMINAL_ABBR = new Set([
  "e.g", "i.e", "al", "fig", "figs", "eq", "eqs", "dr", "mr", "mrs", "ms", "prof", "vs", "no", "nos",
  "cf", "approx", "sec", "secs", "ch", "vol", "vols", "pp", "p", "ref", "refs", "st", "jr", "sr",
  "inc", "ltd", "co", "corp", "dept", "univ", "est", "min", "max", "resp", "viz", "ca", "op", "cit",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "tab", "app",
  "eqn", "thm", "lem", "def", "prop", "cor", "ex", "u.s", "u.k", "a.m", "p.m", "ph.d", "m.s", "b.s",
]);

/** Expansions applied to speech text when "expand abbreviations" is on. Order matters. */
export const EXPANSIONS: [RegExp, string][] = [
  [/\be\.\s?g\.(,?)/gi, "for example$1"],
  [/\bi\.\s?e\.(,?)/gi, "that is$1"],
  [/\bet al\.(?=\s+\p{Lu}|\s*\u2029|\s*$)/gu, "and colleagues."],
  [/\bet al\./g, "and colleagues"],
  [/\betc\.(?=\s+\p{Lu}|\s*\u2029|\s*$)/gu, "etcetera."],
  [/\betc\./g, "etcetera"],
  [/\bFigs\.(?=\s*\d)/g, "Figures"],
  [/\bFig\.(?=\s*\d)/g, "Figure"],
  [/\bEqs\.(?=\s*[(\d])/g, "Equations"],
  [/\bEqn?\.(?=\s*[(\d])/g, "Equation"],
  [/\bSecs?\.(?=\s*\d)/g, "Section"],
  [/\bCh\.(?=\s*\d)/g, "Chapter"],
  [/\bTab\.(?=\s*\d)/g, "Table"],
  [/\bRefs?\.(?=\s*[[\d])/g, "Reference"],
  [/\bNo\.(?=\s*\d)/g, "Number"],
  [/\bVol\.(?=\s*\d)/g, "Volume"],
  [/\bpp\.(?=\s*\d)/g, "pages"],
  [/\bp\.(?=\s*\d)/g, "page"],
  [/\bvs\.?(?=\s)/g, "versus"],
  [/\bapprox\./g, "approximately"],
  [/\bcf\./g, "compare"],
  [/\bviz\./g, "namely"],
  [/\bProf\.(?=\s+\p{Lu})/gu, "Professor"],
  [/\bDr\.(?=\s+\p{Lu})/gu, "Doctor"],
  [/\bMr\.(?=\s+\p{Lu})/gu, "Mister"],
  [/\bMrs\.(?=\s+\p{Lu})/gu, "Missus"],
  [/\bMs\.(?=\s+\p{Lu})/gu, "Miz"],
];

/** Symbol normalization for speech (always on). */
export const SYMBOLS: [RegExp, string][] = [
  [/\s*&\s*/g, " and "],
  [/(\d)\s*[–—]\s*(\d)/g, "$1 to $2"],
  [/\s*—\s*/g, ", "],
  [/\s+–\s+/g, ", "],
  [/…/g, "..."],
  [/[“”„]/g, '"'],
  [/[‘’‚]/g, "'"],
  [/[​-‍﻿]/g, ""],
];
