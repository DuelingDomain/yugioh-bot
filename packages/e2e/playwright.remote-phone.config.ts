import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
process.env.E2E_AUTH_SECRET ??= randomBytes(24).toString("hex");
export default defineConfig({
  testDir: "./tests", testMatch: "remote-phone.spec.ts", workers: 1,
  timeout: 180_000, expect: { timeout: 25_000 }, reporter: "list",
  outputDir: ".stack-remote-phone/results",
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3436", viewport: { width: 1440, height: 1000 },
    permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
    actionTimeout: 25_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node stack/remote-phone.mjs", url: "http://localhost:3436/api/auth/session", timeout: 180_000,
    reuseExistingServer: false, gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 } },
});
