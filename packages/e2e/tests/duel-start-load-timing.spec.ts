import { test, expect } from "../helpers/fixtures";
import { createTable, importDeckAndReady, addBotToSeat, uniqueTableName } from "../helpers/duel";
import { recordOpeningTiming } from "../helpers/opening-timing";

// Opt-in real-core measurement. Serial starts keep these four cases apart.
test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: process.env.E2E_OPENING_FULL_MOTION === "1" ? "no-preference" : "reduce" });
for (const [format, key, seats] of [["ffa4", "p1", 4], ["ffa3", "p2", 3], ["tag", "p3", 4], ["1v1", "p5", 2]] as const) {
  test(`${format} practice-bot start timing`, async ({ player }, info) => {
    test.skip(process.env.E2E_START_LOAD_TIMING !== "1", "Opt-in startup measurement");
    test.skip(format === "1v1" && process.env.E2E_RPS_OPENING !== "1", "Requires the RPS opening");
    for (let attempt = 0; attempt < 24; attempt++) {
      const host = await player(key);
      const entries = await recordOpeningTiming(host.context);
      const slug = await createTable(host.page, uniqueTableName(`load ${format}`), { format });
      for (let seat = 1; seat < seats; seat++) await addBotToSeat(host.page, slug, seat);
      await host.page.reload();
      await importDeckAndReady(host.page);
      const popup = host.context.waitForEvent("page");
      const startAt = Date.now();
      await host.page.getByRole("button", { name: /^Start duel/ }).click();
      const duel = await popup;
      if (format === "1v1") {
        await expect(duel.getByTestId("opening-screen")).toBeVisible();
        let lost = false;
        for (let round = 0; round < 24; round++) {
          await duel.getByTestId("opening-move-rock").click();
          await expect(duel.getByTestId("opening-status")).toHaveText(/You (lose|win)|Tie/);
          const text = await duel.getByTestId("opening-status").textContent();
          if (text?.startsWith("Tie")) continue;
          lost = text?.startsWith("You lose") === true;
          break;
        }
        // Do not read hidden bot picks. Retry human wins to measure the same loss path.
        if (!lost) {
          expect((await host.page.request.post(`/api/duels/${slug}/cancel`)).ok()).toBe(true);
          await host.context.close();
          continue;
        }
      }
      await expect(duel.locator('[aria-label="Duel field"]')).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => entries.some(entry => entry.page.includes(slug) && entry.kind === "board-paint")).toBe(true);
      const timeline = entries.filter(entry => entry.page === `/duels/${slug}?window=1`).sort((a, b) => a.at - b.at);
      const result = timeline.find(entry => entry.kind === "dice-result" || entry.kind === "result");
      if (format !== "tag") expect(result, "Observe the opening result before the field").toBeDefined();
      const zero = result?.at ?? startAt;
      const active = timeline.find(entry => entry.kind === "response" &&
        (entry.detail as { sessionStatus?: string })?.sessionStatus === "active")!;
      const report = { format, slug, startAt, zero, resultToPaintMs: +(timeline.find(entry => entry.kind === "board-paint")!.at - zero).toFixed(1),
        timeline: timeline.map(entry => ({ ...entry, ms: +(entry.at - zero).toFixed(1) })) };
      console.log("START_LOAD_TIMING", JSON.stringify(report));
      await info.attach("start-load-timing", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
      if (format !== "tag") {
        const requestedAt = (active.detail as { startedAt: number }).startedAt;
        const notice = timeline.filter(entry => entry.kind === "ws-changed" && entry.at <= requestedAt).at(-1)!;
        expect(requestedAt - notice.at, "Socket invalidation starts the field request promptly").toBeLessThan(250);
      }
      await expect(duel.getByTestId("opening-screen")).toHaveCount(0);
      await duel.close();
      await host.page.close();
      return;
    }
    throw new Error("No bot RPS win in 24 attempts");
  });
}
