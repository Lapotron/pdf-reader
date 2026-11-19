// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { setMeasurer } from "../pdf/charBoxes";
import { loadPageText } from "../pdf/pageText";
import { applyRoles, bodyFontSize, learnHeaderFooter } from "../pdf/roles";
import { pageOf, srcPos, type PageText } from "../pdf/types";
import { DEFAULT_CLEANUP } from "./cleanup";
import { ReadingModel, type PageTextProvider } from "./readingModel";

async function provider(name: string): Promise<PageTextProvider> {
  const data = new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures", name)));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push(await loadPageText(await doc.getPage(p), { columnDetection: "auto" }));
  const hf = learnHeaderFooter(pages);
  const fs = bodyFontSize(pages);
  pages.forEach((pt) => applyRoles(pt, hf, fs));
  return {
    numPages: pages.length,
    getPageText: async (p) => pages[p - 1],
    peekPageText: (p) => pages[p - 1],
  };
}

describe("ReadingModel", () => {
  let model: ReadingModel;
  beforeAll(async () => {
    setMeasurer(null);
    model = new ReadingModel(await provider("columns.pdf"), DEFAULT_CLEANUP);
  });

  it("walks sentences across pages", async () => {
    let s = await model.firstSentenceFrom(1);
    const texts: string[] = [];
    while (s) {
      texts.push(s.text);
      s = await model.next(s);
    }
    expect(texts[0]).toBe("A Study of Reading Aloud");
    expect(texts).toContain("The left column starts here and continues for a few lines until it reaches its end.");
    expect(texts.join(" ")).not.toContain("Journal");
    expect(texts[texts.length - 1]).toBe("Figure 1: Preference by voice type."); // captions are read by default
    // prev from the first sentence of page 2 goes back to page 1
    const p2 = (await model.sentencesOfPage(2))[0];
    const back = await model.prev(p2);
    expect(back && pageOf(back.srcStart)).toBe(1);
  });

  it("returns two rects for a word split across lines", async () => {
    const ss = await model.sentencesOfPage(1);
    const s = ss.find((x) => x.text.startsWith("Reading aloud"))!;
    const w = s.words.find((x) => s.text.slice(x.start, x.end) === "experiments")!;
    const rects = model.rectsFor(w.srcStart, w.srcEnd);
    expect(rects).toHaveLength(2);
    expect(rects[1].rect.y).toBeGreaterThan(rects[0].rect.y);
  });

  it("hit-tests a point to the sentence and word under it", async () => {
    const pt = await model.page(2);
    const line = pt.lines.find((l) => l.text.startsWith("the left one"))!;
    const pos = model.hitTest(2, line.rect.x + 2, line.rect.y + line.rect.h / 2)!;
    const hit = await model.sentenceAt(pos);
    expect(hit?.sentence.text.startsWith("The right column begins")).toBe(true);
    expect(hit?.sentence.text.slice(hit.sentence.words[hit.wordIdx].start, hit.sentence.words[hit.wordIdx].end)).toBe("the");
  });

  it("resolves clicks on removed text to the next spoken sentence", async () => {
    const pt = await model.page(3);
    const header = pt.lines.find((l) => l.role === "header")!;
    const hit = await model.sentenceAt(srcPos(3, header.srcStart));
    expect(hit?.sentence.text).toBe("The final page summarizes the results of the study.");
  });

  it("finds the line for the reading ruler", async () => {
    const ss = await model.sentencesOfPage(2);
    const right = ss.find((s) => s.text.startsWith("The right column"))!;
    const ln = model.lineAt(right.srcStart)!;
    expect(ln.line.text).toBe("The right column begins after");
    expect(ln.line.rect.x).toBeGreaterThan(300);
  });
});
