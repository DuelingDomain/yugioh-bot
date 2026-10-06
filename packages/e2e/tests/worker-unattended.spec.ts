import { test, expect } from "@playwright/test";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { dbPath, guildId, players } from "../stack/env.mjs";
import { authFile } from "../helpers/players";

test.use({storageState: authFile("p1")});
test("offline NextAuth uses app IDs while an unattended draft advances", async ({request}) => {
  const session = await (await request.get("/api/auth/session")).json();
  expect(session.user.id).toBe("101");
  expect(session.user.discordUserId).toBe(players[0].discordId);
  const db = openDatabase(dbPath);
  let draftId: number | undefined;
  try {
    const playerService = createPlayerService(db), drafts = createDraftService(db);
    const a = playerService.findOrCreate(guildId, 101, players[0].name);
    const b = playerService.findOrCreate(guildId, 102, players[1].name);
    const insert = db.prepare(`insert or ignore into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values(?,?,'Normal Monster','normal','https://img/full','https://img/small','[{"set_name":"Metal Raiders"}]',current_timestamp)`);
    for (let i = 1; i <= 80; i++) insert.run(80000000 + i, `Worker card ${i}`);
    const draft = drafts.create(guildId, "e2e-channel", `Unattended ${Date.now()}`, {}, 101, a.id);
    draftId = draft.id;
    drafts.join(draft.id, b.id);
    drafts.start(draft.id);
    db.prepare("update drafts set pick_deadline_at=? where id=?").run(new Date(Date.now() - 60000).toISOString(), draft.id);
    // No draft GET/pick request: only the independent worker can advance it.
    await expect.poll(() => drafts.findById(draft.id).currentPickStep, {timeout: 10000}).toBe(2);
    expect(db.prepare("select count(*) as n from draft_picks where draft_id=?").get(draft.id)).toEqual({n: 2});
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    if (draftId !== undefined) db.prepare("update drafts set status='cancelled',pick_deadline_at=null where id=?").run(draftId);
    db.close();
  }
});
