import { test, expect } from "../helpers/fixtures";
import { endTurn, expectOpponentBoards, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

// Skeleton for a 4-player free-for-all (Layer 4, ADR-0002 and ADR-0003). Every spec is `test.fixme` until the
// lobby for 3 and 4 seats lands (agent A4): the bot route `POST /api/duels/<slug>/bot` with `{ seat }`, the
// "Table type" select in the creator, and the multi-seat stage (`data-testid="multi-seat-stage"`).
// Turn order is seat 0, 1, 2, 3. The Normal Summon of each seat uses the first filler card of its hand.
// The fixture's leak scan and stall detector already run for N seats: after each test, leak-scan.json has one entry per player.

const decks = (first: string[]) => Array.from({ length: 4 }, (_, seat) => ({ main: withFiller(seat === 0 ? first : [FILLER], 14) }));

// `E2E_UNFIXME=1` runs the specs (with the same evidence: timeline, stall detector, leak scan, per-player files).
// Without it they stay `test.fixme`.
const spec: typeof test = ((title: string, body: never) => (process.env.E2E_UNFIXME === "1" ? test(title, body) : test.fixme(title, body))) as never;

test.describe("4-player FFA", () => {
  spec("starts with 4 duelists and every seat sees 3 opponent boards", async ({ player }) => {
    const seats = await Promise.all((["p1", "p2", "p3", "p4"] as const).map((key) => player(key)));
    await startTable(seats, "ffa4 start", decks([FILLER]));
    for (const seat of seats) {
      await expectOpponentBoards(seat.page, 3);
      await expect(turnLabel(seat.page)).toHaveText("Turn 1");
    }
  });

  spec("the same table also works with 1 human and 3 practice bots", async ({ player }) => {
    const alice = await player("p1");
    const { slug } = await startTable([alice], "ffa4 bots", decks([FILLER]).slice(0, 1), { ordered: true, looseDecks: true, noBanlist: true, format: "ffa4", bots: [1, 2, 3] });
    await expectOpponentBoards(alice.page, 3);
    expect(slug).toBeTruthy();
  });

  spec("nobody can attack before every duelist had a turn", async ({ player }) => {
    const seats = await Promise.all((["p1", "p2", "p3", "p4"] as const).map((key) => player(key)));
    await startTable(seats, "ffa4 no attack", decks([FILLER, FILLER]));
    const [alice, bob, carol, dave] = seats as [typeof seats[0], typeof seats[0], typeof seats[0], typeof seats[0]];
    // Turn 1, seat 0: summon, then the Battle Phase button offers no attack.
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await expect(alice.page.getByRole("button", { name: /^To Battle/ })).toBeDisabled();
    await endTurn(alice.page, 2);
    for (const [index, seat] of [bob, carol, dave].entries()) {
      await expect(seat.page.getByRole("button", { name: /^To Battle/ })).toBeDisabled();
      await endTurn(seat.page, index + 3);
    }
    // Turn 5 is seat 0 again: the first turn where an attack is allowed.
    await expect(turnLabel(alice.page)).toHaveText("Turn 5");
    await expect(alice.page.getByRole("button", { name: /^To Battle/ })).toBeEnabled();
  });

  spec("a spell that hits all opponents clears the monsters of all 3 opponents", async ({ player }) => {
    const seats = await Promise.all((["p1", "p2", "p3", "p4"] as const).map((key) => player(key)));
    // Seat 0 holds Raigeki. Seats 1 to 3 each summon a filler monster on their own turn.
    await startTable(seats, "ffa4 raigeki", decks(["Raigeki", FILLER]));
    const [alice, ...others] = seats as [typeof seats[0], ...typeof seats];
    await endTurn(alice.page, 2);
    for (const [index, seat] of others.entries()) {
      await useCard(seat.page, handCard(seat.page, FILLER), "Normal Summon");
      await pickLegalZone(seat.page, "mz");
      await expect(seat.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
      await endTurn(seat.page, index + 3);
    }
    await useCard(alice.page, handCard(alice.page, "Raigeki"), "Activate");
    for (const seat of others) {
      await expect(seat.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(0);
    }
  });
});
