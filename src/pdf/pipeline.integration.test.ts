// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { setMeasurer } from "./charBoxes";
import { loadPageText } from "./pageText";
import { applyRoles, bodyFontSize, learnHeaderFooter } from "./roles";
import type { PageText } from "./types";
import { buildDisplay, buildSpeech, DEFAULT_CLEANUP } from "../text/cleanup";
import { splitSentences } from "../text/segment";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures", name)));

async function loadAll(name: string): Promise<PageText[]> {
  const doc = await getDocument({ data: fixture(name), verbosity: 0 }).promise;
  const pages: PageText[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push(await loadPageText(await doc.getPage(p), { columnDetection: "auto" }));
  const hf = learnHeaderFooter(pages);
  const fs = bodyFontSize(pages);
  for (const pt of pages) applyRoles(pt, hf, fs);
  return pages;
}

describe("PDF text pipeline (columns.pdf)", () => {
  let pages: PageText[];
  beforeAll(async () => {
    setMeasurer(null);
    pages = await loadAll("columns.pdf");
  });

  it("detects running header and page numbers", () => {
    for (const pt of pages) {
      const header = pt.lines.find((l) => l.text.includes("Journal of Testing"));
      expect(header?.role).toBe("header");
      const num = pt.lines.find((l) => l.text.trim() === String(pt.page));
      expect(num?.role).toBe("pageNum");
    }
  });

  it("orders two interleaved columns left then right", () => {
    const src = pages[1].source;
    const left = src.indexOf("until it reaches its end.");
    const right = src.indexOf("The right column begins after");
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(left);
    expect(src.indexOf("and continues for a few lines")).toBeLessThan(left);
  });

  it("detects the superscript footnote marker, footnote and caption", () => {
    const sup = pages[0].items.find((it) => it.sup);
    expect(sup?.str).toBe("1");
    const foot = pages[2].lines.find((l) => l.text.startsWith("1 Speed"));
    expect(foot?.role).toBe("footnote");
    const cap = pages[2].lines.find((l) => l.text.startsWith("Figure 1"));
    expect(cap?.role).toBe("caption");
  });

  it("builds clean speech text", () => {
    const display = buildDisplay(pages, DEFAULT_CLEANUP);
    expect(display.text).not.toContain("Journal of Testing");
    expect(display.text).toContain("experiments reported");
    expect(display.text).not.toContain("Speed was measured");
    const speech = buildSpeech(display, DEFAULT_CLEANUP);
    expect(speech.text).not.toContain("[12]");
    expect(speech.text).toContain("literature. Listeners");
    expect(speech.text).toContain("project page at example.com for data.");
    expect(speech.text).toContain("reading speed.\u2029The left column");
    const sentences = splitSentences(speech);
    const texts = sentences.map((s) => s.text);
    expect(texts).toContain("Reading aloud improves comprehension in many experiments reported in the literature.");
    expect(texts[0]).toBe("A Study of Reading Aloud");
    // A word that was de-hyphenated maps back to source chars on two lines.
    const s = sentences.find((x) => x.text.startsWith("Reading aloud"))!;
    const w = s.words.find((x) => s.text.slice(x.start, x.end) === "experiments")!;
    const p1 = pages[0];
    const local = (pos: number) => pos - 1 * (1 << 22);
    expect(p1.source.slice(local(w.srcStart), local(w.srcEnd))).toBe("experi-\nments");
  });
});
