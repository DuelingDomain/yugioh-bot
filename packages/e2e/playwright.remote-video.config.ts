import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
process.env.E2E_AUTH_SECRET ??= randomBytes(24).toString("hex");
export default defineConfig({
  testDir: "./tests", testMatch: "remote-video.spec.ts", workers: 1,
  timeout: 120_000, expect: { timeout: 20_000 }, reporter: "list",
  outputDir: ".stack-remote-video/results",
  use: {
    ...devices["Desktop Chrome"], baseURL: "http://localhost:3310",
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
    actionTimeout: 20_000, screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: {
    command: "node stack/remote-video.mjs", url: "http://localhost:3310/api/auth/session",
    timeout: 120_000, reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
