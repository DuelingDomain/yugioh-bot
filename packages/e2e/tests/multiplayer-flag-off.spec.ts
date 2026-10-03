import { test, expect } from "../helpers/fixtures";
import { uniqueTableName } from "../helpers/duel";

// MULTIPLAYER_TABLES off: only 1v1 tables. Runs only on a stack started with E2E_MULTIPLAYER_TABLES=0.
// (The default E2E stack has the flag on, so the multi-seat specs run.)
test.skip(process.env.E2E_MULTIPLAYER_TABLES !== "0", "needs a stack with E2E_MULTIPLAYER_TABLES=0");

test("the creator offers no Tag, 3-player or 4-player table", async ({ player }) => {
  const alice = await player("p1");
  await alice.page.goto("/duels/new");
  await expect(alice.page.getByRole("heading", { name: "Format" })).toBeVisible();
  await expect(alice.page.getByLabel("Table type")).toHaveCount(0);
  await expect(alice.page.getByTestId("format-rule")).toHaveCount(0);
  const text = (await alice.page.locator("main").innerText()) ?? "";
  expect(text).not.toMatch(/\bTag\b|3-player|4-player|FFA/);
});

test("the API refuses a Tag, 3-player and 4-player table and makes no table", async ({ player }) => {
  const alice = await player("p1");
  for (const format of ["tag", "ffa3", "ffa4"]) {
    const response = await alice.context.request.post("/api/duels", {
      data: { name: uniqueTableName("flag"), mode: "normal", format },
    });
    expect(response.status(), format).toBe(403);
    expect(((await response.json()) as { error: string }).error).toMatch(/Only 1v1 tables/);
  }
  const listed = await alice.context.request.get("/api/duels");
  const body = (await listed.json()) as { duels: Array<{ format?: string }> };
  expect(body.duels.filter((duel) => duel.format && duel.format !== "1v1")).toHaveLength(0);
  const made = await alice.context.request.post("/api/duels", { data: { name: uniqueTableName("flag"), mode: "normal" } });
  expect(made.status()).toBe(201);
});
