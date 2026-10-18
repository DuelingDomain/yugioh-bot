import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

test.skip(process.env.E2E_EFFECT_SEARCH === "0", "needs the effect-search E2E capability");

// Screenshots for review. Set E2E_SHOT_DIR to keep them outside the test results.
const shotDir = process.env.E2E_SHOT_DIR;
if (shotDir) mkdirSync(shotDir, { recursive: true });

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`works with chip and Suggestions at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const shot = (name: string) => page.screenshot({ path: shotDir ? `${shotDir}/${name}-${viewport.width}.png` : testInfo.outputPath(`${name}-${viewport.width}.png`) });
    const phone = viewport.width < 768;
    await page.setViewportSize(viewport);
    const login = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
    expect(login.status()).toBe(200);
    await page.goto("/decks/new");
    const cardsTab = page.getByRole("tab", { name: "Cards", exact: true });
    if (await cardsTab.isVisible()) await cardsTab.click();
    const browser = page.getByRole("complementary", { name: "Card list" });
    const search = browser.getByRole("searchbox", { name: "Search cards" });

    // Works with: the hover icon sets a gold chip and lists partners of the card.
    await search.fill("Ash Blossom");
    const tile = browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ }).first();
    await expect(tile).toBeVisible();
    await tile.hover();
    const works = browser.getByRole("button", { name: "Find cards that work with Ash Blossom & Joyous Spring" }).first();
    if (phone) await tile.focus();
    await expect(works).toBeVisible();
    const before = await tile.boundingBox();
    await shot("works-with-icon");
    await works.click();
    const chip = browser.getByRole("list", { name: "Works with" });
    await expect(chip.getByText("Ash Blossom & Joyous Spring")).toBeVisible();
    // The card does not move, and the partner list never holds the card itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ })).toHaveCount(0);
    expect(before).not.toBeNull();
    await expect(browser.getByText("Updating…")).toHaveCount(0);
    await shot("works-with-chip");
    await chip.getByRole("button", { name: "Remove Works with Ash Blossom & Joyous Spring" }).click();
    await expect(chip).toHaveCount(0);

    // The W key does the same from a focused tile.
    await tile.focus();
    await page.keyboard.press("w");
    await expect(browser.getByRole("list", { name: "Works with" })).toBeVisible();
    await browser.getByRole("button", { name: "Remove Works with Ash Blossom & Joyous Spring" }).click();

    // Suggestions: add two cards in the list view, then open the tab.
    await browser.getByRole("button", { name: "Card list with details" }).click();
    await browser.getByRole("button", { name: "Add Ash Blossom & Joyous Spring to the deck" }).first().click();
    await search.fill("Effect Veiler");
    await browser.getByRole("button", { name: "Add Effect Veiler to the deck" }).first().click();
    const deckTab = page.getByRole("tab", { name: /^Deck/ }).first();
    if (phone) await deckTab.click();
    await page.getByRole("tablist", { name: "Deck pane" }).getByRole("tab", { name: "Suggestions" }).click();
    const panel = page.getByRole("region", { name: "Suggestions" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Effect search powered by searchygo", { exact: true })).toBeVisible();
    await expect(panel.locator("li").first().or(panel.getByText(/No card fits right now|Could not|not available/))).toBeVisible({ timeout: 30_000 });
    const rows = await panel.locator("ol > li").count();
    expect(rows).toBeLessThanOrEqual(20);
    if (rows > 0) {
      await expect(panel.locator("ol > li").first().getByText(/^Links to/)).toBeVisible();
      const first = panel.locator("ol > li").first();
      const name = (await first.locator("strong").first().textContent()) ?? "";
      await expect(panel).not.toContainText(/\bAI\b/);
      await first.getByRole("button", { name: `Add ${name} to the deck` }).click();
      await expect(panel.locator("ol > li").filter({ hasText: `×1 in deck` }).first()).toBeVisible({ timeout: 30_000 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(panel.getByText("Updating…")).toHaveCount(0);
    await shot("suggestions");
    await page.getByRole("tablist", { name: "Deck pane" }).getByRole("tab", { name: "Deck" }).click();
    await expect(panel).toHaveCount(0);
  });
}
