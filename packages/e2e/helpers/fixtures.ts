import { test as base, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { attachFailureEvidence, PlayerEvidence } from "./evidence";
import { runLeakScan } from "./leak-scan";
import { DuelWatch, stallMsFromEnv } from "./watch";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { authFile, type PlayerKey } from "./players";

export type Seat = { key: PlayerKey; context: BrowserContext; page: Page };

type Fixtures = {
  /**
   * Opens one isolated browser context per call, logged in as that test player. Closed after the test.
   * Every page of the context is recorded. When the test fails, the recording, the duel state and journal
   * and the stack log are attached (see helpers/evidence.ts). A passing test attaches nothing.
   */
  player: (key: PlayerKey) => Promise<Seat>;
  /**
   * How long an active duel may keep the same revision before the stall detector fails the test, in ms.
   * Default 20000, or `E2E_STALL_MS`. `test.use({ stallMs: 0 })` turns it off for a test that waits on purpose.
   */
  stallMs: number;
};

/**
 * Playwright applies `use.video` to its own `page` fixture only. A context opened here records nothing unless
 * it gets `recordVideo`, so the fixture records into the test output folder and keeps the files of a failed test.
 */
function videoPlan(testInfo: TestInfo): { record: boolean; keepOnPass: boolean } {
  const option = testInfo.project.use.video;
  const mode = typeof option === "string" ? option : option?.mode;
  const record = mode === "on" || mode === "retain-on-failure" || (mode === "on-first-retry" && testInfo.retry > 0);
  return { record, keepOnPass: mode === "on" };
}

export const test = base.extend<Fixtures>({
  stallMs: [stallMsFromEnv(), { option: true }],
  player: async ({ browser, stallMs }, use, testInfo) => {
    const opened: BrowserContext[] = [];
    const recorders: PlayerEvidence[] = [];
    const videos: Array<{ key: PlayerKey; dir: string }> = [];
    const startedAt = Date.now();
    const video = videoPlan(testInfo);
    const extras = { notes: [] as import("./timeline").TimelineEntry[], errors: [] as string[] };
    let collected = false;
    const watch: DuelWatch = new DuelWatch(testInfo, recorders, stallMs, async (report) => {
      // Write the evidence now, while the pages are alive. Closing the contexts then ends the test's pending waits.
      extras.errors.push(report.message);
      collected = true;
      await attachFailureEvidence(testInfo, recorders, { notes: watch.notes, errors: extras.errors }).catch((error) => console.warn("[e2e] could not collect stall evidence:", error));
      await Promise.all(opened.map((context) => context.close().catch(() => undefined)));
    });
    watch.start();
    await use(async (key) => {
      const dir = testInfo.outputPath(`video-${key}-${videos.length + 1}`);
      const context = await browser.newContext({ storageState: authFile(key), ...(video.record ? { recordVideo: { dir } } : {}) });
      if (video.record) videos.push({ key, dir });
      opened.push(context);
      recorders.push(new PlayerEvidence(key, context, startedAt));
      return { key, context, page: await context.newPage() };
    });
    await watch.stop();
    // The leak scan needs the contexts open (one last room read), so it does not run after a stall closed them.
    if (!collected) {
      const scan = await runLeakScan(testInfo, recorders).catch((error) => {
        console.warn("[e2e] leak scan failed to run:", error);
        return { errors: [] as string[], file: null };
      });
      extras.errors.push(...scan.errors);
    }
    const problems = [...extras.errors];
    const failed = testInfo.status !== testInfo.expectedStatus || problems.length > 0;
    // Collect before the contexts close: the room API needs the player's cookies.
    if ((failed || process.env.E2E_EVIDENCE === "always") && !collected) {
      await attachFailureEvidence(testInfo, recorders, { notes: watch.notes, errors: extras.errors }).catch((error) => console.warn("[e2e] could not collect failure evidence:", error));
    }
    await Promise.all(opened.map((context) => context.close().catch(() => undefined)));
    // The video files are complete only after the context closed.
    for (const { key, dir } of videos) {
      if (!existsSync(dir)) continue;
      if (failed || video.keepOnPass) {
        for (const [index, file] of readdirSync(dir).entries()) {
          await testInfo.attach(`video-${key}-${videos.length > 1 ? `${dir.split("-").at(-1)}-` : ""}${index + 1}`, { path: `${dir}/${file}`, contentType: "video/webm" });
        }
      } else {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    // A stall or a hidden card leak fails the test, also when every assertion of the test passed.
    if (problems.length > 0) throw new Error(problems.join("\n\n"));
  },
});

export { expect } from "@playwright/test";
