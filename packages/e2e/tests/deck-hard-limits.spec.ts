import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { duelDataDir } from "../stack/env.mjs";

// The deck editor holds 60 Main, 15 Extra and 15 Side at most. Every way to add a card refuses past that.
const LIMITS = { main: 60, extra: 15, side: 15 } as const;

/** Distinct card passcodes and names from the read-only card database the duel host uses. */
function cardsOfType(type: number, take: number, skip = 0): { id: number; name: string }[] {
  const db = new DatabaseSync(join(duelDataDir, "cards.cdb"), { readOnly: true });
  try {
    return db
      .prepare("SELECT d.id AS id, t.name AS name FROM datas d JOIN texts t ON t.id = d.id WHERE d.alias = 0 AND d.type = ? AND d.id < 100000000 ORDER BY d.id LIMIT ? OFFSET ?")
      .all(type, take, skip) as { id: number; name: string }[];
  } finally {
    db.close();
  }
}

const NORMAL_MONSTER = 17;
const FUSION_MONSTER = 65;

function fullDeck() {
  const normals = cardsOfType(NORMAL_MONSTER, 400);
  const fusions = cardsOfType(FUSION_MONSTER, 60);
  return {
    main: normals.slice(0, LIMITS.main).map((card) => card.id),
    extra: fusions.slice(0, LIMITS.extra).map((card) => card.id),
    side: normals.slice(LIMITS.main, LIMITS.main + LIMITS.side).map((card) => card.id),
    spare: normals[LIMITS.main + LIMITS.side + 20],
    spareFusion: fusions[LIMITS.extra + 5],
    normals,
    fusions,
  };
}

const count = (page: Page, section: keyof typeof LIMITS) => page.locator(`section[data-section="${section}"] ul > li`).count();
const notice = (page: Page) => page.locator('p[role="status"]').filter({ hasText: "is full" });

async function openFullDeck(page: Page, name: string) {
  const deck = fullDeck();
  const created = await page.request.post("/api/decks", { data: { name, mode: "normal", deck: { main: deck.main, extra: deck.extra, side: deck.side } } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).deck.id as number;
  await page.goto(`/decks/${id}`);
  await expect(page.getByTestId("main-full")).toHaveText("Main Deck is full (60/60)");
  await expect(page.getByTestId("extra-full")).toHaveText("Extra Deck is full (15/15)");
  await expect(page.getByTestId("side-full")).toHaveText("Side Deck is full (15/15)");
  expect([await count(page, "main"), await count(page, "extra"), await count(page, "side")]).toEqual([60, 15, 15]);
  return { deck, id };
}

async function searchFor(page: Page, name: string): Promise<Locator> {
  const search = page.locator('input[type="search"]').first();
  await search.fill(name);
  const result = page.locator(`#deck-editor-cards button[aria-label^="${name.replace(/"/g, '\\"')}"]`).first();
  await expect(result).toBeVisible();
  return result;
}

test("a full deck takes no card from the add button, double click, stepper or keyboard", async ({ player }) => {
  const { page } = await player("p1");
  const { deck } = await openFullDeck(page, "Hard limits: add");

  // The card browser add button is off and says why.
  const tile = await searchFor(page, deck.spare.name);
  const rowAdd = page.getByRole("button", { name: `Add ${deck.spare.name} to the deck` });
  if (await rowAdd.count()) {
    await expect(rowAdd.first()).toBeDisabled();
    await expect(rowAdd.first()).toHaveAttribute("title", "Main Deck is full (60/60).");
  }

  // Double click and right click on a result.
  await tile.dblclick();
  await expect(notice(page)).toContainText("Main Deck is full (60/60).");
  await tile.click({ button: "right" });
  expect(await count(page, "main")).toBe(60);

  // The Add stepper of the inspected card is refused.
  await tile.click();
  const addMain = page.getByRole("button", { name: new RegExp(`^Add one ${deck.spare.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} to Main`) });
  await expect(addMain).toHaveAttribute("aria-disabled", "true");
  await addMain.click({ force: true });
  expect(await count(page, "main")).toBe(60);

  // The + key on a deck card (a copy) is refused.
  const first = page.locator('section[data-section="main"] ul > li button').first();
  await first.focus();
  await page.keyboard.press("+");
  await expect(notice(page)).toContainText("Main Deck is full (60/60).");
  expect(await count(page, "main")).toBe(60);
});

test("a full deck refuses a dragged card and a move between sections", async ({ player }) => {
  const { page } = await player("p1");
  const { deck } = await openFullDeck(page, "Hard limits: drag and move");

  // Drag a result onto the full Main Deck.
  const result = await searchFor(page, deck.spare.name);
  await result.dragTo(page.locator('section[data-section="main"]'));
  expect(await count(page, "main")).toBe(60);

  // Drag a result onto the full Side Deck.
  await result.dragTo(page.locator('section[data-section="side"]'));
  expect(await count(page, "side")).toBe(15);

  // Drag a Main card onto the full Side Deck: it must not leave Main and must not grow Side.
  await page.locator('section[data-section="main"] ul > li button').first().dragTo(page.locator('section[data-section="side"]'));
  expect([await count(page, "main"), await count(page, "side")]).toEqual([60, 15]);

  // Ctrl+click moves a Side card to Main: Main is full.
  await page.locator('section[data-section="side"] ul > li button').first().click({ modifiers: ["Control"] });
  await expect(notice(page)).toContainText("Main Deck is full (60/60).");
  expect([await count(page, "main"), await count(page, "side")]).toEqual([60, 15]);

  // Ctrl+click moves a Main card to Side: Side is full.
  await page.locator('section[data-section="main"] ul > li button').first().click({ modifiers: ["Control"] });
  await expect(notice(page)).toContainText("Side Deck is full (15/15).");
  expect([await count(page, "main"), await count(page, "side")]).toEqual([60, 15]);

  // Room is room: after a removal the same add works, and then stops again at the limit.
  await page.locator('section[data-section="main"] ul > li button').last().click();
  await expect.poll(() => count(page, "main")).toBe(59);
  await (await searchFor(page, deck.spare.name)).dblclick();
  await expect.poll(() => count(page, "main")).toBe(60);
  await (await searchFor(page, deck.spare.name)).dblclick();
  await expect(page.getByTestId("main-full")).toBeVisible();
  expect(await count(page, "main")).toBe(60);
});

test("an import over the limits loads up to the limits and names what was left out", async ({ player }) => {
  const { page } = await player("p1");
  const { deck } = await openFullDeck(page, "Hard limits: import");
  const ydk = [
    "#created by yugidraft-e2e", "#main", ...deck.normals.slice(0, 80).map((card) => card.id),
    "#extra", ...deck.fusions.slice(0, 22).map((card) => card.id),
    "!side", ...deck.normals.slice(120, 140).map((card) => card.id),
  ].join("\n") + "\n";

  await page.getByRole("button", { name: "Import" }).click();
  await page.getByLabel("YDK file").setInputFiles({ name: "too-big.ydk", mimeType: "text/plain", buffer: Buffer.from(ydk) });

  const messages = page.getByTestId("import-messages");
  await expect(messages).toContainText("Main Deck is full (60/60). 20 cards were left out");
  await expect(messages).toContainText("Extra Deck is full (15/15). 7 cards were left out");
  await expect(messages).toContainText("Side Deck is full (15/15). 5 cards were left out");
  expect([await count(page, "main"), await count(page, "extra"), await count(page, "side")]).toEqual([60, 15, 15]);
});

test("the server refuses a deck past a limit with 400, so no client can bypass the editor", async ({ player }) => {
  const { page } = await player("p1");
  const deck = fullDeck();
  const tooMany = { main: deck.normals.slice(0, 61).map((card) => card.id), extra: [], side: [] };
  const created = await page.request.post("/api/decks", { data: { name: "Hard limits: api", mode: "normal", deck: tooMany } });
  expect(created.status()).toBe(400);
  expect((await created.json()).error).toContain("Main deck must contain at most 60 cards");
  const extra = await page.request.post("/api/decks", { data: { name: "Hard limits: api", mode: "normal", deck: { main: [], extra: deck.fusions.slice(0, 16).map((card) => card.id), side: [] } } });
  expect(extra.status()).toBe(400);
  const side = await page.request.post("/api/decks", { data: { name: "Hard limits: api", mode: "normal", deck: { main: [], extra: [], side: deck.normals.slice(0, 16).map((card) => card.id) } } });
  expect(side.status()).toBe(400);

  const ok = await page.request.post("/api/decks", { data: { name: "Hard limits: api fits", mode: "normal", deck: { main: deck.main, extra: deck.extra, side: deck.side } } });
  expect(ok.status()).toBe(201);
  const id = (await ok.json()).deck.id as number;
  const updated = await page.request.put(`/api/decks/${id}`, { data: { name: "Hard limits: api fits", mode: "normal", deck: tooMany } });
  expect(updated.status()).toBe(400);
});
