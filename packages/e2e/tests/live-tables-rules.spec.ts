import { test, expect } from "../helpers/fixtures";
import { createStandardTable, uniqueTableName } from "../helpers/duel";

// Flow c: an open lobby is listed only for its own players; the organizer can close it.
test("an open lobby shows only to its players and Close removes it", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const table = uniqueTableName("live");

  await createStandardTable(alice.page, table);

  await bob.page.goto("/duels");
  await expect(bob.page.getByRole("heading", { name: "Live tables" })).toBeVisible();
  await expect(bob.page.getByText(/No live duels right now|Your open tables/).first()).toBeVisible();
  await expect(bob.page.getByRole("listitem").filter({ hasText: table })).toHaveCount(0);

  await alice.page.goto("/duels");
  const row = alice.page.getByRole("listitem").filter({ hasText: table });
  await expect(row).toBeVisible();
  await expect(row.getByText("Your table")).toBeVisible();
  await row.getByRole("button", { name: `Close ${table}` }).click();
  const dialog = alice.page.getByRole("dialog", { name: "Cancel table" });
  await dialog.getByRole("button", { name: "Cancel table" }).click();
  await expect(row).toHaveCount(0);

  // Bob still never saw it, even after the list refreshed.
  await expect(bob.page.getByRole("listitem").filter({ hasText: table })).toHaveCount(0);
});
