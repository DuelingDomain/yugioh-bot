import { createReplayFixture } from "../helpers/replay";
import { test, expect } from "@playwright/test";
import { authFile } from "../helpers/players";

// The replay plays like a live spectator view: the board never changes size, the speed sticks, and the battle log has card images and seeks.
test("replay keeps a steady board, remembers its speed and offers a clickable battle log", async ({ browser }) => {
  test.setTimeout(180_000);
  const fixture = await createReplayFixture("1v1", 120, "public", true);
  const context = await browser.newContext({ storageState: authFile("p1"), viewport: { width: 1366, height: 768 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto(`/duels/${fixture.slug}/replay`);
  await expect(page.getByRole("group", { name: "Replay controls" })).toBeVisible({ timeout: 60_000 });

  const board = page.locator('section[aria-label="Replay field"] > div').first();
  const sizeOf = async () => {
    const box = (await board.boundingBox())!;
    return `${Math.round(box.width)}x${Math.round(box.height)}`;
  };
  const count = page.locator("[data-replay-counter], span").filter({ hasText: /^Move \d+ \/ \d+$/ }).first();
  const position = async () => Number((await count.textContent())!.match(/Move (\d+)/)![1]);
  const first = await sizeOf();

  // 1. Stepping through the replay (damage, chains, a result) never changes the board.
  const seen = new Set<string>([first]);
  for (let i = 0; i < 50; i++) {
    await page.getByRole("button", { name: "Next move" }).click();
    seen.add(await sizeOf());
  }
  expect([...seen], "board size while stepping").toEqual([first]);

  // 2. Playing at 4x with the real animations also keeps it still, and the playhead moves.
  await page.keyboard.press("Home");
  const speed = page.getByRole("slider", { name: "Playback speed" });
  await speed.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: /^Speed 4/ })).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  const playing = new Set<string>();
  for (let i = 0; i < 25; i++) {
    playing.add(await sizeOf());
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", { name: "Pause" }).click();
  expect([...playing], "board size while playing").toEqual([first]);
  expect(await position()).toBeGreaterThan(0);

  // 3. The speed is remembered for this viewer.
  await page.reload();
  await expect(page.getByRole("group", { name: "Replay controls" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Speed 4/ })).toBeVisible();

  // 4. The battle log shows card images, and a press on a row seeks to it.
  await page.keyboard.press("Home");
  const log = page.locator("[data-replay-battle-log]");
  await expect(log).toBeVisible();
  const withImage = log.locator("li img");
  await expect(withImage.first()).toBeVisible();
  expect(await withImage.count()).toBeGreaterThan(3);
  const seek = log.getByRole("button", { name: /^Go to: / });
  const target = seek.nth(Math.min(8, (await seek.count()) - 1));
  await target.click();
  await expect.poll(position).toBeGreaterThan(0);
  await expect(log.locator("[data-playhead]")).toHaveCount(1);
  expect(await sizeOf()).toBe(first);
  await context.close();
});
