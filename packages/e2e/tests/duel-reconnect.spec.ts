import { test, expect } from "../helpers/fixtures";
import { enterDuelRoom } from "../helpers/duel";
import { chainList, handCard, pickLegalZone, pile, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

// Reload both duelists in the middle of a chain. The chain, the open question and the board come back,
// and the duel goes on.
test("both duelists can reload during a chain and keep playing", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(
    alice,
    bob,
    "reload",
    { main: withFiller(["Reinforcement of the Army", FILLER, FILLER, FILLER, FILLER, "Celtic Guardian"], 14) },
    { main: withFiller(["Ash Blossom & Joyous Spring"], 14) },
  );

  await useCard(alice.page, handCard(alice.page, "Reinforcement of the Army"), "Activate");
  await pickLegalZone(alice.page, "st");
  // One card to chain: the compact "Activate?" bar with Yes and No.
  const respond = bob.page.getByRole("group", { name: /^Ash Blossom & Joyous Spring\. You can activate/ });
  await expect(respond).toBeVisible();

  // Bob reloads while the question is open. The same question returns.
  await bob.page.reload();
  await enterDuelRoom(bob.page);
  await expect(respond).toBeVisible();
  await expect(chainList(bob.page).getByRole("listitem")).toHaveText([/1\s*Reinforcement of the Army\s*E2E Alice/]);

  // Alice reloads while she waits. The chain and the set spell stay, and she still waits.
  await alice.page.reload();
  await enterDuelRoom(alice.page);
  await expect(chainList(alice.page).getByRole("listitem")).toHaveText([/1\s*Reinforcement of the Army\s*E2E Alice/]);
  await expect(alice.page.getByRole("button", { name: "Waiting" })).toBeDisabled();
  await expect(alice.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);

  // Bob passes. The chain resolves on both screens.
  await respond.getByRole("button", { name: "No", exact: true }).click();
  await expect(chainList(alice.page)).toHaveCount(0);
  await expect(chainList(bob.page)).toHaveCount(0);
  await expect(pile(alice.page, "Your", "Graveyard")).toHaveAccessibleName("Your Graveyard (1)");
  await expect(pile(bob.page, "Opponent", "Graveyard")).toHaveAccessibleName("Opponent Graveyard (1)");

  // Alice can still act after both reloads: she Normal Summons.
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
});
