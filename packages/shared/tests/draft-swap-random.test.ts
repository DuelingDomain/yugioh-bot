import Database from "better-sqlite3";
import { randomInt } from "node:crypto";
import { expect, it, vi } from "vitest";
import { migrate } from "../src/db/index.js";
import { createDraftService } from "../src/services/drafts.js";

vi.mock("node:crypto", async (original) => ({ ...await original<typeof import("node:crypto")>(), randomInt: vi.fn(() => 2) }));

it("uses a secret random outgoing card and keeps the stored swap after restart", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    for (const name of ["A", "B"]) db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(name, name);
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')").run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Random swap", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, "A", 1);
    drafts.join(draft.id, 2); drafts.start(draft.id);
    const pack = drafts.currentPackOptions(draft.id, 1);
    const { packId } = db.prepare("select draft_pack_id as packId from draft_cards where id = ?").get(pack[0].id) as { packId: number };
    let step = -1;
    for (const held of pack) for (let copy = 0; copy < 3; copy++) {
      const card = db.prepare("insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at) values (?, 1, ?, ?, 99, 1, 't')").run(draft.id, packId, held.catalogCardId);
      db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at) values (?, 1, ?, 1, ?, 'manual', 't')").run(draft.id, Number(card.lastInsertRowid), step--);
    }
    const options = drafts.pickOptions(draft.id, 1);
    expect(randomInt).toHaveBeenCalledWith(pack.length);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe(pack[2].id);
    expect(options[0].forced).not.toBe(true);
    const after = db.prepare("select * from draft_undealt order by position").all();
    expect(after.at(-1)).toMatchObject({ catalog_card_id: pack[2].catalogCardId });
    const recovered = createDraftService(db, { seedSource: () => { throw new Error("No new seed"); } });
    expect(recovered.pickOptions(draft.id, 1)).toEqual(options);
    expect(db.prepare("select * from draft_undealt order by position").all()).toEqual(after);
    expect(randomInt).toHaveBeenCalledTimes(1);
  } finally { db.close(); }
});
