import { signInEffectSearch } from "../helpers/effect-search-login";
import { test, expect } from "@playwright/test";

test.skip(process.env.E2E_EFFECT_SEARCH === "0", "needs the effect-search E2E capability");

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`effect reading and stable card layout at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await signInEffectSearch(page.request);
    await page.goto("/decks/new");
    const cardsTab = page.getByRole("tab", { name: "Cards", exact: true });
    if (await cardsTab.isVisible()) await cardsTab.click();
    const browser = page.getByRole("complementary", { name: "Card list" });
    const search = browser.getByRole("searchbox", { name: "Search cards" });
    await search.fill("hand traps that negate");
    await expect(browser.getByRole("heading", { name: "Cards that do this" })).toBeVisible();
    await expect(browser).not.toContainText(/searchygo/i);
    await expect(page.getByText("Dueling Domain", { exact: true }).first()).toBeVisible();
    const reading = browser.getByRole("list", { name: "Effect reading" });
    await expect(reading.getByText("Role: hand trap", { exact: true })).toBeVisible();
    const tile = browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ }).first();
    await expect(tile).toBeVisible();
    const before = await tile.boundingBox();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await tile.hover();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (viewport.width >= 768) {
      await expect(page.getByLabel("Card summary").first()).toContainText(/hand trap/i);
      await expect(page.getByLabel("Card summary").first()).not.toContainText(/\bAI\b/);
    }
    const after = await tile.boundingBox();
    expect(after?.x).toBeCloseTo(before!.x, 1); expect(after?.y).toBeCloseTo(before!.y, 1);
    // All absolute corner/foot marks in a tile must occupy distinct rectangles.
    const overlaps = await tile.evaluate(element => {
      const marks = [...element.querySelectorAll<HTMLElement>("span")].filter(mark => getComputedStyle(mark).position === "absolute").map(mark => mark.getBoundingClientRect());
      return marks.flatMap((a, index) => marks.slice(index + 1).filter(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)).length;
    });
    expect(overlaps).toBe(0);
    // Let visible artwork settle before capturing layout evidence; offscreen
    // lazy images do not block this check.
    await expect.poll(() => browser.locator("img").evaluateAll(images => images.filter(image => {
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight;
    }).every(image => (image as HTMLImageElement).complete))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`effect-search-${viewport.width}.png`), fullPage: true });
    await reading.getByRole("button", { name: "Remove reading Role: hand trap", exact: true }).click();
    await expect(reading.getByText("Role: hand trap", { exact: true })).toHaveCount(0);
    await browser.getByRole("button", { name: "Exact text", exact: true }).click();
    await expect(browser.getByRole("list", { name: "Effect reading" })).toHaveCount(0);
    await expect(browser.getByRole("heading", { name: "Cards that do this" })).toHaveCount(0);
    await search.fill("Ash Blossom");
    await expect(browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
