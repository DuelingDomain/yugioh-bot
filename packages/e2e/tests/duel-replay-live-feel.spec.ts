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
  const lastMove = async () => Number((await count.textContent())!.match(/\/ (\d+)/)![1]);
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

  // 4. The battle log shows card images, lists only what has happened, and a press on a row seeks to it.
  const log = page.locator("[data-replay-battle-log]");
  await expect(log).toBeVisible();
  await page.keyboard.press("End");
  const seek = log.getByRole("button", { name: /^Go to: / });
  const withImage = log.locator("li img");
  await expect(withImage.first()).toBeVisible();
  expect(await withImage.count()).toBeGreaterThan(3);
  const atEnd = await seek.count();
  await seek.nth(Math.floor(atEnd / 3)).click();
  const midPosition = await position();
  expect(midPosition).toBeGreaterThan(0);
  expect(midPosition).toBeLessThan(await lastMove());
  await expect(log.locator("[data-playhead]")).toHaveCount(1);
  // The keys still work right after a click on a row.
  await page.keyboard.press("ArrowRight");
  await expect.poll(position).toBe(midPosition + 1);
  // Nothing after the playhead is listed (it could give away a Set card), until the viewer asks for the full log.
  expect(await seek.count()).toBeLessThan(atEnd);
  await log.getByRole("button", { name: "Full log" }).click();
  expect(await seek.count()).toBe(atEnd);
  await log.getByRole("button", { name: "Full log" }).click();
  expect(await sizeOf()).toBe(first);

  // 5. A finished duel opens with every hand face-up ("Show all cards"); turning it off hides the other hands again.
  const toggle = page.getByRole("button", { name: "Show all cards" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const opponentArt = page.locator('[data-hand-seat][data-side="opp"] img[src*="/api/cards/"]');
  await expect(opponentArt.first()).toBeVisible();
  expect(await opponentArt.count()).toBeGreaterThan(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(opponentArt).toHaveCount(0);
  await toggle.click();
  await expect(opponentArt.first()).toBeVisible();
  await context.close();
});
