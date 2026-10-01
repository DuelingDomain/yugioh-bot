import { test, expect } from "../helpers/fixtures";
import { attackWithFirstMonster, endTurn, handCard, pickLegalZone, startDuel, useCard, watchDuel } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

// A real win: a direct attack takes the last Life Points. The win screen differs for each viewer.
test("a battle win shows win, lose and spectator screens", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const spectator = await player("p3");
  const { slug } = await startDuel(
    alice,
    bob,
    "win",
    { main: withFiller([FILLER], 14) },
    { main: withFiller([], 14) },
    { ordered: true, looseDecks: true, noBanlist: true, startingLP: 1000 },
  );
  await watchDuel(spectator, slug);

  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(alice.page, 2);
  await endTurn(bob.page, 3);
  await attackWithFirstMonster(alice.page);

  const result = (page: typeof alice.page) => page.getByTestId("duel-result");
  await expect(result(alice.page)).toHaveAttribute("data-outcome", "win");
  await expect(result(bob.page)).toHaveAttribute("data-outcome", "lose");
  await expect(result(spectator.page)).toHaveAttribute("data-outcome", "spectator");
  await expect(result(alice.page)).toContainText("YOU WIN");
  await expect(result(bob.page)).toContainText("YOU LOSE");
  await expect(result(spectator.page)).toContainText("E2E Alice wins");

  // Both screens agree on the final Life Points: the loser has none left.
  for (const page of [alice.page, bob.page, spectator.page]) {
    const scores = result(page).getByRole("list", { name: "Final Life Points" }).getByRole("listitem");
    await expect(scores).toHaveCount(2);
    await expect(scores.filter({ hasText: "E2E Alice" })).toContainText("1,000");
    await expect(scores.filter({ hasText: "E2E Bob" })).toContainText("0");
    await expect(scores.filter({ hasText: "E2E Alice" })).toContainText("Winner");
  }
});
