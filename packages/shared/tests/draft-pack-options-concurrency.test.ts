import { seedIdentity, seedUser } from "./helpers/identity.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "../src/db/index.js";
import { createDraftService } from "../src/services/drafts.js";

// These tests do real disk-backed SQLite lock interleaving.
it("allows a concurrent pick during a pack read that cannot swap", () => {
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
    for (const name of ["A", "B"]) seedIdentity(db, { guildId: "g", name: name, userId: seedUser(db, name).userId, discordUserId: seedUser(db, name).discordUserId ?? name });
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')").run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Locked options", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, seedUser(db, "A").userId, 1);
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
    drafts.currentPackOptions(draft.id, 1);
    expect(writeResult).toBe("picked");
    expect(drafts.currentPackOptions(draft.id, 1)).toEqual([]);
    expect(db.prepare("select * from draft_undealt order by position").all()).toEqual(before);
  } finally {
    other.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

it.each([false, true])("reads an ordinary pack without acquiring a write lock (copyLimit %s)", (copyLimit) => {
  const dir = mkdtempSync(join(tmpdir(), "draft-options-read-"));
  const db = new Database(join(dir, "draft.sqlite"), { timeout: 0 });
  const writer = new Database(join(dir, "draft.sqlite"));
  try {
    migrate(db);
    for (const name of ["A", "B"]) seedIdentity(db, { guildId: "g", name: name, userId: seedUser(db, name).userId, discordUserId: seedUser(db, name).discordUserId ?? name });
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')")
      .run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Read options", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8, copyLimit }, seedUser(db, "A").userId, 1);
    drafts.join(draft.id, 2);
    drafts.start(draft.id);
    writer.exec("begin immediate");
    expect(drafts.currentPackOptions(draft.id, 1)).toHaveLength(4);
    expect(drafts.pickOptions(draft.id, 1)).toHaveLength(4);
  } finally {
    if (writer.inTransaction) writer.exec("rollback");
    writer.close(); db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

it.each(["empty", "capped artwork"])("reads a fully capped pack without a write lock when the undealt pile is %s", (pile) => {
  const dir = mkdtempSync(join(tmpdir(), "draft-options-capped-read-"));
  const db = new Database(join(dir, "draft.sqlite"), { timeout: 0 });
  const writer = new Database(join(dir, "draft.sqlite"));
  try {
    migrate(db);
    for (const name of ["A", "B"]) seedIdentity(db, { guildId: "g", name: name, userId: seedUser(db, name).userId, discordUserId: seedUser(db, name).discordUserId ?? name });
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')")
      .run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Capped read options", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, seedUser(db, "A").userId, 1);
    drafts.join(draft.id, 2); drafts.start(draft.id);
    const pack = drafts.currentPackOptions(draft.id, 1);
    const { packId } = db.prepare("select draft_pack_id as packId from draft_cards where id = ?").get(pack[0].id) as { packId: number };
    db.prepare("update draft_cards set catalog_card_id = 1 where draft_pack_id = ?").run(packId);
    for (let step = -3; step < 0; step++) {
      const card = db.prepare("insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at) values (?, 1, ?, 1, 99, 1, 't')").run(draft.id, packId);
      db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at) values (?, 1, ?, 1, ?, 'manual', 't')").run(draft.id, Number(card.lastInsertRowid), step);
    }
    db.prepare("delete from draft_undealt where draft_id = ?").run(draft.id);
    if (pile === "capped artwork") {
      db.prepare("update card_catalog set name = '  CARD 1  ' where ygoprodeck_id = 2").run();
      db.prepare("insert into draft_undealt (draft_id, position, catalog_card_id) values (?, 100, 2)").run(draft.id);
    }
    const before = db.prepare("select * from draft_undealt where draft_id = ? order by position").all(draft.id);

    writer.exec("begin immediate");
    const options = drafts.currentPackOptions(draft.id, 1);
    expect(options).toHaveLength(4);
    expect(options.every((card) => card.forced && card.catalogCardId === 1)).toBe(true);
    expect(drafts.pickOptions(draft.id, 1)).toEqual(options);
    expect(db.prepare("select * from draft_undealt where draft_id = ? order by position").all(draft.id)).toEqual(before);
  } finally {
    if (writer.inTransaction) writer.exec("rollback");
    writer.close(); db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

it("rechecks eligibility under the swap lock and stores one swap across retries", () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-options-swap-"));
  let interleave = false;
  let writeResult: string | undefined;
  let concurrentPick = () => {};
  const db = new Database(join(dir, "draft.sqlite"), { verbose(sql) {
    if (interleave && String(sql).includes("select 1 from draft_passes") && db.inTransaction) {
      interleave = false;
      try { concurrentPick(); writeResult = "picked"; }
      catch (error) { writeResult = (error as { code: string }).code; }
    }
  } });
  const other = new Database(join(dir, "draft.sqlite"), { timeout: 0 });
  try {
    migrate(db);
    for (const name of ["A", "B"]) seedIdentity(db, { guildId: "g", name: name, userId: seedUser(db, name).userId, discordUserId: seedUser(db, name).discordUserId ?? name });
    for (let id = 1; id <= 24; id++) db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')").run(id, `Card ${id}`);
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const draft = drafts.create("g", "c", "Swap options", { cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, seedUser(db, "A").userId, 1);
    drafts.join(draft.id, 2); drafts.start(draft.id);
    const pack = drafts.currentPackOptions(draft.id, 1);
    const { packId } = db.prepare("select draft_pack_id as packId from draft_cards where id = ?").get(pack[0].id) as { packId: number };
    db.prepare("update draft_cards set catalog_card_id = 1 where draft_pack_id = ?").run(packId);
    for (let step = -3; step < 0; step++) {
      const card = db.prepare("insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at) values (?, 1, ?, 1, 99, 1, 't')").run(draft.id, packId);
      db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at) values (?, 1, ?, 1, ?, 'manual', 't')").run(draft.id, Number(card.lastInsertRowid), step);
    }
    concurrentPick = () => createDraftService(other).pickCard(draft.id, 1, pack[0].id);
    interleave = true;
    const options = drafts.pickOptions(draft.id, 1);
    expect(writeResult).toBe("SQLITE_BUSY");
    expect(options).toHaveLength(1);
    const remainder = db.prepare("select * from draft_undealt order by position").all();
    expect(createDraftService(other).pickOptions(draft.id, 1)).toEqual(options);
    expect(db.prepare("select * from draft_undealt order by position").all()).toEqual(remainder);
  } finally {
    other.close(); db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
