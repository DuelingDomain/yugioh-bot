import { test, expect } from "../helpers/fixtures";
import { createStandardTable, enterDuelRoom, importDeckAndReady, surrender, uniqueTableName } from "../helpers/duel";

// Flow a: two players, one public Standard table, surrender, result, history, replay.
test("two players join, duel, surrender, and find the match in history and replay", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const table = uniqueTableName("match");

  const slug = await createStandardTable(alice.page, table);

  await bob.page.goto(`/duels/${slug}`);
  await expect(bob.page.getByRole("heading", { level: 1, name: table })).toBeVisible();
  await bob.page.getByRole("button", { name: "Take seat 2" }).click();

  await importDeckAndReady(bob.page);
  await importDeckAndReady(alice.page);

  const start = alice.page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();

  await enterDuelRoom(alice.page);
  await enterDuelRoom(bob.page);
  await expect(alice.page.getByText("You are spectating")).toHaveCount(0);

  await surrender(alice.page);

  const aliceResult = alice.page.getByTestId("duel-result");
  const bobResult = bob.page.getByTestId("duel-result");
  await expect(aliceResult).toHaveAttribute("data-outcome", "lose");
  await expect(bobResult).toHaveAttribute("data-outcome", "win");
  await expect(aliceResult).toContainText("YOU LOSE");
  await expect(bobResult).toContainText("YOU WIN");

  for (const { page } of [alice, bob]) {
    await page.goto("/duels?view=history");
    await expect(page.getByRole("radio", { name: "Mine" })).toBeChecked();
    const row = page.getByRole("listitem").filter({ hasText: table });
    await expect(row).toBeVisible();
    await expect(row).toContainText(page === alice.page ? "Lost" : "Won");
    await expect(row).toContainText("Surrender");
  }

  // Replay opens and steps forward.
  await bob.page.getByRole("listitem").filter({ hasText: table }).getByRole("link", { name: "Replay" }).click();
  await expect(bob.page).toHaveURL(new RegExp(`/duels/${slug}/replay$`));
  const position = bob.page.getByRole("slider", { name: "Replay position" });
  await expect(position).toBeVisible();
  const before = Number(await position.inputValue());
  const next = bob.page.getByRole("button", { name: "Next move" });
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(before);
});
