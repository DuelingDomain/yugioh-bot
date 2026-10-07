import { test, expect } from "../helpers/fixtures";
import { expectReadyToAct, handCard, pickLegalZone, startTable, useCard, yourHand } from "../helpers/board";
import { FILLER } from "../helpers/decks";
import { cardCode } from "../helpers/cards";
import { expectRealCore, readTable, tableField } from "../helpers/table";

test("FFA dice moves the winning player, hand, prompt and names to seat 0", async ({ player }, info) => {
  const [alice, bob, carol] = await Promise.all([player("p1"), player("p2"), player("p3")]);
  const actors = [alice, bob, carol];
  const cards = ["Dark Magician", FILLER, "Blue-Eyes White Dragon"];
  const { slug } = await startTable(actors, "dice seat move", cards.map((name) => ({ main: Array(14).fill(name) })),
    { format: "ffa3", ordered: true, looseDecks: true, noBanlist: true, diceRolls: [1, 6, 3] });
  await expectRealCore(bob.page, slug, "practice", info, 0);

  const finalSeats = [2, 0, 1];
  const names = ["E2E Bob", "E2E Carol", "E2E Alice"];
  for (const [index, actor] of actors.entries()) {
    const seat = finalSeats[index]!;
    const room = await readTable(actor.page, slug);
    expect(room.mySeat).toBe(seat);
    expect(room.session.seats.map((entry) => entry.displayName)).toEqual(names);
    expect(room.engine!.turnSeat).toBe(0);
    expect(room.engine!.seats[seat]!.hand).toHaveLength(5);
    expect(room.engine!.seats[seat]!.hand.every((card) => card.code === cardCode(cards[index]!))).toBe(true);
    await expect(yourHand(actor.page).getByRole("button", { name: cards[index]!, exact: true })).toHaveCount(5);
    await expect(tableField(actor.page, seat)).toHaveAttribute("data-side", "you");
    for (const [publicSeat, name] of names.entries()) {
      await expect(actor.page.getByTestId(`seat-strip-${publicSeat}`)).toContainText(name);
    }
    if (seat === 0) expect(room.engine!.prompt?.seat).toBe(0);
    else {
      expect(room.engine!.prompt).toBeNull();
      await expect(actor.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
    }
  }

  await expectReadyToAct(bob.page);
  await useCard(bob.page, handCard(bob.page, FILLER), "Normal Summon");
  await pickLegalZone(bob.page, "mz");
  await expect(tableField(bob.page, 0).locator("[data-kind='mz'][data-occupied='true']")).toHaveCount(1);
  await expect.poll(async () => (await readTable(bob.page, slug)).engine!.seats[0]!.monsters
    .filter(Boolean).map((card) => card!.code)).toEqual([cardCode(FILLER)]);
});
