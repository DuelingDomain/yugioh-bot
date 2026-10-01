import { test, expect } from "../helpers/fixtures";
import { chainList, handCard, openLog, pickLegalZone, pile, pileCards, respondPanel, startDuel, useCard } from "../helpers/board";
import { withFiller } from "../helpers/decks";

// Chain and hand trap: Alice activates a searcher, Bob chains Ash Blossom from his hand.
test("a hand trap chained to a searcher negates it and both players see the chain", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(
    alice,
    bob,
    "ash",
    { main: withFiller(["Reinforcement of the Army", "Gene-Warped Warwolf", "Gene-Warped Warwolf", "Gene-Warped Warwolf", "Gene-Warped Warwolf", "Celtic Guardian"]) },
    { main: withFiller(["Ash Blossom & Joyous Spring", "Mirror Force"]) },
  );

  await useCard(alice.page, handCard(alice.page, "Reinforcement of the Army"), "Activate");
  await pickLegalZone(alice.page, "st");

  // Bob is asked to respond. Both see link 1 in the chain.
  const respond = respondPanel(bob.page, "You can respond to Reinforcement of the Army");
  await expect(respond).toBeVisible();
  await expect(chainList(bob.page).getByRole("listitem")).toHaveText([/1\s*Reinforcement of the Army\s*E2E Alice/]);
  await expect(chainList(alice.page).getByRole("listitem")).toHaveText([/1\s*Reinforcement of the Army\s*E2E Alice/]);
  await expect(alice.page.getByRole("button", { name: "Waiting" })).toBeDisabled();

  await respond.getByRole("button", { name: /^Ash Blossom & Joyous Spring: Negate that effect/ }).click();

  // The chain ends. The searcher is negated: the warrior stays in the deck, Ash and the spell are in the GY.
  await expect(chainList(alice.page)).toHaveCount(0);
  await expect(chainList(bob.page)).toHaveCount(0);
  for (const page of [alice.page, bob.page]) {
    await expect(pile(page, "Your", "Graveyard")).toHaveAccessibleName("Your Graveyard (1)");
    await expect(pile(page, "Opponent", "Graveyard")).toHaveAccessibleName("Opponent Graveyard (1)");
  }
  expect(await pileCards(alice.page, "Your", "Graveyard")).toEqual(["Reinforcement of the Army"]);
  expect(await pileCards(alice.page, "Opponent", "Graveyard")).toEqual(["Ash Blossom & Joyous Spring"]);
  expect(await pileCards(bob.page, "Your", "Graveyard")).toEqual(["Ash Blossom & Joyous Spring"]);
  expect(await pileCards(bob.page, "Opponent", "Graveyard")).toEqual(["Reinforcement of the Army"]);
  // Alice's hand stayed at 4 cards: Celtic Guardian was not added.
  await expect(alice.page.getByRole("group", { name: "Your hand" }).getByRole("button")).toHaveCount(4);
  await expect(alice.page.getByRole("button", { name: "Celtic Guardian" })).toHaveCount(0);
  await expect(pile(alice.page, "Your", "Main Deck")).toHaveAccessibleName("Your Main Deck (7)");

  // The history marks link 1 as negated on both screens.
  for (const { page } of [alice, bob]) {
    const history = await openLog(page);
    await expect(history.getByRole("button", { name: /activated Reinforcement of the Army\. Chain link 1 of 2/ })).toHaveAttribute("data-status", "negated");
    await expect(history.getByRole("button", { name: /activated Ash Blossom & Joyous Spring\. Chain link 2 of 2/ })).toHaveAttribute("data-status", "resolved");
  }
});
