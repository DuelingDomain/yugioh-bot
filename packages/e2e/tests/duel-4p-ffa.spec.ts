import { test, expect, type Seat } from "../helpers/fixtures";
import { activateSingleResponse, attackWithFirstMonster, endTurn, expectOpponentBoards, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { surrender } from "../helpers/duel";
import type { Page } from "@playwright/test";

// 4-player free-for-all in real browsers (ADR-0002 and ADR-0003). Turn order is seat 0, 1, 2, 3.
// The Normal Summon of each seat uses a filler card of its hand. The fixture's leak scan and stall detector run for N seats:
// after each test, leak-scan.json has one entry per player.

const KEYS = ["p1", "p2", "p3", "p4"] as const;
const decks = (first: string[]) => Array.from({ length: 4 }, (_, seat) => ({ main: withFiller(seat === 0 ? first : [FILLER], 14) }));

const openSeats = (player: (key: (typeof KEYS)[number]) => Promise<Seat>) => Promise.all(KEYS.map((key) => player(key)));
const ownMonsters = (page: Page) => page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]');
/** The Life Points of a seat. A rail board, the focused top field and the own side all carry `data-lp-seat`. */
const lpOf = (page: Page, seat: number) => page.locator(`[data-lp-seat="${seat}"]`).first();
/** The phase bar. The Battle plate is a button only while the engine offers the Battle Phase. */
const toBattle = (page: Page) => page.getByRole("button", { name: /^To Battle/ });
const battlePlate = (page: Page) => page.getByRole("navigation", { name: "Duel phases" }).getByRole("button", { name: /battle/i });

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
      await expectOpponentBoards(seat.page, 3);
      await expect(turnLabel(seat.page)).toHaveText("Turn 1");
      // The turn order strip lists every seat, and seat 0 is to play.
      await expect(seat.page.getByTestId("seat-strip").getByRole("listitem")).toHaveCount(4);
      await expect(seat.page.getByTestId("seat-strip-0")).toHaveAttribute("data-turn", "true");
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

  test("nobody can attack before every duelist had a turn", async ({ player }) => {
    const seats = await openSeats(player);
    await startTable(seats, "ffa4 no attack", decks([FILLER, FILLER]));
    const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];
    // Turn 1, seat 0: summon, then no Battle Phase move is offered (the plate is not a button).
    await normalSummon(alice);
    await expect(toBattle(alice.page)).toHaveCount(0);
    await expect(battlePlate(alice.page)).toHaveCount(0);
    await endTurn(alice.page, 2);
    for (const [index, seat] of [bob, carol, dave].entries()) {
      await expect(toBattle(seat.page)).toHaveCount(0);
      await expect(battlePlate(seat.page)).toHaveCount(0);
      await endTurn(seat.page, index + 3);
    }
    // Turn 5 is seat 0 again: the first turn where an attack is allowed.
    await expect(turnLabel(alice.page)).toHaveText("Turn 5");
    await expect(toBattle(alice.page)).toBeEnabled();
  });

  test("a spell that hits all opponents clears the monsters of all 3 opponents", async ({ player }) => {
    const seats = await openSeats(player);
    // Seat 0 holds Raigeki. Seats 1 to 3 each summon a filler monster on their own turn.
    await startTable(seats, "ffa4 raigeki", decks(["Raigeki", FILLER]));
    const [alice, ...others] = seats as [Seat, ...Seat[]];
    await endTurn(alice.page, 2);
    for (const [index, seat] of others.entries()) {
      await normalSummon(seat);
      await endTurn(seat.page, index + 3);
    }
    await expect(turnLabel(alice.page)).toHaveText("Turn 5");
    await useCard(alice.page, handCard(alice.page, "Raigeki"), "Activate");
    await pickLegalZone(alice.page, "st");
    for (const seat of others) {
      await expect(ownMonsters(seat.page)).toHaveCount(0);
    }
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

    // The pick names the 3 opponents (never the own seat), on the turn order strip and in the prompt.
    for (const name of ["E2E Bob", "E2E Carol", "E2E Dave"]) {
      await expect(alice.page.getByRole("button", { name: `Choose ${name} as the opponent` }).first()).toBeVisible();
    }
    await expect(alice.page.getByRole("button", { name: "Choose E2E Alice as the opponent" })).toHaveCount(0);
    await alice.page.getByTestId("seat-strip-pick-2").click();

    // Name the filler card: every copy in the picked opponent's hand goes to the Graveyard.
    await alice.page.getByLabel("Search card name").fill(FILLER);
    await alice.page.locator("#announce-card ~ ul button").filter({ hasText: FILLER }).first().click();
    await expect(alice.page.getByRole("button", { name: /^E2E Carol (GY|Graveyard) \(5\)$/ })).toBeVisible();
    await expect(alice.page.getByRole("button", { name: /^E2E Carol Hand \(0\)$/ })).toBeVisible();
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
    const directly = (n: number) => alice.page.getByRole("button", { name: new RegExp(`Attack Player ${n} directly`) });
    for (const n of [2, 3, 4]) await expect(directly(n)).toBeVisible();
    await expect(directly(1)).toHaveCount(0);
    await directly(3).click();

    // The hit lands on seat 2 only (2000 damage). All four pages agree.
    for (const seat of seats) {
      await expect(lpOf(seat.page, 2)).toContainText("6,000");
      await expect(lpOf(seat.page, 1)).toContainText("8,000");
      await expect(lpOf(seat.page, 3)).toContainText("8,000");
    }

    // Seat 3 surrenders in the middle of the attack. The seat shows "Leaving" until the step is done, and the duel goes on.
    await surrender(dave.page);
    for (const seat of [alice, bob, carol]) await expect(seat.page.getByTestId("seat-strip-leaving-3")).toBeVisible();
    await expect(alice.page.getByTestId("duel-result")).toHaveCount(0);

    // Seat 0 ends the turn: seat 3 is out for good. The turn goes 1, 2, then back to 0: seat 3 is skipped.
    await endTurn(alice.page, 6);
    for (const seat of seats) await expect(seat.page.getByTestId("seat-strip-3")).toHaveAttribute("data-eliminated", "true");
    await expect(dave.page.getByTestId("self-eliminated")).toBeVisible();
    // Bob and Carol hold 7 cards on their second turn: a summon keeps the hand at the limit, so no discard prompt opens.
    await normalSummon(bob);
    await endTurn(bob.page, 7);
    await normalSummon(carol);
    await endTurn(carol.page, 8);
    await expect(turnLabel(alice.page)).toHaveText("Turn 8");

    // Seat 1 surrenders in the turn of seat 0 and leaves when that turn is done. Then the turn goes to seat 2.
    await surrender(bob.page);
    await expect(alice.page.getByTestId("seat-strip-leaving-1")).toBeVisible();
    await expect(alice.page.getByTestId("duel-result")).toHaveCount(0);
    await endTurn(alice.page, 9);
    await expect(alice.page.getByTestId("seat-strip-1")).toHaveAttribute("data-eliminated", "true");
    await expect(turnLabel(carol.page)).toHaveText("Turn 9");

    // The last surrender leaves one duelist: the game ends and the screens differ for each viewer.
    await surrender(carol.page);

    const result = (page: Page) => page.getByTestId("duel-result");
    await expect(result(alice.page)).toHaveAttribute("data-outcome", "win");
    await expect(result(alice.page)).toContainText("YOU WIN");
    for (const seat of [bob, carol, dave]) {
      await expect(result(seat.page)).toHaveAttribute("data-outcome", "lose");
    }
    // Every screen lists the 4 final Life Points.
    for (const seat of seats) {
      await expect(result(seat.page).getByRole("list", { name: "Final Life Points" }).getByRole("listitem")).toHaveCount(4);
    }
  });
});
