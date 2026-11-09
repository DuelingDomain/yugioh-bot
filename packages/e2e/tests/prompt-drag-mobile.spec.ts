import { test, expect, type Page } from "@playwright/test";

/** The share (0 to 1) of the first strip card that shows inside the panel box, after the panel's own clip. */
async function firstCardShare(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-prompt-panel]:not([data-precheck])");
    const card = panel?.querySelector("[data-card-strip] button");
    if (!panel || !card) return -1;
    const p = panel.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const w = Math.min(c.right, p.right) - Math.max(c.left, p.left);
    const h = Math.min(c.bottom, p.bottom) - Math.max(c.top, p.top);
    return Math.max(0, w) * Math.max(0, h) / (c.width * c.height);
  });
}

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

test("phone: the chain response strip shows its cards and buttons, upright and on its side", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/dev/table-preview/classic?state=chains&reduced=1");
  await page.getByRole("button", { name: "Yes", exact: true }).first().click();
  const panel = page.locator("[data-prompt-panel]:not([data-precheck])").first();
  await expect(panel.locator("[data-card-strip] button").first()).toBeVisible();
  expect(await firstCardShare(page)).toBeGreaterThanOrEqual(0.9);
  const box = await panel.boundingBox();
  const pass = await page.getByRole("button", { name: "Pass", exact: true }).boundingBox();
  expect(pass!.y + pass!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);

  // On its side the board box is about 180px high: the panel is a side sheet that leaves the left half of the board open.
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(panel.locator("[data-card-strip] button").first()).toBeVisible();
  expect(await firstCardShare(page)).toBeGreaterThanOrEqual(0.9);
  const side = await panel.boundingBox();
  expect(side!.width).toBeLessThan(740 * 0.55);
  expect(side!.x).toBeGreaterThan(740 * 0.4);
});
