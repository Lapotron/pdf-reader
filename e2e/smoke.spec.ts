import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function openFixture(page: Page, name: string) {
  await page.goto("./?engine=mock&mockspeed=0.25#/");
  await page.getByTestId("file-input").setInputFiles(fixture(name));
  await expect(page).toHaveURL(/#\/doc\/[0-9a-f]{64}/);
  await expect(page.getByTestId("pdf-page").first()).toBeVisible();
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
}

test.describe("Mega Reader", () => {
  test("opens a PDF from the library and renders pages", async ({ page }) => {
    await openFixture(page, "columns.pdf");
    await expect(page.getByTestId("page-count")).toHaveText("/ 3");
    // The canvas contains non-white pixels.
    const nonWhite = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-page="1"] canvas');
      if (!c) return 0;
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] < 200) n++;
      return n;
    });
    expect(nonWhite).toBeGreaterThan(50);
    // Library lists the document after going back.
    await page.goto("./?engine=mock#/");
    await expect(page.getByTestId("library-item")).toHaveCount(1);
  });

  test("reads aloud with sentence highlight, reading line, and skips headers", async ({ page }) => {
    await openFixture(page, "columns.pdf");
    await page.getByTestId("play-button").click();
    await expect(page.getByTestId("player-bar")).toHaveAttribute("data-state", "playing");
    await expect(page.getByTestId("now-reading")).toHaveText("A Study of Reading Aloud");
    await expect(page.getByTestId("sentence-hl").first()).toBeVisible();
    await expect(page.getByTestId("reading-ruler")).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("reading-ruler")).toHaveAttribute("data-page", "1");

    // Next sentence via the button.
    await page.getByTestId("next-button").click();
    await expect(page.getByTestId("now-reading")).toHaveText(/^Reading aloud improves comprehension in many experiments reported in the literature\.$/);

    // Collect spoken sentences while it plays through; the running header is never spoken.
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      seen.add((await page.getByTestId("now-reading").textContent()) ?? "");
      if ((await page.getByTestId("player-bar").getAttribute("data-state")) === "idle") break;
      await page.waitForTimeout(150);
    }
    const all = [...seen].join(" | ");
    expect(all).not.toContain("Journal of Testing");
    expect(all).toContain("The right column begins after the left one is finished and closes the second page.");
  });

  test("double-click starts reading at the clicked word", async ({ page }) => {
    await openFixture(page, "columns.pdf");
    await page.getByTestId("page-input").fill("2");
    await page.getByTestId("page-input").press("Enter");
    const span = page.locator('[data-page="2"] .textLayer span', { hasText: "The right column begins after" });
    await expect(span).toBeVisible();
    const box = (await span.boundingBox())!;
    await page.mouse.dblclick(box.x + 8, box.y + box.height / 2);
    await expect(page.getByTestId("now-reading")).toHaveText("The right column begins after the left one is finished and closes the second page.");
    await expect(page.getByTestId("reading-ruler")).toHaveAttribute("data-page", "2");
  });

  test("highlights persist and reading position resumes after reload", async ({ page }) => {
    await openFixture(page, "simple.pdf");
    await page.getByTestId("play-button").click();
    await expect(page.getByTestId("now-reading")).toHaveText("The quick brown fox jumps over the lazy dog.");
    await page.getByTestId("next-button").click();
    await expect(page.getByTestId("now-reading")).toHaveText("This is the second sentence.");
    await page.getByTestId("play-button").click(); // pause
    // Select a word in the text layer and highlight it.
    const span = page.locator('[data-page="1"] .textLayer span').first();
    await span.scrollIntoViewIfNeeded();
    const b = (await span.boundingBox())!;
    await page.mouse.move(b.x + 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("selection-menu")).toBeVisible();
    await page.getByRole("button", { name: /^Highlight #/ }).first().click();
    await expect(page.getByTestId("annotation-hl").first()).toBeVisible();
    await page.waitForTimeout(1800); // position save is debounced
    await page.reload();
    await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
    await expect(page.getByTestId("annotation-hl").first()).toBeVisible();
    await expect(page.getByTestId("now-reading")).toHaveText("This is the second sentence.");
  });

  test("exports the current page as WAV", async ({ page }) => {
    await openFixture(page, "simple.pdf");
    await page.getByTestId("export-button").click();
    await page.getByRole("radio", { name: "WAV (lossless)" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-run").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.wav$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.subarray(0, 4).toString()).toBe("RIFF");
    expect(buf.length).toBeGreaterThan(10_000);
  });
});
