import { test, expect } from "@playwright/test";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { dbPath, guildId } from "../stack/env.mjs";

for (const [viewportIndex, viewport] of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }].entries()) {
  test(`draft pack fit contract and stable layout at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const login = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
    expect(login.status()).toBe(200);
    const db = openDatabase(dbPath);
    let draftId: number | undefined;
    let botUserId: number | undefined;
    let botPlayerId: number | undefined;
    const ids = Array.from({ length: 32 }, (_, i) => 90010000 + viewportIndex * 32 + i);
    try {
      const playerService = createPlayerService(db), drafts = createDraftService(db, { seedSource: () => 183 });
      const human = playerService.findOrCreate(guildId, 101, "P1");
      const user = db.prepare("INSERT INTO users(username,display_name) VALUES('draft_bot','Draft bot')").run();
      botUserId = Number(user.lastInsertRowid);
      const bot = playerService.findOrCreate(guildId, botUserId, "Draft bot");
      botPlayerId = bot.id;
      db.prepare("UPDATE players SET discord_user_id=? WHERE id=?").run(`bot_draft_${bot.id}`, bot.id);
      const insert = db.prepare(`INSERT OR IGNORE INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,image_url,image_url_small,card_sets_json,cached_at)
        VALUES(?,?,'Effect Monster','effect','Draft family',?,?,'[]',CURRENT_TIMESTAMP)`);
      for (const id of ids) insert.run(id, `Draft family ${id}`, `https://images.ygoprodeck.com/images/cards/${id}.jpg`, `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`);
      const draft = drafts.create(guildId, null, `Smart picks ${viewport.width}`, {
        cubeCardIds: ids, packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4, pickSeconds: 600,
      }, 101, human.id);
      draftId = draft.id; drafts.join(draft.id, bot.id); drafts.start(draft.id);
      const choice = drafts.pickOptions(draft.id, human.id)[0];
      const picked = await page.request.post(`/api/drafts/${draft.webSlug}/pick`, { data: { cardId: choice.id } });
      expect(picked.status()).toBe(200);
      const state = await picked.json();
      expect(state.effectSearchEnabled).toBe(true);
      expect(state.attribution).toBe("Effect search powered by searchygo");
      expect(state.currentPack.length).toBe(3);
      expect(state.currentPack.every((card: { fitsYourPool?: string }) => card.fitsYourPool === "Shares Draft family")).toBe(true);
      await page.goto(`/draft/${draft.webSlug}`);
      const card = page.locator(".dr .tcard:not([aria-hidden='true'])").first();
      await expect(card).toBeVisible();
      const before = await card.boundingBox();
      await card.hover();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const after = await card.boundingBox();
      expect(after!.x).toBeCloseTo(before!.x, 1); expect(after!.y).toBeCloseTo(before!.y, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (viewport.width < 600) await card.click();
      const reader = page.getByRole("complementary", { name: "Card reader" });
      await expect(reader.getByText("Effect search powered by searchygo", { exact: true })).toBeVisible();
      await expect(reader.locator(".insp-fit")).toContainText("Shares Draft family");
      await page.screenshot({ path: testInfo.outputPath(`draft-picks-${viewport.width}.png`), fullPage: true });
    } finally {
      try {
        db.transaction(() => {
          if (draftId !== undefined) {
            for (const table of ["draft_passes", "draft_picks", "draft_cards", "draft_packs", "draft_undealt", "draft_deal", "draft_player_cube", "draft_players"]) {
              db.prepare(`DELETE FROM ${table} WHERE draft_id=?`).run(draftId);
            }
            db.prepare("DELETE FROM drafts WHERE id=?").run(draftId);
          }
          if (botPlayerId !== undefined) db.prepare("DELETE FROM players WHERE id=?").run(botPlayerId);
          if (botUserId !== undefined) db.prepare("DELETE FROM users WHERE id=?").run(botUserId);
          const remove = db.prepare("DELETE FROM card_catalog WHERE ygoprodeck_id=?");
          for (const id of ids) remove.run(id);
        })();
      } finally { db.close(); }
    }
  });
}
