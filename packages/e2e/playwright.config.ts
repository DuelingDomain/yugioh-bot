import { defineConfig, devices } from "@playwright/test";
import { ensureSecrets, webUrl } from "./stack/env.mjs";

// Fresh throwaway secrets for this run. Workers and the stack inherit them from this process.
ensureSecrets();

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  // One duel table per test, unique names: tests do not share state, so they can run in parallel.
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "../../.status/e2e-results.json" }],
    // Must stay after the json reporter: it reads that file. Writes test-results/index.md.
    ["./tools/index-reporter.mjs"],
  ],
  // Sharding: `playwright test --shard=1/3`. Each shard starts its own stack; run shards on separate machines.
  use: {
    baseURL: webUrl,
    // CI retries once: the trace of the retry is kept, and of a last failed attempt. Locally there is no retry, so keep the trace of a failure.
    trace: ci ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The duel room draws summon and battle effects with WebGL. Headless Chromium renders them in software,
    // and with several browsers on one machine the page thread starves: clicks then hang without a cause in the app.
    // Reduced motion selects the DOM effect path, which is the path players with that setting get.
    reducedMotion: "reduce",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  // One supervised stack: ws + duel host + web. It stops when Playwright stops.
  webServer: {
    command: "node stack/start.mjs",
    url: `${webUrl}/login`,
    // Never reuse: a stale stack would hold old secrets and a stale database.
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 8_000 },
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "" },
  },
});
