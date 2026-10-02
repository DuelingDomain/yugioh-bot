import { test, expect, type Seat } from "../helpers/fixtures";
import { activateSingleResponse, attackWithFirstMonster, endTurn, expectOpponentBoards, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { surrender } from "../helpers/duel";
import { actionPosts, expectRealCore, readTable, startTablePreset, tableField, tableLp, tableLpValue } from "../helpers/table";
import type { Page } from "@playwright/test";

// 4-player free-for-all in real browsers (ADR-0002 and ADR-0003). Turn order is seat 0, 1, 2, 3.
// The Normal Summon of each seat uses a filler card of its hand. The fixture's leak scan and stall detector run for N seats:
// after each test, leak-scan.json has one entry per player.

const KEYS = ["p1", "p2", "p3", "p4"] as const;
const decks = (first: string[]) => Array.from({ length: 4 }, (_, seat) => ({ main: withFiller(seat === 0 ? first : [FILLER], 14) }));

const openSeats = (player: (key: (typeof KEYS)[number]) => Promise<Seat>) => Promise.all(KEYS.map((key) => player(key)));
const ownMonsters = (page: Page) => page.locator('[data-seat-field][data-side="you"] [data-kind="mz"][data-occupied="true"]');
/** TableShell gives each seat exactly one holographic LP panel. */
/** The phase bar. The Battle plate is a button only while the engine offers the Battle Phase. */
const toBattle = (page: Page) => page.getByRole("button", { name: /^To Battle/ });
/** The Battle plate in the list of phase plates (not the primary dock button, which also names the Battle Phase). */
const battlePlate = (page: Page) =>
  page.getByRole("navigation", { name: "Duel phases" }).getByRole("list").getByRole("button", { name: /battle/i });

/** Waits until the seat shows turn `turn` and its End Turn button works, so a "no Battle Phase" check cannot pass on a page that is not ready. */
async function expectTurnReady(seat: Seat, turn: number): Promise<void> {
  await expect(turnLabel(seat.page)).toHaveText(`Turn ${turn}`);
  await expect(seat.page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
}

async function normalSummon(seat: Seat): Promise<void> {
  await useCard(seat.page, handCard(seat.page, FILLER), "Normal Summon");
  await pickLegalZone(seat.page, "mz");
  await expect(ownMonsters(seat.page)).toHaveCount(1);
}

test.describe("4-player FFA", () => {
  test("starts with 4 duelists and every seat sees 3 opponent boards", async ({ player }) => {
    const seats = await openSeats(player);
    await startTable(seats, "ffa4 start", decks([FILLER]));
    for (const seat of seats) {
      for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await seat.page.setViewportSize(size);
        await expectOpponentBoards(seat.page, 3);
      }
      await expect(turnLabel(seat.page)).toHaveText("Turn 1");
      await expect(seat.page.locator("[data-table-shell]")).toBeVisible();
      await expect(seat.page.locator("[data-table-stage='ffa4'] [data-seat-field]")).toHaveCount(4);
      await expect(seat.page.locator("[data-lp-seat]")).toHaveCount(4);
      await expect(seat.page.locator("[data-arc='0']")).toHaveAttribute("data-lit", "true");
    }
  });

  test("the same table also works with 1 human and 3 practice bots", async ({ player }) => {
    const alice = await player("p1");
    const { slug } = await startTable([alice], "ffa4 bots", decks([FILLER]).slice(0, 1), { ordered: true, looseDecks: true, noBanlist: true, format: "ffa4", bots: [1, 2, 3] });
    await expectOpponentBoards(alice.page, 3);
    expect(slug).toBeTruthy();
    // The 3 bots play their turns, so the turn counter comes back to the human at turn 5.
    await endTurn(alice.page, 5);
  });

  test("current engine: no BP on turns 1-4", async ({ player }) => {
    const seats = await openSeats(player);
    await startTable(seats, "ffa4 no attack", decks([FILLER, FILLER]));
    const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];
    // Turn 1, seat 0: summon, then no Battle Phase move is offered (the plate is not a button).
    await expectTurnReady(alice, 1);
    await normalSummon(alice);
    await expect(toBattle(alice.page)).toHaveCount(0);
    await expect(battlePlate(alice.page)).toHaveCount(0);
    await endTurn(alice.page, 2);
    for (const [index, seat] of [bob, carol, dave].entries()) {
      await expectTurnReady(seat, index + 2);
      await expect(toBattle(seat.page)).toHaveCount(0);
      await expect(battlePlate(seat.page)).toHaveCount(0);
      await endTurn(seat.page, index + 3);
    }
    // Turn 5 is seat 0 again: the first turn where an attack is allowed. The same two locators now match, so the
    // count-0 checks above are real (a locator that never matches would pass them too).
    await expectTurnReady(alice, 5);
    await expect(toBattle(alice.page)).toBeEnabled();
    await expect(battlePlate(alice.page)).toHaveCount(1);
  });

  test("R-FFA-NO-ATTACK: last duelist gets Battle Phase on turn 4", async ({ player }) => {
    const seats = await openSeats(player);
    await startTable(seats, "ffa4 ADR battle window", decks([FILLER]));
    for (const [index, seat] of seats.entries()) {
      await expectTurnReady(seat, index + 1);
      if (index < 3) {
        await expect(toBattle(seat.page)).toHaveCount(0);
        await endTurn(seat.page, index + 2);
      }
    }
    test.fail(true, "R-FFA-NO-ATTACK pending engine change");
    await expect(toBattle(seats[3]!.page)).toBeEnabled({ timeout: 1000 });
  });

  test("current engine: Raigeki hits all opponents (R-FFA-OPP-ONE pending)", async ({ player }) => {
    const seats = await openSeats(player);
    // Seat 0 holds Raigeki and summons a filler monster on turn 1. Seats 1 to 3 each summon a filler monster on their own turn.
    // Raigeki destroys the monsters of the opponents only: the monster of seat 0 must stay (Dark Hole would destroy it too).
    await startTable(seats, "ffa4 raigeki", decks(["Raigeki", FILLER]));
    const [alice, ...others] = seats as [Seat, ...Seat[]];
    await normalSummon(alice);
    await endTurn(alice.page, 2);
    for (const [index, seat] of others.entries()) {
      await normalSummon(seat);
      await endTurn(seat.page, index + 3);
    }
    await expect(turnLabel(alice.page)).toHaveText("Turn 5");
    const stage = alice.page.locator("[data-table-stage]");
    const height = (await stage.boundingBox())!.height;
    await handCard(alice.page, "Raigeki").hover();
    await expect.poll(async () => Math.abs((await stage.boundingBox())!.height - height), {
      message: "Inspecting a different card must keep the table stage height stable",
    }).toBeLessThanOrEqual(1);
    await useCard(alice.page, handCard(alice.page, "Raigeki"), "Activate");
    await pickLegalZone(alice.page, "st");
    for (const seat of others) {
      await expect(ownMonsters(seat.page)).toHaveCount(0);
    }
    // Each opponent had one monster (normalSummon checked that), so the count 0 above is a change. The own monster stays.
    await expect(ownMonsters(alice.page)).toHaveCount(1);
  });

  test("R-FFA-OPP-ONE: Raigeki asks for one opponent and clears only that field", async ({ player }, info) => {
    const alice = await player("p1");
    const slug = await startTablePreset(alice.page, "raigeki-dark-hole-ffa4");
    await expectRealCore(alice.page, slug, "scripted", info, 3);
    for (const seat of [0, 1, 2, 3]) await expect(tableField(alice.page, seat).locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(1);
    await useCard(alice.page, handCard(alice.page, "Raigeki"), "Activate");
    await pickLegalZone(alice.page, "st");
    test.fail(true, "R-FFA-OPP-ONE pending engine change");
    const choice = alice.page.getByTestId("holo-pick-2");
    await expect(choice).toBeVisible({ timeout: 1000 });
    expect((await readTable(alice.page, slug)).engine!.prompt!.context?.type).toBe("opponent");
    await choice.click();
    await expect(tableField(alice.page, 2).locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(0);
    for (const seat of [0, 1, 3]) await expect(tableField(alice.page, seat).locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(1);
    expect((await readTable(alice.page, slug)).engine!.seats.map((seat) => seat.monsters.filter(Boolean).length)).toEqual([1, 1, 0, 1]);
  });

  test("a card that picks one opponent offers each living opponent by name, and only the picked one is hit", async ({ player }) => {
    const seats = await openSeats(player);
    // Mind Crush is a Normal Trap: Set on turn 1. It can be activated from turn 2 on, so the engine offers it
    // to seat 0 in the first phase window of seat 1's turn. Every opponent holds only the filler card.
    await startTable(seats, "ffa4 mind crush", decks(["Mind Crush", FILLER, FILLER, FILLER, FILLER]));
    const [alice] = seats as [Seat, ...Seat[]];
    await useCard(alice.page, handCard(alice.page, "Mind Crush"), "Set Spell/Trap");
    await pickLegalZone(alice.page, "st");
    await endTurn(alice.page, 2);
    await activateSingleResponse(alice.page);

    // The pick lists the 3 opponents in the prompt panel (once each, never the own seat) and on the turn order strip.
    const panel = alice.page.locator("[data-prompt-panel]");
    for (const name of ["E2E Bob", "E2E Carol", "E2E Dave"]) {
      await expect(panel.getByRole("button", { name: `Choose ${name} as the opponent` })).toHaveCount(1);
    }
    await expect(panel.getByRole("button", { name: "Choose E2E Alice as the opponent" })).toHaveCount(0);
    for (const seat of [1, 2, 3]) await expect(alice.page.getByTestId(`holo-pick-${seat}`)).toBeVisible();
    await expect(alice.page.getByTestId("holo-pick-0")).toHaveCount(0);
    await alice.page.getByTestId("holo-pick-2").click();

    // Name the filler card: every copy in the picked opponent's hand goes to the Graveyard.
    await alice.page.getByLabel("Search card name").fill(FILLER);
    const match = alice.page.locator("#announce-card ~ ul button").filter({ hasText: FILLER });
    await expect(match).toHaveCount(1);
    await match.click();
    await expect(alice.page.getByRole("button", { name: /^E2E Carol (GY|Graveyard) \(5\)$/ })).toBeVisible();
    await expect(alice.page.locator('[data-hand-seat="2"]')).toHaveAttribute("aria-label", "E2E Carol hand, 0 cards");
    await expect(alice.page.locator('[data-hand-seat="2"] [data-card-art]')).toHaveCount(0);
    // The other opponents keep their cards.
    for (const name of ["E2E Bob", "E2E Dave"]) {
      await expect(alice.page.getByRole("button", { name: new RegExp(`^${name} (GY|Graveyard) \\(0\\)$`) })).toBeVisible();
    }
  });

  test("a direct attack asks which duelist, a surrender removes one seat, the last duelist wins", async ({ player }) => {
    const seats = await openSeats(player);
    await startTable(seats, "ffa4 pick surrender", decks([FILLER, FILLER]));
    const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];

    // Turn 1 to 4: seat 0 summons, everybody else just passes the turn.
    await normalSummon(alice);
    await endTurn(alice.page, 2);
    await endTurn(bob.page, 3);
    await endTurn(carol.page, 4);
    await endTurn(dave.page, 5);

    // Turn 5: no opponent has a monster, so a direct attack needs an opponent. Every living opponent is offered,
    // and the own seat is not. (The engine labels the rows "Player N", N = seat + 1.)
    await expect(turnLabel(alice.page)).toHaveText("Turn 5");
    await attackWithFirstMonster(alice.page);
    const directly = (seat: number) => alice.page.locator(`[data-opponent-bar='direct'] [data-rival-seat='${seat}']`);
    for (const seat of [1, 2, 3]) await expect(directly(seat)).toBeVisible();
    await expect(directly(0)).toHaveCount(0);
    await directly(2).click();
    await expect(directly(2)).toHaveAttribute("data-locked", "true");
    await alice.page.getByTestId("aim-confirm").click();

    // The hit lands on seat 2 only (2000 damage). All four pages agree.
    for (const seat of seats) {
      await expect(tableLpValue(seat.page, 2)).toHaveText("6,000");
      await expect(tableLpValue(seat.page, 1)).toHaveText("8,000");
      await expect(tableLpValue(seat.page, 3)).toHaveText("8,000");
      for (const untouched of [0, 1, 3]) await expect(tableLp(seat.page, untouched).locator("[data-damage-chip]")).toHaveCount(0);
    }

    // Seat 3 surrenders in the middle of the attack. The seat shows "Leaving" until the step is done, and the duel goes on.
    await surrender(dave.page);
    for (const seat of [alice, bob, carol]) await expect(seat.page.locator("[data-holo='3']")).toHaveAttribute("data-leaving", "true");
    await expect(alice.page.getByTestId("duel-result")).toHaveCount(0);

    // Seat 0 ends the turn: seat 3 is out for good. The turn goes 1, 2, then back to 0: seat 3 is skipped.
    await endTurn(alice.page, 6);
    for (const seat of seats) await expect(seat.page.locator("[data-holo='3']")).toHaveAttribute("data-elim", "true");
    await expect(dave.page.getByTestId("self-eliminated")).toBeVisible();
    // Bob and Carol hold 7 cards on their second turn: a summon keeps the hand at the limit, so no discard prompt opens.
    await normalSummon(bob);
    await endTurn(bob.page, 7);
    await normalSummon(carol);
    await endTurn(carol.page, 8);
    await expect(turnLabel(alice.page)).toHaveText("Turn 8");

    // Seat 1 surrenders in the turn of seat 0 and leaves when that turn is done. Then the turn goes to seat 2.
    await surrender(bob.page);
    await expect(alice.page.locator("[data-holo='1']")).toHaveAttribute("data-leaving", "true");
    await expect(alice.page.getByTestId("duel-result")).toHaveCount(0);
    await endTurn(alice.page, 9);
    await expect(alice.page.locator("[data-holo='1']")).toHaveAttribute("data-elim", "true");
    await expect(turnLabel(carol.page)).toHaveText("Turn 9");

    // The last surrender leaves one duelist: the game ends and the screens differ for each viewer.
    await surrender(carol.page);

    const result = (page: Page) => page.getByTestId("duel-result");
    await expect(result(alice.page)).toHaveAttribute("data-outcome", "win");
    await expect(result(alice.page)).toContainText("YOU WIN");
    for (const seat of [bob, carol, dave]) {
      await expect(result(seat.page)).toHaveAttribute("data-outcome", "lose");
    }
    // Every screen lists the 4 final placings and Life Points.
    for (const seat of seats) {
      await expect(result(seat.page).getByRole("list", { name: "Final standings" }).getByRole("listitem")).toHaveCount(4);
    }
  });
});
