import { signInEffectSearch } from "../helpers/effect-search-login";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { webUrl } from "../stack/env.mjs";

test.skip(process.env.E2E_EFFECT_SEARCH === "0", "needs the effect-search E2E capability");

// Pictures for the review. The folder is outside the repo checkout on purpose.
const SHOTS = process.env.DRAFT_UI_SHOTS ?? "/home/sulman633/repos/yugioh-bot/data/briefs/effect-search/draft-ui";
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
];

async function signIn(page: Page) {
  await signInEffectSearch(page.request);
}

/** A phone keeps a second copy of some panes in a sheet, so a test id can match two elements: the visible one is the one a player uses. */
const tid = (scope: Page | Locator, id: string) => scope.locator(`[data-testid="${id}"]:visible`);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// Hand traps and removal that the effect tags know. A fresh stack can start with an empty card catalog, and an
// effect search only ranks cards the catalog holds. Adding them to a scratch cube loads their rows.
const WARM_IDS = [
  14558127, 23434538, 97268402, 59438930, 94145021, 27204311, 73642296, 42141493, 10045474, 24224830, 12580477, 53129443,
  24299458, 14532163, 15693423, 43898403, 8267140, 18144506, 84211599, 52038441,
];

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: webUrl });
  try {
    await signInEffectSearch(api);
    const made = await api.post("/api/cubes", { data: { kind: "blank", name: `Draft catalog warm ${Date.now()}` } });
    expect(made.status()).toBe(201);
    const id = ((await made.json()) as { cube: { id: number } }).cube.id;
    for (const entry of WARM_IDS) await api.post(`/api/cubes/${id}/cards`, { data: { op: "addBatch", entries: [{ id: entry, copies: 1 }] } });
  } finally {
    await api.dispose();
  }
});

/** How many of the player's cubes carry this name. Other tests make cubes at the same time, so a count of all cubes would race. */
async function cubesNamed(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/cubes");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { cubes?: Array<{ name: string }> } | Array<{ name: string }>;
  const list = Array.isArray(body) ? body : (body.cubes ?? []);
  return list.filter(cube => cube.name === name).length;
}

async function newThemeDraft(page: Page, name: string): Promise<string> {
  const config = { mode: "theme", themeSelection: "player_pick", themePackSize: 3, cardsPerPlayer: 40, extraDeckEnabled: false, allowedCubeIds: [] };
  const res = await page.request.post("/api/drafts", { data: { name, config } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { webSlug: string }).webSlug;
}

// A theme cube is named for its phrase and a name is unique per player, so each viewport describes its own theme.
const THEME_PHRASES: Record<number, string> = {
  1920: "hand traps and removal",
  2560: "hand traps that negate",
  1366: "hand traps",
  390: "negate hand traps",
};

for (const viewport of VIEWPORTS) {
  test(`pool editor describe tab records a removable batch at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page.goto("/drafts/new/cube");
    // On a phone the sources are the first tab of the bottom bar; the Cards source is the default one.
    const mode = tid(page, "mode-describe");
    const sources = page.getByRole("button", { name: "Sources", exact: true }).and(page.locator(":visible"));
    if (viewport.width < 600) {
      await expect(async () => {
        await sources.first().click();
        await expect(mode).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 15_000 });
    }
    await mode.click();
    await tid(page, "describe-input").fill("hand traps that negate");
    const rows = tid(page, "effect-result");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(3);
    await rows.first().click();
    await rows.nth(2).click({ modifiers: ["Shift"] });
    await expect(tid(page, "batch-bar")).toContainText("3 selected");
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `pool-describe-${viewport.width}x${viewport.height}.png`) });

    await tid(page, "batch-add").click();
    await expect(tid(page, "batch-bar")).toContainText(/Added \d+ cards?/);
    // On a phone the pool, and the list of added batches above it, is the next tab.
    if (viewport.width < 600) await page.getByRole("button", { name: /^Pool/ }).and(page.locator(":visible")).first().click();
    // The batch is in the import ledger: a "Search batch" entry that Remove takes out again.
    const entry = page.getByRole("list", { name: "Added lists" }).and(page.locator(":visible")).getByRole("listitem").first();
    await expect(entry).toContainText("Search batch");
    await page.screenshot({ path: join(SHOTS, `pool-batch-added-${viewport.width}x${viewport.height}.png`) });
    await entry.getByRole("button", { name: /Remove Search batch/ }).click();
    await expect(page.getByRole("list", { name: "Added lists" }).and(page.locator(":visible"))).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  });

  test(`theme lobby describe a theme and pool health at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    const slug = await newThemeDraft(page, `Theme lobby ${viewport.width}`);
    await page.goto(`/draft/${slug}`);
    const tools = page.getByRole("group", { name: "Add a theme" }).and(page.locator(":visible"));
    await expect(tools).toBeVisible();
    const phrase = THEME_PHRASES[viewport.width]!;
    expect(await cubesNamed(page, phrase)).toBe(0);

    await tid(page, "phrase-input").fill(phrase);
    await tid(page, "phrase-preview").click();
    const panel = tid(page, "phrase-preview-panel");
    await expect(panel).toBeVisible();
    await expect(tid(panel, "phrase-row").first()).toBeVisible();
    // A preview writes nothing: no cube exists until the host confirms.
    expect(await cubesNamed(page, phrase)).toBe(0);
    await page.screenshot({ path: join(SHOTS, `theme-preview-${viewport.width}x${viewport.height}.png`) });

    await tid(page, "phrase-confirm").click();
    await expect(tid(page, "phrase-preview-panel")).toHaveCount(0);
    expect(await cubesNamed(page, phrase)).toBe(1);
    // The lobby re-checks the themes it holds and shows one health block.
    await expect(page.getByTestId("pool-health").and(page.locator(":visible")).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Pool health" }).and(page.locator(":visible")).first()).toBeVisible();
    // The health block names the cube's release years.
    await expect(page.getByTestId("pool-era").and(page.locator(":visible")).first()).toContainText(/^Cube era: \d{4}(–\d{4})?$/);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `theme-health-${viewport.width}x${viewport.height}.png`) });
  });
}
