import { describe, expect, it } from "vitest";
import { MappedString } from "./mappedString";
import { chunkSentence, splitSentences } from "./segment";

const split = (s: string) => splitSentences(MappedString.identity(s, 0)).map((x) => x.text);

describe("splitSentences", () => {
  it("splits plain sentences", () => {
    expect(split("One two. Three four! Five six?")).toEqual(["One two.", "Three four!", "Five six?"]);
  });
  it("does not split after common abbreviations and initials", () => {
    expect(split("As shown in Fig. 3 the effect holds. Next one.")).toEqual(["As shown in Fig. 3 the effect holds.", "Next one."]);
    expect(split("Smith et al. reported it. Then more.")).toEqual(["Smith et al. reported it.", "Then more."]);
    expect(split("Written by J. R. R. Tolkien in 1937. Yes.")).toEqual(["Written by J. R. R. Tolkien in 1937.", "Yes."]);
    expect(split("Use e.g. hammers. Done.")).toEqual(["Use e.g. hammers.", "Done."]);
  });
  it("keeps decimals and always breaks at paragraph separators", () => {
    expect(split("Pi is 3.14 roughly. Ok")).toEqual(["Pi is 3.14 roughly.", "Ok"]);
    expect(split("Heading\u2029Body text here.")).toEqual(["Heading", "Body text here."]);
  });
  it("records paragraph pauses, words and source ranges", () => {
    const ss = splitSentences(MappedString.identity("Hi there.\u2029New para.", 0));
    expect(ss[0].pauseAfter).toBe("paragraph");
    expect(ss[0].words.map((w) => ss[0].text.slice(w.start, w.end))).toEqual(["Hi", "there"]);
    expect(ss[1].srcStart).toBe(10);
  });
  it("drops punctuation-only fragments", () => {
    expect(split("Real text. • ")).toEqual(["Real text."]);
  });
});

describe("chunkSentence", () => {
  it("never exceeds maxChars and prefers clause boundaries", () => {
    const s = "This is a long sentence, with several clauses; it keeps going and going, and it should be split nicely without breaking words apart at all.";
    const chunks = chunkSentence(s, 50);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(50);
    expect(chunks.map((c) => c.text).join(" ")).toBe(s);
    expect(chunks[0].text.endsWith(",") || chunks[0].text.endsWith(";")).toBe(true);
    for (const c of chunks) expect(s.slice(c.start, c.end)).toBe(c.text);
  });
  it("returns the whole sentence when short", () => {
    expect(chunkSentence("Short one.", 350)).toEqual([{ text: "Short one.", start: 0, end: 10 }]);
  });
});
