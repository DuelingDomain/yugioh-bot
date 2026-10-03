import { test, expect } from "../helpers/fixtures";
import { chainList, endTurn, handCard, pickLegalZone, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

// Prompt types that are not plain yes or no. Each one is answered with the mouse or keyboard
// like a player would, and the duel goes on after it.
test("a number prompt and an order prompt can be answered and do not stick", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "number", { main: withFiller(["Card Advance"], 14) }, { main: withFiller([], 14) });

  await useCard(alice.page, handCard(alice.page, "Card Advance"), "Activate");
  await pickLegalZone(alice.page, "st");

  // Announce a number from 1 to 5.
  const number = alice.page.getByRole("group", { name: "Announce a number" });
  await number.getByRole("button", { name: "3 3" }).click();

  // Order the top 3 cards of the deck: click them one by one, reset once, then confirm.
  const order = alice.page.getByRole("group", { name: "Choose the card order" });
  const cards = order.getByRole("list").getByRole("button");
  const confirm = order.getByRole("button", { name: "Confirm" });
  await expect(order.getByText("0 of 3 ordered")).toBeVisible();
  await expect(confirm).toBeDisabled();
  await cards.nth(2).click();
  await expect(order.getByText("1 of 3 ordered")).toBeVisible();
  await order.getByRole("button", { name: "Reset order" }).click();
  await expect(order.getByText("0 of 3 ordered")).toBeVisible();
  for (const [done, index] of [[1, 2], [2, 1], [3, 0]]) {
    await cards.nth(index).click();
    await expect(order.getByText(`${done} of 3 ordered`)).toBeVisible();
  }
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // The chain ends and the duel is not stuck: Alice can still end her turn.
  await expect(order).toHaveCount(0);
  await expect(chainList(alice.page)).toHaveCount(0);
  await endTurn(alice.page, 2);
});

test("a card-name prompt for one duelist and a card pick for the other both work", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(
    alice,
    bob,
    "announce",
    { main: withFiller(["Dark Designator"], 14) },
    // Celtic Guardian twice, both below the opening hand of 5, so they are in Bob's deck.
    { main: withFiller([FILLER, FILLER, FILLER, FILLER, FILLER, "Celtic Guardian", "Celtic Guardian"], 14) },
  );

  await useCard(alice.page, handCard(alice.page, "Dark Designator"), "Activate");
  await pickLegalZone(alice.page, "st");

  // Alice names a card by search.
  await alice.page.getByLabel("Search card name").fill("Celtic Guardian");
  await alice.page.getByRole("button", { name: "Celtic Guardian" }).click();

  // Bob picks one of the two copies from his deck. It is mandatory, so there is no cancel.
  const pick = bob.page.getByRole("group", { name: "Select the card(s) to add to your hand" });
  await expect(pick).toBeVisible();
  await expect(pick.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(pick.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await pick.getByRole("list").getByRole("button").first().click();
  await pick.getByRole("button", { name: "Confirm" }).click();

  // The card is in Bob's hand, the chain is gone on both screens, and Alice can go on.
  await expect(pick).toHaveCount(0);
  await expect(handCard(bob.page, "Celtic Guardian")).toBeVisible();
  await expect(chainList(alice.page)).toHaveCount(0);
  await expect(chainList(bob.page)).toHaveCount(0);
  await endTurn(alice.page, 2);
});
