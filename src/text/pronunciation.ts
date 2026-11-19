import type { MappedString } from "./mappedString";

export interface PronunciationRule {
  id: string;
  pattern: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  enabled: boolean;
  /** 'global' or a document id. */
  scope: string;
}

export interface CompiledRule {
  id: string;
  re: RegExp;
  replacement: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compiles a rule; returns an error message instead when the pattern is invalid. */
export function compileRule(r: PronunciationRule): CompiledRule | { error: string } {
  if (!r.pattern) return { error: "Empty pattern" };
  let src = r.regex ? r.pattern : escapeRe(r.pattern);
  if (r.wholeWord) {
    // Unicode-aware word boundaries.
    src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  }
  try {
    const re = new RegExp(src, "gu" + (r.caseSensitive ? "" : "i"));
    if (re.test("")) return { error: "Pattern matches empty text" };
    re.lastIndex = 0;
    return { id: r.id, re, replacement: r.regex ? r.replacement : r.replacement.replace(/\$/g, "$$$$") };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Global rules first, then document rules, each in list order. Invalid/disabled rules are skipped. */
export function compileRules(rules: PronunciationRule[], docId?: string): CompiledRule[] {
  const active = rules.filter((r) => r.enabled && (r.scope === "global" || r.scope === docId));
  active.sort((a, b) => (a.scope === "global" ? 0 : 1) - (b.scope === "global" ? 0 : 1));
  const out: CompiledRule[] = [];
  for (const r of active) {
    const c = compileRule(r);
    if (!("error" in c)) out.push(c);
  }
  return out;
}

export function applyRules(ms: MappedString, rules: CompiledRule[]): MappedString {
  let cur = ms;
  for (const r of rules) cur = cur.replaceAll(r.re, r.replacement);
  return cur;
}
