import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
process.env.E2E_AUTH_SECRET ??= randomBytes(24).toString("hex");
export default defineConfig({
  testDir: "./tests", testMatch: "remote-ui.spec.ts", workers: 1,
  timeout: 120_000, expect: { timeout: 20_000 }, reporter: "list",
  outputDir: ".stack-remote-ui/results",
  use: {
    ...devices["Desktop Chrome"], baseURL: "http://localhost:3310", viewport: { width: 1920, height: 1080 },
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", ...(process.env.E2E_FAKE_VIDEO ? [`--use-file-for-fake-video-capture=${process.env.E2E_FAKE_VIDEO}`] : [])] },
    actionTimeout: 20_000, screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: {
    command: "node stack/remote-ui.mjs", url: "http://localhost:3310/api/auth/session",
    timeout: process.env.E2E_PROD === "1" ? 900_000 : 120_000, reuseExistingServer: !!process.env.E2E_REUSE,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
