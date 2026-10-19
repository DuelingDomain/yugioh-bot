import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

test.skip(process.env.E2E_EFFECT_SEARCH === "0", "needs the effect-search E2E capability");

// Screenshots for review. Set E2E_SHOT_DIR to keep them outside the test results.
const shotDir = process.env.E2E_SHOT_DIR;
if (shotDir) mkdirSync(shotDir, { recursive: true });

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`works with chip, release dates and newest sort at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
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

    // The e2e catalog has few tagged cards, so the server can rank none. Answer the insight ops with catalog cards, so partners and rows show.
    const catalog = await page.request.post("/api/decks/cards", { data: { text: "Veiler", mode: "normal", limit: 10 } });
    const known = ((await catalog.json()) as { cards: { code: number; name: string }[] }).cards.slice(0, 3);
    expect(known.length).toBeGreaterThan(0);
    await page.route("**/api/cards/insights", async (route) => {
      const body = route.request().postDataJSON() as { op?: string };
      if (body.op !== "worksWith") return route.fallback();
      await route.fulfill({ json: { effectSearchEnabled: true, attribution: "Effect search powered by searchygo", cards: known.map((card, index) => ({
        passcode: card.code, name: card.name, score: 10 - index, linkedCards: 2 - Math.min(index, 1), reason: `Negates monster effects, like ${index === 0 ? "Ash Blossom" : "Effect Veiler"}.`,
      })) } });
    });

    // Works with: the hover icon sets a gold chip and lists partners of the card.
    await search.fill("Ash Blossom");
    const tile = browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ }).first();
    await expect(tile).toBeVisible();
    await tile.hover();
    const works = browser.getByRole("button", { name: "Find cards that work with Ash Blossom & Joyous Spring" }).first();
    if (phone) await tile.focus();
    await expect(works).toBeVisible();
    // The icon sits on the art, clear of the limit, art, points and copy marks.
    const overlaps = await works.evaluate((icon) => {
      const box = icon.getBoundingClientRect();
      const marks = [...(icon.parentElement?.querySelectorAll<HTMLElement>("button > span") ?? [])]
        .filter((mark) => getComputedStyle(mark).position === "absolute")
        .map((mark) => mark.getBoundingClientRect());
      return marks.filter((m) => Math.min(box.right, m.right) - Math.max(box.left, m.left) > 1 && Math.min(box.bottom, m.bottom) - Math.max(box.top, m.top) > 1).length;
    });
    expect(overlaps).toBe(0);
    const before = await tile.boundingBox();
    await shot("works-with-icon");
    await works.click();
    const chip = browser.getByRole("list", { name: "Works with" });
    await expect(chip.getByText("Ash Blossom & Joyous Spring")).toBeVisible();
    // The search text is cleared, so the partners show: the count is above 0 and a partner tile is in the list.
    await expect(search).toHaveValue("");
    await expect(browser.getByText(/^[1-9][\d,]* cards? works? with Ash Blossom/)).toBeVisible();
    await expect(browser.getByRole("button", { name: new RegExp(`^${known[0]!.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first()).toBeVisible();
    // The card does not move, and the partner list never holds the card itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(browser.getByRole("button", { name: /^Ash Blossom & Joyous Spring/ })).toHaveCount(0);
    expect(before).not.toBeNull();
    await expect(browser.getByText("Updating…")).toHaveCount(0);
    await shot("works-with-chip");
    await chip.getByRole("button", { name: "Remove Works with Ash Blossom & Joyous Spring" }).click();
    await expect(chip).toHaveCount(0);

    // The W key does the same from a focused tile.
    await search.fill("Ash Blossom");
    await tile.focus();
    await page.keyboard.press("w");
    await expect(browser.getByRole("list", { name: "Works with" })).toBeVisible();
    await browser.getByRole("button", { name: "Remove Works with Ash Blossom & Joyous Spring" }).click();
    await search.fill("Ash Blossom");

    // The Suggestions tab is gone: the deck pane has no Deck | Suggestions switch and no Suggestions section.
    await expect(page.getByRole("group", { name: "Deck pane" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Suggestions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Suggestions" })).toHaveCount(0);

    // Release dates: the reading shows a removable date chip, like the other reading chips.
    await search.fill("before 2010");
    const reading = browser.getByRole("list", { name: "Effect reading" });
    const dateChip = reading.getByRole("button", { name: "Remove reading Released: before 2010" });
    await expect(dateChip).toBeVisible({ timeout: 30_000 });
    await expect(browser.getByText("Effect search powered by searchygo", { exact: true })).toBeVisible();
    await expect(browser).not.toContainText(/\bAI\b/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // The chip text does not run over its neighbours: no chip box crosses another.
    const crossing = await reading.evaluate((list) => {
      const boxes = [...list.querySelectorAll("button")].map((node) => node.getBoundingClientRect());
      return boxes.filter((a, i) => boxes.some((b, j) => i < j && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)).length;
    });
    expect(crossing).toBe(0);
    await shot("release-chip");
    await dateChip.click();
    await expect(reading.getByRole("button", { name: /Released: before 2010/ })).toHaveCount(0);

    // "Newest first" is a sort choice. The order button does not reverse it, so it is off while this sort is on.
    await search.fill("");
    const newestResponse = page.waitForResponse(response => response.url().endsWith("/api/decks/cards") && response.request().postDataJSON()?.sort === "newest");
    await browser.getByLabel("Sort by").selectOption({ label: "Newest first" });
    const newest = (await (await newestResponse).json()).cards as { name: string; release?: { date?: string } }[];
    expect(newest.length).toBeGreaterThanOrEqual(2);
    expect(newest[0]!.release?.date).toBeTruthy();
    expect(newest[1]!.release?.date).toBeTruthy();
    expect(newest[0]!.release!.date! >= newest[1]!.release!.date!).toBe(true);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(browser.getByRole("button", { name: new RegExp(`^${escape(newest[0]!.name)}`) }).first()).toBeVisible();
    await expect(browser.getByRole("button", { name: new RegExp(`^${escape(newest[1]!.name)}`) }).first()).toBeVisible();
    const firstBox = await browser.getByRole("button", { name: new RegExp(`^${escape(newest[0]!.name)}`) }).first().boundingBox();
    const secondBox = await browser.getByRole("button", { name: new RegExp(`^${escape(newest[1]!.name)}`) }).first().boundingBox();
    expect(firstBox && secondBox && (firstBox.y < secondBox.y || firstBox.y === secondBox.y && firstBox.x < secondBox.x)).toBe(true);
    const order = browser.getByRole("button", { name: /^Newest first\. The order does not change/ });
    await expect(order).toBeDisabled();
    await expect(browser.getByText("Updating…")).toHaveCount(0);
    await expect(browser.getByRole("button").filter({ has: page.locator("img") }).first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await shot("newest-sort");
  });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`How it plays panel above the effect hits at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const phone = viewport.width < 768;
    await page.setViewportSize(viewport);
    const login = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
    expect(login.status()).toBe(200);
    // The e2e database holds no archetype profiles, so the profile of the real response is a fixture.
    const guide = {
      archetype: "Blue-Eyes",
      plan: "Summon Blue-Eyes White Dragon again and again, then end the turn on a boss monster that your opponent cannot easily answer. ".repeat(4).trim(),
      hooks: [
        { label: "Dragon search", why: "Adds a Blue-Eyes card from the Deck, so the plan starts every turn.", searchable: true },
        { label: "Level 8 support", why: "Any Level 8 Dragon can be a second body.", searchable: true },
        { label: "Graveyard recursion", why: "Brings the dragons back after a board wipe.", searchable: false },
        { label: "Fusion engine", why: "Makes the big Fusion monsters.", searchable: true },
      ],
    };
    await page.route("**/api/decks/cards", async (route) => {
      const body = route.request().postDataJSON() as { text?: string; offset?: number };
      if (!/blue-eyes/i.test(body.text ?? "")) return route.fallback();
      const response = await route.fetch();
      const data = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...data, effectSearchEnabled: true, ...((body.offset ?? 0) === 0 ? { profile: guide } : {}) } });
    });
    let hookRequest: { archetype?: string; hook?: number } | null = null;
    await page.route("**/api/cards/insights", async (route) => {
      const body = route.request().postDataJSON() as { op?: string; archetype?: string; hook?: number };
      if (body.op !== "hookSearch") return route.fallback();
      hookRequest = body;
      await route.fulfill({ json: { effectSearchEnabled: true, attribution: "Effect search powered by searchygo", cards: [] } });
    });
    await page.goto("/decks/new");
    const cardsTab = page.getByRole("tab", { name: "Cards", exact: true });
    if (await cardsTab.isVisible()) await cardsTab.click();
    const browser = page.getByRole("complementary", { name: "Card list" });
    await browser.getByRole("searchbox", { name: "Search cards" }).fill("Blue-Eyes synergies");

    const panel = browser.getByTestId("how-it-plays");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("Blue-Eyes");
    await expect(panel).not.toContainText(/\bAI\b/);
    // The plan is three lines until "More"; three hooks are shown until "Show all".
    const plan = panel.getByTestId("how-it-plays-plan");
    const clamped = (await plan.boundingBox())!.height;
    await panel.getByRole("button", { name: "More" }).click();
    expect((await plan.boundingBox())!.height).toBeGreaterThan(clamped);
    await panel.getByRole("button", { name: "Less" }).click();
    await expect(panel.getByTestId("how-it-plays-hook").or(panel.getByTestId("how-it-plays-hook-text"))).toHaveCount(3);
    await panel.getByRole("button", { name: /^Show all/ }).click();
    await expect(panel.getByTestId("how-it-plays-hook").or(panel.getByTestId("how-it-plays-hook-text"))).toHaveCount(4);
    await panel.getByRole("button", { name: "Show fewer" }).click();

    // Nothing moves on hover, and the panel does not run over the page.
    const hook = panel.getByTestId("how-it-plays-hook").first();
    const before = await hook.boundingBox();
    await hook.hover();
    expect(await hook.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    // A hook with data runs a search for the cards that fit it; the same row again goes back.
    await hook.click();
    await expect(browser.getByRole("list", { name: "Works with" }).getByText("Dragon search")).toBeVisible();
    expect(hookRequest).toMatchObject({ archetype: "Blue-Eyes", hook: 0 });
    await browser.getByRole("button", { name: "Remove Fits Dragon search" }).click();
    await expect(browser.getByRole("list", { name: "Works with" })).toHaveCount(0);
    if (!phone) await expect(browser.getByText("Effect search powered by searchygo", { exact: true })).toBeVisible();
    void testInfo;
  });
}
