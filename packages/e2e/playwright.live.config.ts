import { defineConfig } from "@playwright/test";

// This signs in to the real site. Reject even an explicit invocation from CI.
if (process.env.CI) throw new Error("Live Discord login is local-only and must never run in CI.");

export default defineConfig({
  testDir: "./live",
  testMatch: "*.live.ts",
  outputDir: "test-results/live-login",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/live-login" }],
  ],
  use: {
    headless: false,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
