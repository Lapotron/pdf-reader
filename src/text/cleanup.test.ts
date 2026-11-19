import { describe, expect, it } from "vitest";
import { MappedString } from "./mappedString";
import { buildSpeech, DEFAULT_CLEANUP, joinLines, type CleanupOptions } from "./cleanup";
import { compileRule, compileRules, applyRules, type PronunciationRule } from "./pronunciation";

const opts = (o: Partial<CleanupOptions> = {}): CleanupOptions => ({ ...DEFAULT_CLEANUP, ...o });
const join = (s: string, o: Partial<CleanupOptions> = {}) => joinLines(MappedString.identity(s, 0), opts(o)).text;
const speech = (s: string, o: Partial<CleanupOptions> = {}) => buildSpeech(MappedString.identity(s, 0), opts(o)).text;

describe("joinLines", () => {
  it("de-hyphenates syllable splits", () => {
    expect(join("an experi-\nment here")).toBe("an experiment here");
  });
  it("keeps hyphens for capitalized continuations and known prefixes", () => {
    expect(join("Jean-\nPaul Sartre")).toBe("Jean-Paul Sartre");
    expect(join("a self-\naware agent")).toBe("a self-aware agent");
  });
  it("uses document vocabulary", () => {
    expect(join("state of the art and long-term plans; long-\nterm goals")).toBe("state of the art and long-term plans; long-term goals");
    expect(join("cooperate and co-\noperate")).toBe("cooperate and cooperate");
  });
  it("removes soft hyphens", () => {
    expect(join("infor­\nmation")).toBe("information");
  });
  it("turns blank lines into paragraph separators and lines into spaces", () => {
    expect(join("first line\nsecond line\n\nnew para")).toBe("first line second line\u2029new para");
  });
});

describe("buildSpeech", () => {
  it("skips numeric citations", () => {
    expect(speech("as shown [12]. Also [3, 4] and [5–7].")).toBe("as shown. Also and.");
  });
  it("skips author-year citations when enabled", () => {
    const s = "Prior work (Smith, 2020; Lee and Park 2019a) shows this (see Doe et al., 2018).";
    expect(speech(s, { skipCitationsAuthorYear: true })).toBe("Prior work shows this.");
    expect(speech(s)).toContain("(Smith, 2020;");
  });
  it("handles URLs per mode", () => {
    const s = "Visit https://www.example.org/a/b?c=1 now.";
    expect(speech(s, { urls: "domain" })).toBe("Visit example.org now.");
    expect(speech(s, { urls: "skip" })).toBe("Visit now.");
    expect(speech(s, { urls: "read" })).toBe(s);
  });
  it("expands abbreviations and symbols", () => {
    expect(speech("Use tools, e.g., hammers & saws (see Fig. 3).")).toBe("Use tools, for example, hammers and saws (see Figure 3).");
    expect(speech("Pages 10–12 cover it")).toBe("Pages 10 to 12 cover it");
    expect(speech("The ﬁrst result")).toBe("The first result");
  });
  it("keeps the sentence period when et al. ends a sentence", () => {
    expect(speech("Shown by Smith et al. The next")).toBe("Shown by Smith and colleagues. The next");
    expect(speech("Smith et al. showed")).toBe("Smith and colleagues showed");
  });
});

describe("pronunciation rules", () => {
  const rule = (p: Partial<PronunciationRule>): PronunciationRule => ({
    id: "r", pattern: "", replacement: "", regex: false, caseSensitive: false, wholeWord: true, enabled: true, scope: "global", ...p,
  });
  it("applies plain whole-word, case-insensitive rules", () => {
    const rules = compileRules([rule({ pattern: "SQL", replacement: "sequel" })]);
    const out = applyRules(MappedString.identity("SQL and sql but not SQLite", 0), rules);
    expect(out.text).toBe("sequel and sequel but not SQLite");
    expect(out.toSrcRange(0, 6)).toEqual([0, 3]);
  });
  it("supports regex with groups and scope ordering", () => {
    const rules = compileRules(
      [
        rule({ id: "d", pattern: "v(\\d+)", replacement: "version $1", regex: true, scope: "doc1" }),
        rule({ id: "g", pattern: "v2", replacement: "V-two", scope: "global" }),
      ],
      "doc1",
    );
    expect(rules.map((r) => r.id)).toEqual(["g", "d"]);
    expect(applyRules(MappedString.identity("v2 v3", 0), rules).text).toBe("V-two version 3");
  });
  it("rejects invalid patterns and treats $ literally in plain rules", () => {
    expect("error" in compileRule(rule({ pattern: "(", regex: true }))).toBe(true);
    const rules = compileRules([rule({ pattern: "USD", replacement: "$ dollars" })]);
    expect(applyRules(MappedString.identity("5 USD", 0), rules).text).toBe("5 $ dollars");
  });
});
