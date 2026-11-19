// Generates small, deterministic PDF fixtures for unit/integration/e2e tests.
// Run: npm run fixtures  (outputs are committed under e2e/fixtures)
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "e2e", "fixtures");
mkdirSync(outDir, { recursive: true });

const W = 612, H = 792;
const fixedDate = new Date("2026-01-01T00:00:00Z");

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Mega Reader tests");
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  doc.setProducer("pdf-lib");
  doc.setCreator("make-fixtures");
  return doc;
}

function lines(page, font, size, x, yTop, leading, textLines) {
  let y = yTop;
  for (const t of textLines) {
    page.drawText(t, { x, y, size, font, color: rgb(0, 0, 0) });
    y -= leading;
  }
  return y;
}

async function simple() {
  const doc = await newDoc("Simple fixture");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  lines(page, font, 14, 72, 700, 20, [
    "The quick brown fox jumps over the lazy dog. This is the",
    "second sentence. And here is the third one.",
  ]);
  writeFileSync(join(outDir, "simple.pdf"), await doc.save({ useObjectStreams: false }));
}

async function columns() {
  const doc = await newDoc("Columns fixture");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const header = (page, n) => {
    page.drawText("Journal of Testing", { x: 72, y: 750, size: 9, font });
    page.drawText(String(n), { x: W / 2 - 3, y: 40, size: 9, font });
  };

  // Page 1: single column, hyphenation across lines, numeric citation, URL, superscript marker.
  const p1 = doc.addPage([W, H]);
  header(p1, 1);
  p1.drawText("A Study of Reading Aloud", { x: 72, y: 690, size: 20, font: bold });
  lines(p1, font, 12, 72, 650, 16, [
    "Reading aloud improves comprehension in many experi-",
    "ments reported in the literature [12]. Listeners retain",
    "more detail when the voice sounds natural. See the",
    "project page at https://example.com/paper for data.",
  ]);
  p1.drawText("Further work measured reading speed.", { x: 72, y: 586, size: 12, font });
  p1.drawText("1", { x: 72 + font.widthOfTextAtSize("Further work measured reading speed.", 12) + 1, y: 591, size: 7, font });

  // Page 2: two columns drawn interleaved, so stream order != reading order.
  const p2 = doc.addPage([W, H]);
  header(p2, 2);
  const left = [
    "The left column starts here",
    "and continues for a few lines",
    "until it reaches its end.",
  ];
  const right = [
    "The right column begins after",
    "the left one is finished and",
    "closes the second page.",
  ];
  let y = 690;
  for (let i = 0; i < left.length; i++) {
    p2.drawText(left[i], { x: 72, y, size: 11, font });
    p2.drawText(right[i], { x: 330, y, size: 11, font });
    y -= 15;
  }

  // Page 3: body, a figure caption, and a footnote in a smaller font.
  const p3 = doc.addPage([W, H]);
  header(p3, 3);
  lines(p3, font, 12, 72, 690, 16, [
    "The final page summarizes the results of the study.",
    "Natural voices were preferred by most participants.",
  ]);
  p3.drawText("Figure 1: Preference by voice type.", { x: 72, y: 600, size: 10, font });
  p3.drawText("1 Speed was measured in words per minute.", { x: 72, y: 80, size: 8, font });

  writeFileSync(join(outDir, "columns.pdf"), await doc.save({ useObjectStreams: false }));
}

/** Word-wraps text to a max width. */
function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxWidth && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** The sample document offered on first run (public/sample.pdf). */
async function sample() {
  const doc = await newDoc("Welcome to Mega Reader");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const margin = 72;
  const width = W - 2 * margin;
  const pages = [
    {
      title: "Welcome to Mega Reader",
      subtitle: "A PDF reader that reads to you, naturally.",
      sections: [
        ["Listening, not just reading", "Press the play button at the bottom of the screen, or double-click any sentence, and a natural neural voice starts reading from that exact word. The current sentence is highlighted, the spoken word is marked, and the page scrolls with the voice so you never lose your place."],
        ["The floating reading line", "A soft band glides to the line being read. Turn on the focus mask with the M key to dim everything else on the page, which helps when your attention drifts. When playback is paused, move your mouse or use the arrow keys and the line follows you, like a ruler held under the text."],
        ["Voices that sound human", "The default voices run entirely on your device using the Kokoro model, so your documents never leave your computer. The first time you press play, the model downloads once and is cached for offline use. If you prefer, you can connect OpenAI, ElevenLabs or Azure with your own API key for even more voices."],
      ],
    },
    {
      title: "Smart text cleanup",
      subtitle: "Hear the content, skip the clutter.",
      sections: [
        ["Less noise", "Running headers, footers and page numbers are detected automatically and skipped. Words that are hyphen- ated across lines are joined back together. Numeric citations such as [12] can be skipped, and long web links are shortened to their domain, like example.com."],
        ["Your pronunciation", "Open Settings and choose Pronunciation to teach the reader how to say names, acronyms and jargon. For example, you can make SQL sound like sequel. Rules can apply to every document or only to the one you are reading."],
        ["Keep what matters", "Select any text to highlight it in one of five colors or attach a note. Bookmarks, highlights and your reading position are saved locally, and you can export a page range or a whole chapter as an MP3 file to listen to later."],
      ],
    },
  ];
  pages.forEach((pg, i) => {
    const page = doc.addPage([W, H]);
    page.drawText("Mega Reader · Getting started", { x: margin, y: H - 40, size: 9, font: sans, color: rgb(0.45, 0.45, 0.45) });
    page.drawText(String(i + 1), { x: W / 2 - 3, y: 36, size: 9, font: sans, color: rgb(0.45, 0.45, 0.45) });
    let y = H - 110;
    page.drawText(pg.title, { x: margin, y, size: 26, font: bold, color: rgb(0.1, 0.12, 0.18) });
    y -= 30;
    page.drawText(pg.subtitle, { x: margin, y, size: 14, font: sans, color: rgb(0.35, 0.38, 0.45) });
    y -= 40;
    for (const [h, body] of pg.sections) {
      page.drawText(h, { x: margin, y, size: 14, font: bold, color: rgb(0.15, 0.25, 0.55) });
      y -= 22;
      for (const line of wrap(body, font, 12.5, width)) {
        page.drawText(line, { x: margin, y, size: 12.5, font, color: rgb(0.1, 0.1, 0.1) });
        y -= 18;
      }
      y -= 16;
    }
  });
  const publicDir = join(outDir, "..", "..", "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "sample.pdf"), await doc.save({ useObjectStreams: false }));
}

await simple();
await columns();
await sample();
console.log("[make-fixtures] wrote e2e/fixtures/simple.pdf, columns.pdf and public/sample.pdf");
