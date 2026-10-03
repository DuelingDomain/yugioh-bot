import { test, expect } from "../helpers/fixtures";
import { expectReadyToAct, handCard, startTable, useCard, yourHand } from "../helpers/board";
import { enterDuelRoom } from "../helpers/duel";
import { FILLER, withFiller } from "../helpers/decks";
import { collectTableErrors, expectRealCore, readTable, readTableTrace, tableShot } from "../helpers/table";
import { expectRooftop, pickLegalZone, tagField, tagShell, teamLpPlate, teamLpValue, turnNumber } from "../helpers/tag";
import type { Page } from "@playwright/test";

// Tag 2v2 table (the Rooftop) with one human and three practice bots. Seats 0 and 2 are team 0, seats 1 and 3 are team 1.
// The baton runs 1A, 2A, 1B, 2B. Team LP is shared: 2 x the starting LP of one duelist (8,000 by default).
const START_LP = 8_000;
const options = { ordered: true, looseDecks: true, noBanlist: true, format: "tag" as const, bots: [1, 2, 3] };
const normalDeck = () => ({ main: withFiller([FILLER], 40) });

/** The baton codes in strip order. The strip is the ordered list named "Turn order". */
const batonCodes = (page: Page) => page.getByRole("list", { name: "Turn order" }).first().locator("li b").allTextContents();

test.describe("Tag Rooftop table", () => {
  // Four live boards and three bot turns can render slowly when other stack slots share headless Chromium resources.
  test.use({ actionTimeout: 60_000, navigationTimeout: 60_000 });

  test("shows the Rooftop with four fields, two team plates, shared team LP and the 1A 2A 1B 2B baton", async ({ player }, info) => {
    test.setTimeout(240_000);
    const alice = await player("p1");
    await alice.context.addInitScript(() => {
      for (const name of ["AudioContext", "webkitAudioContext"]) Object.defineProperty(window, name, { value: undefined, configurable: true });
    });
    const errors = collectTableErrors(alice.page);
    const { slug } = await startTable([alice], "tag table", [normalDeck()], options);
    const page = alice.page;
    await expectRealCore(page, slug, "practice", info, 3);

    // The Rooftop, not the old MultiSeatStage.
    await expectRooftop(page);
    await expect(tagShell(page)).toHaveAttribute("data-can-act", "true");
    await expect(page.getByRole("region", { name: "Duel field" })).toBeVisible();

    // Four fields: you, your partner and two rivals.
    await expect(tagField(page, "self")).toHaveCount(1);
    await expect(tagField(page, "partner")).toHaveCount(1);
    await expect(tagField(page, "opponent")).toHaveCount(2);
    await expect(page.locator("[data-table-stage='tag'] [data-seat-field]")).toHaveCount(4);
    // The partner is seat 2 (team 0), the rivals are seats 1 and 3 (team 1).
    await expect(tagField(page, "partner", 2)).toHaveCount(1);
    await expect(tagField(page, "opponent", 1)).toHaveCount(1);
    await expect(tagField(page, "opponent", 3)).toHaveCount(1);

    // Two team plates; each holds the chips of its two seats. LP is shared: 2 x the starting LP.
    await expect(page.locator("[data-team-plate]")).toHaveCount(2);
    await expect(page.locator("[data-lp-seat]")).toHaveCount(4);
    for (const team of [0, 1]) {
      await expect(teamLpPlate(page, team)).toBeVisible();
      await expect(teamLpPlate(page, team).locator("[data-lp-seat]")).toHaveCount(2);
      expect(await teamLpValue(page, team)).toBe(2 * START_LP);
    }
    const first = (await readTable(page, slug)).engine!;
    expect(first.seats.map((seat) => seat.lp)).toEqual([2 * START_LP, 2 * START_LP, 2 * START_LP, 2 * START_LP]);

    // Turn order 1A, 2A, 1B, 2B, and Turn 1 belongs to seat 0 (1A).
    expect(await batonCodes(page)).toEqual(["1A", "2A", "1B", "2B"]);
    expect(await turnNumber(page)).toBe(1);
    await expect(page.getByRole("list", { name: "Turn order" }).first().locator("li[data-now='true'] b")).toHaveText("1A");
    await tableShot(page, slug, info, "tag-table-rooftop");

    // A Normal Summon from "Your hand" lands on your own field only.
    await expectReadyToAct(page);
    const handBefore = await yourHand(page).getByRole("button").count();
    expect(handBefore).toBeGreaterThan(0);
    await useCard(page, handCard(page, FILLER), "Normal Summon");
    await pickLegalZone(page, slug, "mz");
    await expect(tagField(page, "self").locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(1);
    await expect(tagField(page, "partner").locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(0);
    await expect(yourHand(page).getByRole("button")).toHaveCount(handBefore - 1);
    await tableShot(page, slug, info, "tag-table-summoned");

    // The three bots play turns 2, 3 and 4; the baton comes back to seat 0 on turn 5.
    await expectReadyToAct(page);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await expect.poll(() => turnNumber(page), { timeout: 90_000 }).toBe(5);
    await expectReadyToAct(page);
    const log = (await readTableTrace(page, slug)).promptLog;
    const turns = log
      .filter((entry) => entry.promptType === "action")
      .map((entry) => [entry.turn, entry.turnSeat])
      .filter((entry, index, entries) => index === 0 || entry[0] !== entries[index - 1]![0]);
    expect(turns).toEqual([[1, 0], [2, 1], [3, 2], [4, 3], [5, 0]]);
    await tableShot(page, slug, info, "tag-table-turn5");

    // ?stage=legacy keeps the old MultiSeatStage for the same room.
    await page.goto(`/duels/${slug}?window=1&stage=legacy`);
    await enterDuelRoom(page);
    await expect(page.getByTestId("multi-seat-stage")).toBeVisible();
    await expect(tagShell(page)).toHaveCount(0);
    await tableShot(page, slug, info, "tag-table-legacy");
    expect(errors).toEqual([]);
  });
});
