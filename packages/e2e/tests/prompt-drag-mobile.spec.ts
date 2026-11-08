import { test, expect } from "@playwright/test";

test("phone: the centre prompt can be dragged and stays inside the board", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const response = await page.goto("/dev/table-preview/classic?state=summon&pick=material&reduced=1");
  expect(response?.ok()).toBe(true);
  const bar = page.locator("[data-prompt-surface]").first();
  const grip = page.locator("[data-drag-grip]").first();
  await expect(grip).toBeVisible();
  const before = await bar.boundingBox();
  const handle = await grip.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();
  const x = handle!.x + handle!.width / 2;
  const y = handle!.y + handle!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 150, { steps: 8 });
  await page.mouse.up();
  const after = await bar.boundingBox();
  expect(after!.y).toBeLessThan(before!.y - 100);
  expect(after!.y).toBeGreaterThanOrEqual(0);
  expect(after!.y + after!.height).toBeLessThanOrEqual(700);
});
