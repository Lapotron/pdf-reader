import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function openFixture(page: Page, name: string, query = "engine=mock&mockspeed=0.25") {
  await page.goto(`./?${query}#/`);
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

test("works offline after the first visit (PWA)", async ({ page, context }) => {
  await openFixture(page, "simple.pdf");
  // Wait for the service worker to take control.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Warm the runtime cache for pdf.js assets by rendering once more.
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
  await page.getByTestId("play-button").click();
  await expect(page.getByTestId("now-reading")).toHaveText("The quick brown fox jumps over the lazy dog.");
  await context.setOffline(false);
});

test("Back to reading position returns to the spoken line and stays", async ({ page }) => {
  await openFixture(page, "columns.pdf", "engine=mock&mockspeed=1.5");
  const view = page.getByTestId("document-view");
  const scrollTop = () => view.evaluate((el) => el.scrollTop);
  await page.getByTestId("play-button").click();
  await expect(page.getByTestId("player-bar")).toHaveAttribute("data-state", "playing");
  // Scroll away with the mouse wheel.
  await page.mouse.move(640, 400);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(30);
  }
  const back = page.getByTestId("back-to-reading");
  await expect(back).toBeVisible();
  const away = await scrollTop();
  expect(away).toBeGreaterThan(1500);
  // Reading continues, but the page is not pulled back.
  await page.waitForTimeout(5000);
  expect(await scrollTop()).toBe(away);
  // A real mouse click (Playwright hit-tests, so a covered button would fail here).
  await back.click();
  await page.waitForTimeout(1500);
  await expect(back).toBeHidden();
  const ruler = (await page.getByTestId("reading-ruler").boundingBox())!;
  const box = (await view.boundingBox())!;
  expect(ruler.y).toBeGreaterThanOrEqual(box.y);
  expect(ruler.y + ruler.height).toBeLessThanOrEqual(box.y + box.height);
  // It does not come straight back after the smooth scroll finishes.
  await page.waitForTimeout(1500);
  await expect(back).toBeHidden();
});

test("Settings section list stays in place while the content scrolls", async ({ page }) => {
  await openFixture(page, "simple.pdf");
  await page.getByTestId("open-settings").click();
  const nav = page.getByTestId("settings-nav");
  await nav.getByRole("button", { name: "Text cleanup" }).click();
  const before = (await nav.boundingBox())!;
  const content = page.getByTestId("settings-content");
  await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(await content.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  const after = (await nav.boundingBox())!;
  expect(after.y).toBe(before.y);
  await expect(nav.getByRole("button", { name: "Voice & engine" })).toBeInViewport();
  // Switching tabs starts at the top.
  await nav.getByRole("button", { name: "Reading line" }).click();
  expect(await page.getByTestId("settings-content").evaluate((el) => el.scrollTop)).toBe(0);
});

test("reader sidebar can be resized by dragging and keeps its width", async ({ page }) => {
  await openFixture(page, "simple.pdf");
  const sidebar = page.getByTestId("sidebar");
  const before = (await sidebar.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 4 });
  await page.mouse.move(h.x + h.width / 2 + 120, h.y + h.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = (await sidebar.boundingBox())!.width;
  expect(Math.abs(after - before - 120)).toBeLessThanOrEqual(3);
  // Pages are laid out again for the new width once the drag ends.
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
  expect(Math.abs((await page.getByTestId("sidebar").boundingBox())!.width - after)).toBeLessThanOrEqual(1);
  // Double-click resets to the default width.
  await page.getByRole("separator", { name: "Resize sidebar" }).dblclick();
  await expect.poll(async () => Math.round((await page.getByTestId("sidebar").boundingBox())!.width)).toBe(288);
});

test("voice preview shows its state and can be stopped", async ({ page }) => {
  await openFixture(page, "simple.pdf");
  await page.getByTestId("voice-button").click();
  const btn = page.getByRole("button", { name: /Tone B$/ });
  await btn.click();
  const active = page.getByRole("button", { name: "Stop preview of Tone B" });
  await expect(active).toHaveAttribute("data-phase", "playing");
  await active.click(); // stop
  await expect(page.getByRole("button", { name: "Preview Tone B" })).toHaveAttribute("data-phase", "idle");
  // Plays to the end on its own and returns to idle.
  await page.getByRole("button", { name: "Preview Tone B" }).click();
  await expect(page.getByRole("button", { name: "Stop preview of Tone B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview Tone B" })).toHaveAttribute("data-phase", "idle", { timeout: 15_000 });
});
