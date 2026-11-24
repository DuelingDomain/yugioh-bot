import { defineConfig, devices } from "@playwright/test";
import { e2eSlot, ensureSecrets, jsonReportFile, resultsDir, webUrl } from "./stack/env.mjs";

// Local only: marketing screenshots of the seeded e2e stack (see screenshots/README.md and scripts/site-screenshots.sh).
// It reuses the isolated stack of the normal e2e config, so it never touches the live services.
if (process.env.NODE_ENV === "production") throw new Error("The screenshot run is for local test stacks only.");
ensureSecrets();

export default defineConfig({
  testMatch: [/tests\/auth\.setup\.ts/, /screenshots\/.*\.spec\.ts/],
  outputDir: resultsDir,
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: jsonReportFile }]],
  use: {
    baseURL: webUrl,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    // The DOM effect path, like the main e2e config: it renders the same board without WebGL in headless Chromium.
    reducedMotion: "reduce",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /screenshots\/.*\.spec\.ts/,
      dependencies: ["setup"],
      // 1920x1080 at 2x: the shots are taken at 3840x2160 and scaled down to 1920x1080 for crisp text and art.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: "node stack/start.mjs",
    url: `${webUrl}/api/auth/session`,
    reuseExistingServer: false,
    timeout: e2eSlot === undefined ? 120_000 : 15 * 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "" },
  },
});
