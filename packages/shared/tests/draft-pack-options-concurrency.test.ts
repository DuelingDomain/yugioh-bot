import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "../src/db/index.js";
import { createDraftService } from "../src/services/drafts.js";

it("locks eligibility reads and swaps against a concurrent pick", () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-options-lock-"));
  let interleave = false;
  let writeResult: string | undefined;
  let concurrentPick = () => {};
  const db = new Database(join(dir, "draft.sqlite"), { verbose(sql) {
    if (interleave && String(sql).includes("select 1 from draft_passes")) {
      interleave = false;
      try { concurrentPick(); writeResult = "picked"; }
      catch (error) { writeResult = (error as { code: string }).code; }
    }
  } });
  const other = new Database(join(dir, "draft.sqlite"), { timeout: 0 });
  try {
    migrate(db);
    for (const name of ["A", "B"]) db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(name, name);
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')").run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Locked options", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, "A", 1);
    drafts.join(draft.id, 2);
    drafts.start(draft.id);
    const pack = drafts.currentPackOptions(draft.id, 1);
    const { packId } = db.prepare("select draft_pack_id as packId from draft_cards where id = ?").get(pack[0].id) as { packId: number };
    db.prepare("update draft_cards set catalog_card_id = 1 where draft_pack_id = ?").run(packId);
    for (let step = -2; step < 0; step++) {
      const card = db.prepare("insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at) values (?, 1, ?, 1, 99, 1, 't')").run(draft.id, packId);
      db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at) values (?, 1, ?, 1, ?, 'manual', 't')").run(draft.id, Number(card.lastInsertRowid), step);
    }
    const before = db.prepare("select * from draft_undealt order by position").all();
    const secondService = createDraftService(other);
    concurrentPick = () => secondService.pickCard(draft.id, 1, pack[0].id);
    interleave = true;
    expect(drafts.currentPackOptions(draft.id, 1)).toHaveLength(4);
    expect(writeResult).toBe("SQLITE_BUSY");
    concurrentPick();
    expect(drafts.currentPackOptions(draft.id, 1)).toEqual([]);
    expect(db.prepare("select * from draft_undealt order by position").all()).toEqual(before);
  } finally {
    other.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
