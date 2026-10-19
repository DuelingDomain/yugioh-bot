import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { webUrl } from "../stack/env.mjs";

test.skip(process.env.E2E_EFFECT_SEARCH === "0", "needs the effect-search E2E capability");

// Pictures for the review. The folder is outside the repo checkout on purpose.
const SHOTS = process.env.CUBE_UI_SHOTS ?? "/home/sulman633/repos/yugioh-bot/data/briefs/effect-search/cube-ui";
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
];

async function signIn(page: Page) {
  const login = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
  expect(login.status()).toBe(200);
}

async function newCube(page: Page, name: string): Promise<number> {
  const res = await page.request.post("/api/cubes", { data: { kind: "blank", name: `${name} ${Date.now()}` } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { cube: { id: number } }).cube.id;
}

/** The rail sits beside the cards on a wide screen and in a bottom sheet on a narrow one. */
async function openRail(page: Page) {
  // The cube loads after the page: wait for it before looking for the sheet button.
  await expect(page.getByRole("heading", { name: "Cube check" })).toBeVisible();
  const open = page.getByRole("button", { name: "Add cards", exact: true });
  const tabs = page.getByRole("group", { name: "Add by" }).and(page.locator(":visible"));
  if (await open.isVisible().catch(() => false)) {
    // The click can land before the page is interactive, so it is repeated until the sheet is open.
    await expect(async () => {
      await open.click();
      await expect(tabs).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  }
  return tabs;
}

/**
 * On a phone the rail is hidden and a bottom sheet holds a second copy of it, so a test id can match two elements.
 * The visible one is the one a player uses.
 */
const tid = (scope: Page | Locator, id: string) => scope.locator(`[data-testid="${id}"]:visible`);

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// Hand traps and removal that the effect tags know. A fresh stack can start with an empty card catalog (the worker fills it
// in the background and can lose a database lock at start), and an effect search only ranks cards the catalog holds.
// Adding them to a scratch cube loads their rows, the same way a player's add does.
const WARM_IDS = [
  14558127, 23434538, 97268402, 59438930, 94145021, 27204311, 73642296, 42141493, 10045474, 24224830, 12580477, 53129443,
  24299458, 14532163, 15693423, 43898403, 8267140, 18144506, 84211599, 52038441,
];

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: webUrl });
  try {
    const login = await api.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
    expect(login.status()).toBe(200);
    const made = await api.post("/api/cubes", { data: { kind: "blank", name: `Catalog warm ${Date.now()}` } });
    expect(made.status()).toBe(201);
    const id = ((await made.json()) as { cube: { id: number } }).cube.id;
    for (const entry of WARM_IDS) {
      // One card at a time: a passcode the card database does not know must not block the others.
      await api.post(`/api/cubes/${id}/cards`, { data: { op: "addBatch", entries: [{ id: entry, copies: 1 }] } });
    }
  } finally {
    await api.dispose();
  }
});

for (const viewport of VIEWPORTS) {
  test(`describe, batch add and phrase seed in the cube editor at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    const cubeId = await newCube(page, `Describe ${viewport.width}`);
    await page.goto(`/cubes/${cubeId}`);
    await openRail(page);

    // Describe mode sits next to name search, in the same tab.
    await tid(page, "mode-describe").click();
    const input = tid(page, "describe-input");
    await input.fill("hand traps that negate");
    const rows = tid(page, "effect-result");
    await expect(rows.first()).toBeVisible();
    await expect(tid(page, "reading-chips")).toContainText("hand trap", { ignoreCase: true });
    await expect(page.getByText(/searchygo/i)).toHaveCount(0);
    await expect(tid(page, "effect-reason").first()).not.toBeEmpty();
    expect(await rows.count()).toBeGreaterThan(3);

    // Hover opens the written summary and nothing in the list moves.
    const firstRow = rows.first();
    await page.mouse.move(0, 0);
    const before = await firstRow.boundingBox();
    await firstRow.hover();
    await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("tooltip")).not.toContainText(/\bAI\b/);
    const after = await firstRow.boundingBox();
    expect(after?.x).toBeCloseTo(before!.x, 1);
    expect(after?.y).toBeCloseTo(before!.y, 1);
    expect(after?.height).toBeCloseTo(before!.height, 1);
    await page.mouse.move(0, 0);

    // Click, then shift-click a range.
    await firstRow.click();
    await expect(tid(page, "batch-bar")).toContainText("1 selected");
    await rows.nth(3).click({ modifiers: ["Shift"] });
    await expect(tid(page, "batch-bar")).toContainText("4 selected");
    await tid(page, "effect-select-all").click();
    const picked = await rows.count();
    await expect(tid(page, "batch-bar")).toContainText(`${picked} selected`);
    await expect(tid(page, "batch-add")).toHaveText(new RegExp(`Add ${picked} to cube`));
    expect(await noOverflow(page)).toBe(true);
    // The floating report button must leave the batch's primary action clear at every width.
    await expect.poll(() => tid(page, "batch-add").evaluate(add => {
      const fab = document.querySelector<HTMLElement>("[data-bug-fab]");
      if (!fab || !fab.getClientRects().length) return false;
      const a = add.getBoundingClientRect(), b = fab.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    })).toBe(false);
    await page.screenshot({ path: join(SHOTS, `describe-batch-${viewport.width}x${viewport.height}.png`) });

    // A catalog/era response after an edit must not rerank the open Describe session.
    const rowIds = () => rows.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-card-id")));
    const beforeAddIds = await rowIds();
    const rowOffset = () => rows.first().evaluate(node => node.getBoundingClientRect().top - node.closest('[data-testid="describe-pane"]')!.getBoundingClientRect().top);
    const beforeAddOffset = await rowOffset();
    let describeRequests = 0;
    page.on("request", request => {
      if (request.url().endsWith("/api/cards/resolve") && request.postDataJSON()?.op === "effectSearch") describeRequests++;
    });
    const eraResponse = page.waitForResponse(response => response.url().endsWith(`/api/cubes/${cubeId}/era`));
    await tid(page, "batch-add").click();
    await expect(tid(page, "batch-bar")).toContainText(/Added \d+ cards?/);
    const entry = page.getByRole("list", { name: "Added lists" }).and(page.locator(":visible")).getByRole("listitem").first();
    await expect(entry).toContainText("Search batch");
    await expect(rows.first()).toContainText(/in cube/);
    await eraResponse;
    // Observe beyond the old 600 ms era delay plus the 350 ms search debounce.
    await page.waitForTimeout(1100);
    expect(describeRequests).toBe(0);
    expect(await rowIds()).toEqual(beforeAddIds);
    expect(await rowOffset()).toBeCloseTo(beforeAddOffset, 1);
    const era = tid(page, "era-note");
    await expect(era).toHaveCount(0);
    // Reopening Describe starts a new session and adopts the updated cube era.
    const modes = page.getByRole("group", { name: "Find cards by" }).and(page.locator(":visible"));
    await modes.getByRole("button", { name: "Name", exact: true }).click();
    await tid(page, "mode-describe").click();
    await expect(era).toContainText(/^Matching this cube's era: \d{4}(–\d{4})?/);
    await expect(era).not.toContainText(/\bAI\b/);
    await tid(page, "describe-sort").selectOption("newest");
    await expect(era).toHaveCount(0);
    await tid(page, "describe-sort").selectOption("match");
    await expect(era).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `batch-added-${viewport.width}x${viewport.height}.png`) });
    await entry.getByRole("button", { name: /Remove Search batch/ }).click();
    await expect(page.getByRole("list", { name: "Added lists" }).and(page.locator(":visible"))).toHaveCount(0);
    await expect(rows.first()).not.toContainText(/in cube/);

    // A date in the text reads as a removable chip, like the other chips.
    await input.fill("hand traps before 2015");
    const dateChip = tid(page, "reading-chips").getByRole("button", { name: /Switch off Released: before 2015/ });
    await expect(dateChip).toBeVisible({ timeout: 30_000 });
    await dateChip.click();
    await expect(tid(page, "reading-chips").getByRole("button", { name: /Turn on Released: before 2015/ })).toBeVisible({ timeout: 30_000 });
    // "Newest first" is a sort choice in Describe mode.
    await input.fill("hand traps that negate");
    await expect(rows.first()).toBeVisible();
    const newestResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/resolve") && response.request().postDataJSON()?.sort === "newest");
    await tid(page, "describe-sort").selectOption("newest");
    await newestResponse;
    await expect(rows.first()).toBeVisible();
    const firstIds = (await rowIds()).slice(0, 2).map(Number);
    expect(firstIds).toHaveLength(2);
    const releaseResponse = await page.request.post("/api/decks/cards", { data: { text: "", mode: "normal", passcodes: firstIds } });
    expect(releaseResponse.status()).toBe(200);
    const dated = (await releaseResponse.json()).cards as { code: number; release?: { date?: string } }[];
    const dates = firstIds.map(id => dated.find(card => card.code === id)?.release?.date);
    expect(dates.every(Boolean)).toBe(true);
    expect(dates[0]! >= dates[1]!).toBe(true);
    await expect(tid(page, "reading-chips")).toContainText("hand trap", { ignoreCase: true });
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `describe-newest-${viewport.width}x${viewport.height}.png`) });
    await tid(page, "describe-sort").selectOption("match");
    await expect(rows.first()).toBeVisible();

    // Name search is still there and still adds one card at once.
    await page.getByRole("group", { name: "Find cards by" }).and(page.locator(":visible")).getByRole("button", { name: "Name", exact: true }).click();
    await expect(page.getByLabel("Card name").and(page.locator(":visible"))).toBeVisible();
  });

  test(`seed from a phrase previews reasons and confirms at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    const cubeId = await newCube(page, `Seed ${viewport.width}`);
    await page.goto(`/cubes/${cubeId}`);
    const tabs = await openRail(page);
    await tabs.getByRole("button", { name: "Archetype", exact: true }).click();

    await tid(page, "phrase-input").fill("hand traps and removal");
    await tid(page, "phrase-preview").click();
    const panel = tid(page, "phrase-preview-panel");
    await expect(panel).toBeVisible();
    const rows = tid(panel, "phrase-row");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText(/\S/);
    const count = await rows.count();
    expect(count).toBeGreaterThan(2);
    await expect(panel).not.toContainText(/searchygo/i);
    await page.screenshot({ path: join(SHOTS, `phrase-preview-${viewport.width}x${viewport.height}.png`) });

    // Remove a row, then confirm what is left.
    const confirm = tid(page, "phrase-confirm");
    const startLabel = await confirm.innerText();
    await rows.first().getByRole("button", { name: /^Remove / }).click();
    await expect(confirm).not.toHaveText(startLabel);
    await confirm.click();
    await expect(page.getByRole("list", { name: "Added lists" }).and(page.locator(":visible")).getByRole("listitem").first()).toContainText("Seed:");
    await expect(tid(page, "phrase-preview-panel")).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `phrase-added-${viewport.width}x${viewport.height}.png`) });

    // A second preview reads the cube's cards: it says the results lean toward their years.
    await tid(page, "phrase-input").fill("removal");
    await tid(page, "phrase-preview").click();
    const second = tid(page, "phrase-preview-panel");
    await expect(second).toBeVisible();
    await expect(tid(second, "era-note")).toContainText(/Matching this cube's era: \d{4}(–\d{4})?/);
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: join(SHOTS, `phrase-era-${viewport.width}x${viewport.height}.png`) });
  });
}
