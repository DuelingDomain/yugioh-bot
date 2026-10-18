import { test, expect } from "@playwright/test";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { dbPath, guildId } from "../stack/env.mjs";

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`draft pack fit contract and stable layout at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const login = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
    expect(login.status()).toBe(200);
    const db = openDatabase(dbPath);
    let draftId: number | undefined;
    try {
      const playerService = createPlayerService(db), drafts = createDraftService(db, { seedSource: () => 183 });
      const human = playerService.findOrCreate(guildId, 101, "P1");
      const user = db.prepare("INSERT INTO users(username,display_name) VALUES('draft_bot','Draft bot')").run();
      const bot = playerService.findOrCreate(guildId, Number(user.lastInsertRowid), "Draft bot");
      db.prepare("UPDATE players SET discord_user_id=? WHERE id=?").run(`bot_draft_${bot.id}`, bot.id);
      const ids = Array.from({ length: 32 }, (_, i) => 90010000 + i);
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
      await page.screenshot({ path: testInfo.outputPath(`draft-picks-${viewport.width}.png`), fullPage: true });
    } finally {
      if (draftId !== undefined) db.prepare("UPDATE drafts SET status='cancelled',pick_deadline_at=NULL WHERE id=?").run(draftId);
      db.close();
    }
  });
}
