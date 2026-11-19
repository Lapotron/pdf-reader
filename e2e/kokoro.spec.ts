import { expect, test } from "@playwright/test";

// Downloads the real Kokoro model (~90 MB) from Hugging Face and synthesizes speech on the CPU.
// Excluded by default; run with: RUN_SLOW=1 npm run test:e2e -- --grep @slow
test("reads the sample with real Kokoro voices @slow", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("./#/");
  await page.getByTestId("open-sample").click();
  await expect(page.locator('[data-testid="pdf-page"][data-rendered="1"]').first()).toBeVisible();
  await page.getByTestId("play-button").click();
  await expect(page.getByTestId("player-bar")).toHaveAttribute("data-state", "playing", { timeout: 240_000 });
  await expect(page.getByTestId("engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("now-reading")).toHaveText("Welcome to Mega Reader");
  await expect(page.getByTestId("word-hl")).toBeVisible();
});
