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

test("phone: a panel drags by its handle, and its Hide button and header stay clear of the handle", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const response = await page.goto("/dev/table-preview/classic?state=chains&reduced=1");
  expect(response?.ok()).toBe(true);
  await page.getByRole("button", { name: "Yes", exact: true }).first().click();
  const panel = page.locator("[data-prompt-panel]:not([data-precheck])").first();
  const grip = panel.locator("[data-drag-grip]");
  await expect(grip).toBeVisible();
  // The handle row sits above the header and the Hide button: a tap on Hide reaches the button, not the handle.
  const handle = await grip.boundingBox();
  const header = await panel.locator("header").boundingBox();
  const hide = page.getByRole("button", { name: "Hide to look at the board" });
  const hideBox = await hide.boundingBox();
  expect(header!.y).toBeGreaterThanOrEqual(handle!.y + handle!.height - 1);
  const hitIsHide = await hide.evaluate((el, at) => {
    const hit = document.elementFromPoint(at.x, at.y);
    return hit === el || el.contains(hit);
  }, { x: hideBox!.x + hideBox!.width / 2, y: hideBox!.y + 2 });
  expect(hitIsHide).toBe(true);
  // A drag by the handle moves the whole panel and keeps it on screen.
  const before = await panel.boundingBox();
  const x = handle!.x + handle!.width / 2;
  const y = handle!.y + handle!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 120, { steps: 8 });
  await page.mouse.up();
  const after = await panel.boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y + 60);
  expect(after!.y + after!.height).toBeLessThanOrEqual(700);
});
