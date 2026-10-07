import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createCubeService } from "../../src/services/cubes.js";
import type { DraftConfig } from "../../src/types/index.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function setup(config: DraftConfig = {}, playerCount = 2) {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const insert = db.prepare(`insert into card_catalog
    (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
    values (?, ?, ?, ?, 'i', 'i', '[]', 't')`);
  const main = Array.from({ length: 600 }, (_, i) => i + 1);
  const extra = Array.from({ length: 64 }, (_, i) => i + 1001);
  for (const id of main) insert.run(id, `Main ${id}`, "Effect Monster", "effect");
  for (const [i, id] of extra.entries()) insert.run(id, `Extra ${id}`, ["Fusion Monster", "Synchro Monster", "XYZ Monster", "Link Monster"][i % 4], ["fusion", "synchro", "xyz", "link"][i % 4]);
  const players = Array.from({ length: playerCount }, (_, i) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)"
  ).run(i ? `bot_player_dev_${i}` : "host", `Seat ${i}`).lastInsertRowid));
  let drafts = createDraftService(db, { seedSource: () => 7 });
  const draft = drafts.create("g", "c", "Cube extra", {
    customCardIds: main.slice(0, 16), packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6,
    pickSeconds: 30, customExtraCardIds: extra.slice(0, 8), ...config,
  }, "host", players[0]);
  for (const id of players.slice(1)) drafts.join(draft.id, id);
  const reload = () => { drafts = createDraftService(db, { seedSource: () => 7 }); return drafts; };
  return { db, drafts, draft, players, main, extra, reload };
}

function expireToRound(ctx: ReturnType<typeof setup>, round: number) {
  for (let guard = 0; guard < 2000; guard++) {
    const draft = ctx.drafts.findById(ctx.draft.id);
    if (draft.status !== "active" || draft.currentPackRound >= round) return;
    ctx.drafts.expireCurrentPickStep(draft.id, new Date(draft.pickDeadlineAt!));
  }
  throw new Error("Draft did not advance");
}

describe("normal cube Extra Deck packs", () => {
  it("defaults OFF for old configs even when extra cards are present", () => {
    const ctx = setup();
    expect(ctx.draft.config.extraDeckEnabled).toBe(false);
    expect(ctx.draft.config.extraDeckSize).toBe(15);
    expect(ctx.draft.config.picksPerStep).toBe(1);
    ctx.drafts.start(ctx.draft.id);
    expireToRound(ctx, 99);
    expect(ctx.drafts.findById(ctx.draft.id)).toMatchObject({ status: "completed", currentPackRound: 2 });
    expect(ctx.drafts.pool(ctx.draft.id, ctx.players[0])).toHaveLength(6);
  });

  it("deals every main pack before an extra-only pack and saves the extra picks in the deck", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 3 });
    ctx.drafts.start(ctx.draft.id, new Date("2026-10-06T00:00:00Z"));
    expect(ctx.drafts.currentWaveCards(ctx.draft.id).every((c) => c.catalogCardId < 1000)).toBe(true);
    expireToRound(ctx, 3);
    expect(ctx.drafts.findById(ctx.draft.id)).toMatchObject({ status: "active", currentPackRound: 3, currentPickStep: 1 });
    expect(ctx.drafts.currentWaveCards(ctx.draft.id)).toHaveLength(6);
    expect(ctx.drafts.currentWaveCards(ctx.draft.id).every((c) => c.catalogCardId >= 1001)).toBe(true);
    const finished = ctx.db.prepare("select finished_at from draft_players where draft_id = ?").all(ctx.draft.id);
    expect(finished).toEqual([{ finished_at: null }, { finished_at: null }]);
    expect(() => ctx.drafts.exportYdk(ctx.draft.id, ctx.players[0])).toThrow(/not complete/);
    ctx.drafts = ctx.reload(); // Stored deal/deadlines survive a new service instance.
    expireToRound(ctx, 99);
    expect(ctx.drafts.findById(ctx.draft.id).status).toBe("completed");
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player)).toHaveLength(9);
    const saved = ctx.db.prepare("select deck_json from saved_decks where draft_id = ?").get(ctx.draft.id) as { deck_json: string };
    const deck = JSON.parse(saved.deck_json);
    expect(deck.main).toHaveLength(6);
    expect(deck.extra).toHaveLength(3);
    expect(deck.extra.every((id: number) => id >= 1001)).toBe(true);
    expect(ctx.drafts.picks(ctx.draft.id).every((p) => p.pickMethod === "auto")).toBe(true);
  });

  it("honors the main quota when the last main pack has leftover cards", () => {
    const ctx = setup({ cardsPerPlayer: 5, extraDeckEnabled: true, extraDeckSize: 2 });
    ctx.drafts.start(ctx.draft.id);
    expireToRound(ctx, 3);
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player)).toHaveLength(5);
    expireToRound(ctx, 99);
    for (const player of ctx.players) {
      const pool = ctx.drafts.pool(ctx.draft.id, player);
      expect(pool.filter((c) => c.catalogCardId < 1000)).toHaveLength(5);
      expect(pool.filter((c) => c.catalogCardId > 1000)).toHaveLength(2);
    }
  });

  it("reports and rejects an undersized extra pool without partially starting", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 5 });
    expect(ctx.drafts.analyzeBoosterDraft(ctx.draft.config, 2, "g").errors).toEqual([expect.stringMatching(/Extra.*8.*10/)]);
    expect(() => ctx.drafts.start(ctx.draft.id)).toThrow(/Extra.*8.*10/);
    expect(ctx.drafts.findById(ctx.draft.id).status).toBe("pending");
    expect(ctx.db.prepare("select count(*) n from draft_deal").get()).toEqual({ n: 0 });
    expect(ctx.db.prepare("select seat_index from draft_players").all()).toEqual([{ seat_index: null }, { seat_index: null }]);
  });

  it("flattens saved cube extra copies into the normal config without counting them in main", () => {
    const ctx = setup();
    const cubes = createCubeService(ctx.db, createCardCatalogService(ctx.db));
    const cube = cubes.createBlank("g", "Saved", "host");
    cubes.addCard(cube.id, 1, "main", 3);
    cubes.addCard(cube.id, 1001, "extra", 2);
    const config = cubes.applyCubeToConfig(cube.id);
    expect(config.customCardIds).toEqual([1, 1, 1]);
    expect(config.customExtraCardIds).toEqual([1001, 1001]);
    expect(ctx.drafts.resolveExtraCardIds(config, "g")).toEqual([1001, 1001]);
  });

  it("lets an explicit empty extra snapshot override a source cube", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 2, customExtraCardIds: [] });
    const cubes = createCubeService(ctx.db, createCardCatalogService(ctx.db));
    const cube = cubes.createBlank("g", "Saved", "host");
    cubes.addCard(cube.id, 1001, "extra", 4);
    const config = { ...ctx.draft.config, poolSource: { cubeId: cube.id, cubeName: cube.name } };
    expect(ctx.drafts.resolveExtraCardIds(config, "g")).toEqual([]);
    expect(ctx.drafts.analyzeBoosterDraft(config, 2, "g").errors).toEqual([expect.stringMatching(/Extra.*0.*4/)]);
  });

  it.each([-1, 1.5, 16, "3" as unknown as number])("rejects invalid normal extra size %s at start", (extraDeckSize) => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize });
    expect(() => ctx.drafts.start(ctx.draft.id)).toThrow(/Extra deck size/);
  });

  it("treats enabled size zero as no extra phase", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 0, customExtraCardIds: [] });
    ctx.drafts.start(ctx.draft.id);
    expireToRound(ctx, 99);
    expect(ctx.drafts.findById(ctx.draft.id)).toMatchObject({ status: "completed", currentPackRound: 2 });
  });

  it("uses the source cube's authored extra copies and scopes it to the guild", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 2, customExtraCardIds: undefined });
    const cubes = createCubeService(ctx.db, createCardCatalogService(ctx.db));
    const cube = cubes.createBlank("g", "Source", "host");
    cubes.addCard(cube.id, 1001, "extra", 2);
    cubes.addCard(cube.id, 1002, "extra", 2);
    const cfg = { ...ctx.draft.config, poolSource: { cubeId: cube.id, cubeName: cube.name } };
    ctx.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(cfg), ctx.draft.id);
    ctx.drafts.start(ctx.draft.id);
    cubes.removeCard(cube.id, 1001);
    expireToRound(ctx, 3);
    expect(ctx.drafts.currentWaveCards(ctx.draft.id).map((c) => c.catalogCardId).sort()).toEqual([1001, 1001, 1002, 1002]);
    const foreign = setup({ extraDeckEnabled: true, extraDeckSize: 2, customExtraCardIds: undefined, poolSource: { cubeId: cube.id, cubeName: "Foreign" } });
    expect(() => foreign.drafts.start(foreign.draft.id)).toThrow(/Extra.*0.*4/);
  });

  it("never deals main cards from the extra pool or swaps extra cards into a capped main pack", () => {
    const ctx = setup({ customCardIds: Array(8).fill(1), customExtraCardIds: [2, 2, 1001, 1002, 1003],
      packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4, extraDeckEnabled: true, extraDeckSize: 1 });
    ctx.drafts.start(ctx.draft.id);
    expireToRound(ctx, 2);
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player).every((c) => c.catalogCardId === 1)).toBe(true);
    expect(ctx.drafts.currentWaveCards(ctx.draft.id).every((c) => c.catalogCardId > 1000)).toBe(true);
  });

  it("preserves legacy mixed-pool swaps while Extra Deck rounds are OFF", () => {
    const ctx = setup({ cubeCardIds: [...Array(8).fill(1), 1001], packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4 });
    ctx.drafts.start(ctx.draft.id);
    ctx.db.prepare("update draft_cards set catalog_card_id = 1 where draft_id = ?").run(ctx.draft.id);
    ctx.db.prepare("delete from draft_undealt where draft_id = ?").run(ctx.draft.id);
    ctx.db.prepare("insert into draft_undealt (draft_id, position, catalog_card_id) values (?, 1000, 1001)").run(ctx.draft.id);
    for (let step = 0; step < 3; step++) {
      for (const player of ctx.players) ctx.drafts.pickCard(ctx.draft.id, player, ctx.drafts.pickOptions(ctx.draft.id, player)[0].id);
    }
    expect(ctx.drafts.pickOptions(ctx.draft.id, ctx.players[0]).some((c) => c.catalogCardId === 1001)).toBe(true);
  });

  it("keeps copy-cap replacements in the extra pool", () => {
    const ctx = setup({ extraDeckEnabled: true, extraDeckSize: 4, customExtraCardIds: [...Array(8).fill(1001), 1002] });
    ctx.drafts.start(ctx.draft.id);
    // Force a capped pack and legal undealt extras/main, independent of shuffle distribution.
    expireToRound(ctx, 3);
    ctx.db.prepare("update draft_cards set catalog_card_id = 1001 where draft_id = ? and wave_number = 3").run(ctx.draft.id);
    ctx.db.prepare("delete from draft_undealt where draft_id = ?").run(ctx.draft.id);
    ctx.db.prepare("insert into draft_undealt (draft_id, position, catalog_card_id) values (?, 1000, 2), (?, 1001, 1002)").run(ctx.draft.id, ctx.draft.id);
    for (let step = 0; step < 3; step++) {
      for (const player of ctx.players) ctx.drafts.pickCard(ctx.draft.id, player, ctx.drafts.pickOptions(ctx.draft.id, player)[0].id);
    }
    const choices = ctx.drafts.pickOptions(ctx.draft.id, ctx.players[0]);
    expect(choices.some((c) => c.catalogCardId === 1002)).toBe(true);
    expect(choices.every((c) => c.catalogCardId > 1000)).toBe(true);
  });

  it("keeps a pack for two sequential picks before passing, including odd extra pack sizes", () => {
    const ctx = setup({ packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4, picksPerStep: 2, extraDeckEnabled: true, extraDeckSize: 3 });
    ctx.drafts.start(ctx.draft.id);
    const holders = () => ctx.db.prepare("select current_holder_seat_index as seat from draft_packs where draft_id = ? and wave_number = 1 order by id").all(ctx.draft.id);
    for (const player of ctx.players) ctx.drafts.pickCard(ctx.draft.id, player, ctx.drafts.pickOptions(ctx.draft.id, player)[0].id);
    expect(holders()).toEqual([{ seat: 0 }, { seat: 1 }]);
    for (const player of ctx.players) ctx.drafts.pickCard(ctx.draft.id, player, ctx.drafts.pickOptions(ctx.draft.id, player)[0].id);
    expect(holders()).toEqual([{ seat: 1 }, { seat: 0 }]);
    expireToRound(ctx, 99);
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player)).toHaveLength(7);
  });

  it("finishes the owner's 5 × 24 two-pick main format before pack 6", () => {
    const ctx = setup({ customCardIds: Array.from({ length: 480 }, (_, i) => i + 1),
      packsPerPlayer: 5, packSize: 24, cardsPerPlayer: 120, picksPerStep: 2,
      extraDeckEnabled: true, extraDeckSize: 9, customExtraCardIds: Array.from({ length: 36 }, (_, i) => i + 1001) }, 4);
    ctx.drafts.start(ctx.draft.id);
    expireToRound(ctx, 6);
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player)).toHaveLength(120);
    expect(ctx.drafts.currentWaveCards(ctx.draft.id)).toHaveLength(36);
    expireToRound(ctx, 99);
    expect(ctx.drafts.findById(ctx.draft.id).status).toBe("completed");
    for (const player of ctx.players) expect(ctx.drafts.pool(ctx.draft.id, player)).toHaveLength(129);
  });
});


it("lets a two-pick pack traverse finished seats before repairing a stuck table", () => {
  const ctx = setup({ packSize: 2, packsPerPlayer: 1, cardsPerPlayer: 2, picksPerStep: 2, copyLimit: false }, 4);
  ctx.drafts.start(ctx.draft.id);
  const active = ctx.db.prepare("select player_id from draft_players where draft_id = ? and seat_index = 0").get(ctx.draft.id) as { player_id: number };
  ctx.db.prepare("update draft_players set finished_at = 'finished', pick_count = 2 where draft_id = ? and player_id != ?").run(ctx.draft.id, active.player_id);
  ctx.db.prepare("update draft_cards set picked_by_player_id = ? where draft_id = ?").run(active.player_id, ctx.draft.id);
  ctx.db.prepare(`update draft_cards set picked_by_player_id = null where id = (
    select c.id from draft_cards c join draft_packs p on p.id = c.draft_pack_id
    where p.draft_id = ? and p.origin_seat_index = 1 limit 1
  )`).run(ctx.draft.id);
  ctx.db.prepare("update draft_packs set pass_direction = 1 where draft_id = ?").run(ctx.draft.id);
  const started = ctx.drafts.findById(ctx.draft.id);
  ctx.drafts.expireCurrentPickStep(ctx.draft.id, new Date(started.pickDeadlineAt!));
  expect(ctx.drafts.findById(ctx.draft.id)).toMatchObject({ status: "active", currentPackRound: 1, currentPickStep: 7 });
  expect(ctx.drafts.pickOptions(ctx.draft.id, active.player_id)).toHaveLength(1);
});
