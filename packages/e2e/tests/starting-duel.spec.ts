import { test, expect } from "../helpers/fixtures";
import { createTable, importDeckAndReady, addBotToSeat, uniqueTableName } from "../helpers/duel";

// Real bot duels. The "Starting duel" state must appear after the opening result and give way to the field.
// Marks come from a MutationObserver in the page, so a short state is not missed between polls.
test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });

type Marks = { opening?: number; starting?: number; startingWithOpening?: number; startingLast?: number; field?: number; fieldWithStarting?: number };

for (const [format, key, seats] of [["ffa4", "p1", 4], ["ffa3", "p2", 3], ["tag", "p3", 4], ["1v1", "p5", 2]] as const) {
  test(`${format}: Starting duel shows after the opening and the field replaces it`, async ({ player }) => {
    test.skip(format === "1v1" && process.env.E2E_RPS_OPENING !== "1", "Requires the RPS opening");
    for (let attempt = 0; attempt < 24; attempt++) {
      const host = await player(key);
      await host.context.addInitScript(() => {
        const marks: Record<string, number> = {};
        (window as unknown as { __startingMarks: typeof marks }).__startingMarks = marks;
        const sample = () => {
          const t = performance.now();
          const opening = document.querySelector('[data-testid="opening-screen"]') != null;
          const starting = document.querySelector('[data-testid="starting-duel"]') != null;
          const field = document.querySelector('[aria-label="Duel field"]') != null;
          if (opening) marks.opening ??= t;
          if (starting) { marks.starting ??= t; marks.startingLast = t; }
          if (starting && opening) marks.startingWithOpening ??= t;
          if (field) marks.field ??= t;
          if (field && starting) marks.fieldWithStarting ??= t;
        };
        new MutationObserver(sample).observe(document, { subtree: true, childList: true });
      });
      const slug = await createTable(host.page, uniqueTableName(`starting ${format}`), { format });
      for (let seat = 1; seat < seats; seat++) await addBotToSeat(host.page, slug, seat);
      await host.page.reload();
      await importDeckAndReady(host.page);
      const popup = host.context.waitForEvent("page");
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
        // A human win would wait for the human's own choice; retry until the bot picks the order.
        if (!lost) {
          expect((await host.page.request.post(`/api/duels/${slug}/cancel`)).ok()).toBe(true);
          await host.context.close();
          continue;
        }
      }
      await expect(duel.locator('[aria-label="Duel field"]')).toBeVisible({ timeout: 60_000 });
      // Nothing of the opening or the loading state stays over the field.
      await expect(duel.getByTestId("starting-duel")).toHaveCount(0);
      await expect(duel.getByTestId("opening-screen")).toHaveCount(0);
      const marks = await duel.evaluate(() => (window as unknown as { __startingMarks: Marks }).__startingMarks);
      expect(marks.starting, "Starting duel was shown").toBeDefined();
      expect(marks.field, "The field was shown").toBeDefined();
      expect(marks.starting!, "Starting duel comes before the field").toBeLessThanOrEqual(marks.field!);
      expect(marks.fieldWithStarting, "The loading state never sits on top of the field").toBeUndefined();
      if (format === "tag") {
        // Tag has no opening: the lobby is the backdrop.
        expect(marks.opening).toBeUndefined();
      } else {
        // The dice or RPS result stays visible behind the loading state.
        expect(marks.opening, "The opening was shown first").toBeDefined();
        expect(marks.startingWithOpening, "Starting duel shows over the opening result").toBeDefined();
        expect(marks.opening!).toBeLessThan(marks.starting!);
      }
      await duel.close();
      await host.page.close();
      return;
    }
    throw new Error("No bot RPS win in 24 attempts");
  });
}
