import { test, expect } from "../helpers/fixtures";
import { createStandardTable, importDeckAndReady, uniqueTableName } from "../helpers/duel";
import { recordOpeningTiming } from "../helpers/opening-timing";

test("practice bot RPS loss reaches the field without a client wait", async ({ player }, info) => {
  test.skip(process.env.E2E_RPS_OPENING !== "1", "Requires RPS on the isolated host");
  let lost = false;
  // The bot's pick stays hidden. Each attempt has its own recorder so the privacy scan
  // can check the actual duel even when an earlier attempt was a human win.
  for (let attempt = 0; attempt < 24 && !lost; attempt += 1) {
    const host = await player("p5");
    if (process.env.E2E_OPENING_BOARD_VIEW === "3d") {
      await host.context.addInitScript(() => localStorage.setItem("yugidraft.duelBoardView.v1", JSON.stringify({ v: 1, mode: "3d", tilt: "tilt" })));
    }
    const entries = await recordOpeningTiming(host.context);
    const slug = await createStandardTable(host.page, uniqueTableName("bot opening"));
    await host.page.getByRole("button", { name: "Add practice bot" }).click();
    await importDeckAndReady(host.page);
    const popup = host.context.waitForEvent("page");
    await host.page.getByRole("button", { name: /^Start duel/ }).click();
    const duel = await popup;
    await expect(duel.getByTestId("opening-screen")).toBeVisible();
    if (process.env.E2E_OPENING_FULL_MOTION === "1") await duel.emulateMedia({ reducedMotion: "no-preference" });
    for (let round = 0; round < 24; round += 1) {
      await duel.getByTestId("opening-move-rock").click();
      await expect(duel.getByTestId("opening-status")).toHaveText(/You (lose|win)|Tie/);
      const result = await duel.getByTestId("opening-status").textContent();
      if (result?.startsWith("Tie")) continue;
      lost = result?.startsWith("You lose") === true;
      break;
    }
    if (!lost) {
      const cancelled = await host.page.request.post(`/api/duels/${slug}/cancel`);
      expect(cancelled.ok()).toBe(true);
      await host.context.close();
      continue;
    }
    await expect(duel.locator('[aria-label="Duel field"]')).toBeVisible({ timeout: 45_000 });
    for (const kind of ["board-paint", "images-loaded"]) {
      await expect.poll(() => entries.some((entry) => entry.page.includes(slug) && entry.kind === kind)).toBe(true);
    }
    const timeline = entries.filter((entry) => entry.page === `/duels/${slug}?window=1`).sort((a, b) => a.at - b.at);
    const zero = timeline.find((entry) => entry.kind === "result")!.at;
    const report = timeline.map((entry) => ({ ...entry, ms: +(entry.at - zero).toFixed(1) }));
    await info.attach("opening-timing", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    console.log("BOT_OPENING_TIMING", JSON.stringify(report));

    const active = timeline.find((entry) => entry.kind === "response" &&
      (entry.detail as { sessionStatus?: string })?.sessionStatus === "active")!;
    const requestedAt = (active.detail as { startedAt: number }).startedAt;
    const notice = timeline.filter((entry) => entry.kind === "ws-changed" && entry.at <= requestedAt).at(-1)!;
    expect(requestedAt - notice.at, "Choice invalidation must cause an immediate room GET").toBeLessThan(250);
    expect(timeline.filter((entry) => entry.kind === "document"), "No page navigation after the RPS result").toHaveLength(1);
    expect(timeline.some((entry) => entry.kind === "response" && entry.at < notice.at &&
      (entry.detail as { path?: string })?.path?.endsWith("/connection")), "Subscribe during the opening").toBe(true);
    await expect(duel.getByTestId("opening-screen")).toHaveCount(0);
    const font = await duel.getByRole("radiogroup", { name: "Chain responses" }).locator("kbd").evaluate((node) => getComputedStyle(node).fontFamily);
    expect(font, "The startup shortcut must use the loaded duel font").toContain("Sofia Sans Extra Condensed");
    // End browser observation before the fixture replays the privacy journal. The context
    // stays open for its final authenticated room read; all captured frames are still scanned.
    await duel.close();
    await host.page.close();
  }
  expect(lost, "Exercise an actual RPS loss").toBe(true);
});
