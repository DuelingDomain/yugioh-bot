import { test, expect } from "../helpers/fixtures";
import { createTable, uniqueTableName } from "../helpers/duel";

// Flow c: a private lobby is hidden from other players; the organizer can close it.
test("a private lobby stays hidden from other players and Close removes it", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const table = uniqueTableName("live");

  await createTable(alice.page, table, { visibility: "private" });

  const listed = bob.page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/duels" && response.request().method() === "GET");
  await bob.page.goto("/duels");
  expect((await listed).ok()).toBe(true);
  await expect(bob.page.getByRole("heading", { name: "Live tables" })).toBeVisible();
  await expect(bob.page.getByText("Loading tables…")).toHaveCount(0);
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
