import { test, expect } from "../helpers/fixtures";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { dbPath, guildId } from "../stack/env.mjs";
import { cardCode } from "../helpers/cards";
import { cards, seedCatalog } from "./catalog";
import { cleanNames, hideDebug, shotDir } from "./shot";

// Marketing screenshots of the draft pick screen and the Genesys deck builder. Seeded test player, a practice bot and public card data only.
const byName = (name: string) => cards.find((card) => card.name === name)!;

/** The seeded "new update" pop-up would cover the page, so close it. */
async function dismissUpdates(page: import("@playwright/test").Page) {
  const later = page.getByRole("button", { name: "Later" });
  if (await later.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false)) await later.click();
  await page.waitForTimeout(500);
}

test("draft pick screen", async ({ player }) => {
  await cleanNames();
  const { page } = await player("p1");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const db = openDatabase(dbPath);
  try {
    await seedCatalog(db);
    const players = createPlayerService(db);
    const drafts = createDraftService(db, { seedSource: () => 183 });
    const human = players.findOrCreate(guildId, 101, "Yugi M.");
    const user = db.prepare("INSERT INTO users(username,display_name) VALUES('shot_bot','Mai V.')").run();
    const bot = players.findOrCreate(guildId, Number(user.lastInsertRowid), "Mai V.");
    db.prepare("UPDATE players SET discord_user_id=? WHERE id=?").run(`bot_draft_${bot.id}`, bot.id);
    const draft = drafts.create(guildId, null, "Friday cube draft", {
      cubeCardIds: cards.map((card) => card.id), packSize: 8, packsPerPlayer: 2, cardsPerPlayer: 16, pickSeconds: 3600,
    }, 101, human.id);
    drafts.join(draft.id, bot.id); drafts.start(draft.id);
    for (let i = 0; i < 3; i++) {
      const choice = drafts.pickOptions(draft.id, human.id)[0];
      const picked = await page.request.post(`/api/drafts/${draft.webSlug}/pick`, { data: { cardId: choice.id } });
      expect(picked.status()).toBe(200);
    }
    await page.goto(`/draft/${draft.webSlug}`);
    await expect(page.locator(".dr .tcard:not([aria-hidden='true'])").first()).toBeVisible();
    await dismissUpdates(page);
    await page.locator(".dr .tcard:not([aria-hidden='true'])").nth(2).hover();
    await page.waitForTimeout(1500);
    await hideDebug(page);
    await page.screenshot({ path: shotDir("draft.png") });
  } finally { db.close(); }
});

test("Genesys deck builder with points", async ({ player }) => {
  await cleanNames();
  const { page } = await player("p1");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const db = openDatabase(dbPath);
  try { await seedCatalog(db); } finally { db.close(); }
  // 98 of 100 points: the staples below plus plain cards at 0 points.
  const picks = ["Ash Blossom & Joyous Spring", "Called by the Grave", "Pot of Greed", "Infinite Impermanence", "Nibiru, the Primal Being", "Solemn Judgment", "Effect Veiler", "Dark Hole", "Raigeki", "Monster Reborn", "Book of Moon"];
  const plain = ["Dark Magician", "Blue-Eyes White Dragon", "Red-Eyes Black Dragon", "Summoned Skull", "Celtic Guardian", "Kuriboh", "Sangan", "Man-Eater Bug", "Mirror Force", "Mystical Space Typhoon", "Torrential Tribute", "Swords of Revealing Light", "Fiber Jar", "Mother Grizzly", "Gene-Warped Warwolf", "Trap Hole", "Magic Cylinder"];
  const main = [...picks, ...plain, ...plain.slice(0, 12)].map((name) => cardCode(byName(name).name));
  const created = await page.request.post("/api/decks", { data: { name: "Genesys staples", mode: "normal", genesys: {}, deck: { main, extra: [cardCode("Stardust Dragon")], side: [] } } });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).deck.id as number;
  await page.goto(`/decks/${id}`);
  await expect(page.getByRole("group", { name: "Genesys points" })).toBeVisible();
  await dismissUpdates(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2000);
  await hideDebug(page);
  // The shot shows the points meter and the deck only. The left panel says "Deck size is correct for Standard." in every
  // Genesys deck (editor.tsx, sizeFlag), and the search results show "? pts" unless the worker published the live list.
  await page.screenshot({ path: shotDir("genesys-deck.png"), clip: { x: 384, y: 0, width: 1120, height: 900 } });
});
