import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  grepInvert: process.env.RUN_SLOW ? undefined : /@slow/,
  use: {
    baseURL: `http://localhost:${PORT}/Mega/`,
    trace: "off",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `VITE_BASE=/Mega/ npm run build && npx vite preview --port ${PORT} --strictPort --base /Mega/`,
    url: `http://localhost:${PORT}/Mega/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
