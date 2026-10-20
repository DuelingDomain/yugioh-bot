import { createReplayFixture } from "../helpers/replay";
import { test, expect } from "@playwright/test";
import { authFile } from "../helpers/players";
import { stackDir } from "../stack/env.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Opt in: generates real, deterministic engine journals in this slot's SQLite file.
test("measure long and multi-seat replay open", async ({ browser }, testInfo) => {
  test.skip(process.env.E2E_REPLAY_PERF !== "1", "Opt-in replay performance experiment");
  test.setTimeout(240_000);
  const fixtures = [];
  for (const format of (["1v1", "ffa3", "tag"] as const).filter(format => !process.env.E2E_REPLAY_FORMAT || process.env.E2E_REPLAY_FORMAT === format)) fixtures.push(await createReplayFixture(format, format === "1v1" ? 240 : 120));
  const context = await browser.newContext({ storageState: authFile("p1"), reducedMotion: "reduce" });
  const viewer = { context };
  const rows: any[] = [];
  for (const fixture of fixtures) {
    for (const run of ["cold", "cached"]) {
      const page = await viewer.context.newPage();
      const cdp = await viewer.context.newCDPSession(page);
      if (process.env.E2E_REPLAY_CPU === "1") { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      if (process.env.E2E_REPLAY_MBIT) {
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 20,
          downloadThroughput: Number(process.env.E2E_REPLAY_MBIT) * 125_000, uploadThroughput: 1_250_000 });
      }
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('[role="group"][aria-label="Replay controls"]')) {
            (window as any).__replayDomMs = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => { (window as any).__replayPaintMs = performance.now(); }));
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      const responsePromise = page.waitForResponse(response => response.url().includes(`/duels/${fixture.slug}/replay?`));
      const at = performance.now();
      await page.goto(`/duels/${fixture.slug}/replay`);
      const response = await responsePromise;
      const contentEncoding = response.headers()["content-encoding"];
      const bodyPromise = response.json();
      await expect(page.getByRole("group", { name: "Replay controls" })).toBeVisible({ timeout: 60_000 });
      if (process.env.E2E_REPLAY_CPU === "1") {
        const { profile } = await cdp.send("Profiler.stop");
        writeFileSync(join(stackDir, `replay-cpu-${fixture.format}-${run}.json`), JSON.stringify(profile));
      }
      const elapsedMs = performance.now() - at;
      const boardMs = await page.evaluate(() => (window as any).__replayDomMs);
      const paintMs = await page.evaluate(() => (window as any).__replayPaintMs);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry: any) => ({ name: entry.name, startTime: entry.startTime, responseStart: entry.responseStart, responseEnd: entry.responseEnd, duration: entry.duration, bytes: entry.encodedBodySize, decoded: entry.decodedBodySize })));
      const api = resources.find(entry => entry.name.includes(`/duels/${fixture.slug}/replay?`));
      const js = resources.filter(entry => entry.name.includes("/_next/") && entry.name.includes(".js"));
      const geometry = await page.locator("[data-field-cracks]").evaluateAll(nodes => nodes.map(node => ({ stage: node.getAttribute("data-stage"), style: node.getAttribute("style") })));
      const body = await bodyPromise;
      const text = JSON.stringify(body);
      expect(body.verification, JSON.stringify(body.replayError)).toBe("verified");
      expect(body.frames.length).toBeGreaterThan(50);
      if (process.env.E2E_REPLAY_EXPECT_GZIP === "1") {
        expect(contentEncoding).toBe("gzip");
        expect(geometry.length).toBeGreaterThan(0);
        expect(geometry.every(layer => layer.stage === "0" && layer.style === null)).toBe(true);
        expect(api!.bytes).toBeLessThan(Buffer.byteLength(text) / 10);
      }
      rows.push({ ...fixture, run, boardMs, paintMs, elapsedMs, geometry, contentEncoding, api, jsBytes: js.reduce((sum, entry) => sum + entry.bytes, 0), jsEndMs: Math.max(...js.map(entry => entry.responseEnd)), frames: body.frames.length, payloadBytes: Buffer.byteLength(text), gzipBytes: gzipSync(text).length });
      await page.close();
    }
  }
  await context.close();
  writeFileSync(join(stackDir, `replay-${process.env.E2E_REPLAY_LABEL ?? "timings"}-${testInfo.repeatEachIndex}.json`), JSON.stringify(rows, null, 2));
  console.log("REPLAY_BROWSER_TIMINGS", JSON.stringify(rows));
  await testInfo.attach("replay-timings", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
});
