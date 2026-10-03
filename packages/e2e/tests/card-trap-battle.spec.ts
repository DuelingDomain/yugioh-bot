import { test, expect } from "../helpers/fixtures";
import { attackWithFirstMonster, endTurn, handCard, pickLegalZone, pile, pileCards, activateSingleResponse, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

// Trap in battle: Bob sets Mirror Force, Alice attacks, Bob activates it, both attackers go to the GY.
test("Mirror Force destroys the attackers and both screens show them in the graveyard", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(
    alice,
    bob,
    "mirror",
    { main: withFiller([FILLER, "Celtic Guardian"], 14) },
    { main: withFiller(["Mirror Force"], 14) },
  );

  // Turn 1: Alice Normal Summons the Warwolf.
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(alice.page, 2);

  // Turn 2: Bob Sets Mirror Force.
  await useCard(bob.page, handCard(bob.page, "Mirror Force"), "Set Spell/Trap");
  await pickLegalZone(bob.page, "st");
  await expect(bob.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(bob.page, 3);

  // Turn 3: Alice adds a second attacker and attacks. Bob has no monsters, so the attack is direct.
  await useCard(alice.page, handCard(alice.page, "Celtic Guardian"), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(2);
  await attackWithFirstMonster(alice.page);

  // Bob may respond to the attack with the Set trap.
  await activateSingleResponse(bob.page);

  // Both attackers are destroyed. Both screens show the same graveyards.
  for (const { page, mine, theirs } of [
    { page: alice.page, mine: "Your", theirs: "Opponent" },
    { page: bob.page, mine: "Opponent", theirs: "Your" },
  ] as const) {
    await expect(pile(page, mine, "Graveyard")).toHaveAccessibleName(`${mine} Graveyard (2)`);
    await expect(pile(page, theirs, "Graveyard")).toHaveAccessibleName(`${theirs} Graveyard (1)`);
    expect((await pileCards(page, mine, "Graveyard")).sort()).toEqual([FILLER, "Celtic Guardian"].sort());
    expect(await pileCards(page, theirs, "Graveyard")).toEqual(["Mirror Force"]);
  }
  await expect(alice.page.locator('[data-kind="mz"][data-occupied="true"]')).toHaveCount(0);
  // The attack did no damage.
  await expect(alice.page.getByText("8,000", { exact: true })).toHaveCount(2);
});
