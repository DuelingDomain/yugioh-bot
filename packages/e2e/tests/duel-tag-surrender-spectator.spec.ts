import { test, expect, type Seat } from "../helpers/fixtures";
import { startTable, watchDuel } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { surrender } from "../helpers/duel";
import { collectTableErrors, expectRealCore, readTable, tableShot } from "../helpers/table";
import { expectRooftop, tagField, tagShell, teamLpPlate } from "../helpers/tag";

// Tag surrender and spectating in real browsers. p1 sits at seat 0 (team 0, with bot seat 2). The bots take seats 1, 2 and 3.
// One surrender ends the whole duel at once and the surrendering team loses (R-TAG-SURRENDER), so team 1 wins.
// p2 does not sit: the three bots fill the other seats, so p2 can only watch.
const options = { ordered: true, looseDecks: true, noBanlist: true, format: "tag" as const, bots: [1, 2, 3] };
const normalDeck = () => ({ main: withFiller([FILLER], 40) });

test.describe("Tag surrender and spectators", () => {
  // Four live boards can render slowly when other stack slots share headless Chromium resources.
  test.use({ actionTimeout: 60_000, navigationTimeout: 60_000 });

  test("a spectator sees the Rooftop, and one surrender ends the duel with the other team winning", async ({ player }, info) => {
    test.setTimeout(240_000);
    const [alice, watcher] = await Promise.all([player("p1"), player("p2")]) as [Seat, Seat];
    await Promise.all([alice, watcher].map((seat) => seat.context.addInitScript(() => {
      for (const name of ["AudioContext", "webkitAudioContext"]) Object.defineProperty(window, name, { value: undefined, configurable: true });
    })));
    const errors = collectTableErrors(alice.page, [watcher.page]);
    const { slug } = await startTable([alice], "tag surrender", [normalDeck()], options);
    await expectRealCore(alice.page, slug, "practice", info, 3);
    await expectRooftop(alice.page);

    await test.step("the spectator sees the Rooftop, also after a reload", async () => {
      await watchDuel(watcher, slug);
      for (const reload of [false, true]) {
        if (reload) {
          await watcher.page.reload();
          await expect(watcher.page.getByText("You are spectating")).toBeVisible();
        }
        await expectRooftop(watcher.page);
        // Four fields and two team plates, and no field belongs to the spectator.
        await expect(watcher.page.locator("[data-table-stage='tag'] [data-seat-field]")).toHaveCount(4);
        await expect(tagField(watcher.page, "self")).toHaveCount(0);
        await expect(watcher.page.locator("[data-team-plate]")).toHaveCount(2);
        for (const team of [0, 1]) await expect(teamLpPlate(watcher.page, team)).toBeVisible();
        await expect(watcher.page.getByRole("list", { name: "Turn order" }).first().locator("li b")).toHaveText(["1A", "2A", "1B", "2B"]);
        await expect(watcher.page.getByTestId("duel-result")).toHaveCount(0);
      }
      // The spectator view holds no seat, no deck and no hand faces.
      const room = await readTable(watcher.page, slug, true);
      expect(room).toMatchObject({ role: "spectator", mySeat: null, myDeck: null, engine: { prompt: null } });
      for (const seat of room.engine!.seats) expect(seat.hand.every((card) => card.code == null && card.name == null)).toBe(true);
      await tableShot(watcher.page, slug, info, "tag-spectator-rooftop");
    });

    await test.step("one surrender ends the duel at once", async () => {
      const before = await readTable(alice.page, slug);
      expect(before.engine!.result).toBeNull();
      const response = alice.page.waitForResponse((reply) => reply.url().endsWith(`/api/duels/${slug}/surrender`) && reply.request().method() === "POST");
      await surrender(alice.page);
      expect((await response).ok()).toBe(true);
      // No queue and no elimination: the engine holds a result at once, with team 1 as the winner.
      const after = await readTable(alice.page, slug);
      expect(after.engine!.result).toMatchObject({ winnerTeam: 1 });
      expect(after.session.status).toBe("completed");
      // Nobody is eliminated; the whole team loses together.
      for (const seat of after.engine!.seats) expect(seat.eliminated).toBe(false);
    });

    await test.step("the result screen shows the winning team", async () => {
      const outcome = async (page: Seat["page"]) => (await result(page).getAttribute("data-result")) ?? (await result(page).getAttribute("data-outcome"));
      const result = (page: Seat["page"]) => page.getByTestId("duel-result");
      // The surrendering player lost; the spectator sees that the other team won.
      await expect(result(alice.page)).toBeVisible();
      await expect.poll(() => outcome(alice.page)).toBe("lose");
      await expect(result(watcher.page)).toBeVisible();
      await expect.poll(() => outcome(watcher.page)).toBe("spectator");
      for (const seat of [alice, watcher]) {
        // The shared result screen lists one row per seat. Team 1 (seats 1 and 3) won; both of its seats are winners.
        const rows = result(seat.page).locator("li[data-winner]");
        await expect(rows).toHaveCount(4);
        for (const seatNumber of [0, 1, 2, 3]) {
          await expect(result(seat.page).locator(`li[data-winner][data-seat='${seatNumber}']`)).toHaveAttribute("data-winner", seatNumber % 2 === 1 ? "true" : "false");
        }
      }
      await tableShot(alice.page, slug, info, "tag-surrender-result-loser");
      await tableShot(watcher.page, slug, info, "tag-surrender-result-spectator");
      // The result stays after a reload, and the duel accepts no more action.
      await watcher.page.reload();
      await expect(result(watcher.page).locator("li[data-winner='true']")).toHaveCount(2);
      await expect(tagShell(alice.page)).toBeVisible();
      await expect(alice.page.getByRole("button", { name: "End Turn", exact: true })).toHaveCount(0);
    });
    expect(errors).toEqual([]);
  });
});
