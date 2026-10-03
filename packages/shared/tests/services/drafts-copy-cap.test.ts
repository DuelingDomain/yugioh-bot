import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { MAX_COPIES_PER_PLAYER } from "../../src/services/constants.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createCubeService } from "../../src/services/cubes.js";
import { createDraftService } from "../../src/services/drafts.js";
import type { DraftConfig } from "../../src/types/index.js";

// The cube may hold any number of copies of a card. One player may still hold at most
// MAX_COPIES_PER_PLAYER of a passcode from one draft: a capped card is never served,
// and a player with nothing left to take passes the pick while the draft keeps moving.

function insertPlayer(db: Database.Database, name: string): number {
  const result = db
    .prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)")
    .run(`u-${name}`, name);
  return Number(result.lastInsertRowid);
}

function seedCards(db: Database.Database, count: number) {
  const insert = db.prepare(
    `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
     values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')`,
  );
  for (let id = 1; id <= count; id += 1) insert.run(id, `Card ${id}`);
}

let syntheticStep = -1;
/** Gives a player `copies` extra copies of a passcode, as if they picked them earlier in the draft. */
function grantCopies(db: Database.Database, draftId: number, playerId: number, catalogCardId: number, copies: number) {
  const pack = db.prepare("select id, wave_number from draft_packs where draft_id = ? limit 1").get(draftId) as {
    id: number;
    wave_number: number;
  };
  for (let i = 0; i < copies; i += 1) {
    const card = db
      .prepare(
        `insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position, picked_by_player_id, picked_at)
         values (?, ?, ?, ?, 99, ?, 't')`,
      )
      .run(draftId, pack.wave_number, pack.id, catalogCardId, playerId);
    db.prepare(
      `insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at)
       values (?, ?, ?, ?, ?, 'manual', 't')`,
    ).run(draftId, playerId, Number(card.lastInsertRowid), pack.wave_number, syntheticStep);
    syntheticStep -= 1;
  }
}

function expireNow(db: Database.Database, draftId: number) {
  db.prepare("update drafts set pick_deadline_at = ? where id = ?").run(new Date(Date.now() - 1000).toISOString(), draftId);
}

function heldByPlayer(db: Database.Database, draftId: number, playerId: number): Map<number, number> {
  const rows = db
    .prepare(
      `select dc.catalog_card_id as id, count(*) as n
         from draft_picks pk join draft_cards dc on dc.id = pk.draft_card_id
        where pk.draft_id = ? and pk.player_id = ? group by dc.catalog_card_id`,
    )
    .all(draftId, playerId) as Array<{ id: number; n: number }>;
  return new Map(rows.map((row) => [row.id, row.n]));
}

function boosterDraft(config: Partial<DraftConfig>, cubeCardIds: number[], cardCount = 40) {
  const db = new Database(":memory:");
  migrate(db);
  const drafts = createDraftService(db, { seedSource: () => 7, random: () => 0.5 });
  const a = insertPlayer(db, "A");
  const b = insertPlayer(db, "B");
  seedCards(db, cardCount);
  const draft = drafts.create("g", "c", "cap night", { cubeCardIds, ...config }, "host", a);
  drafts.join(draft.id, b);
  drafts.start(draft.id);
  return { db, drafts, draftId: draft.id, a, b };
}

const distinctCube = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("per-player copy cap in booster drafts", () => {
  it.each([16, 17, 18, 19])("starts with %i distinct cards when the deck limit exceeds the deal size", (distinct) => {
    const { db, drafts, draftId } = boosterDraft({ packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 60 }, distinctCube(distinct));
    expect(drafts.findById(draftId).status).toBe("active");
    expect(drafts.players(draftId)).toHaveLength(2);
    expect(db.prepare("select count(*) as n from draft_deal where draft_id = ?").get(draftId)).toEqual({ n: 80 });
    db.close();
  });

  it("refuses to start a booster deck exceeding the three-copy reachability", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedCards(db, 8);
    const drafts = createDraftService(db);
    const players = [insertPlayer(db, "A"), insertPlayer(db, "B")];
    const draft = drafts.create("g", "c", "too narrow", {
      cubeCardIds: distinctCube(8), packSize: 4, packsPerPlayer: 10, cardsPerPlayer: 40,
    }, "host", players[0]);
    drafts.join(draft.id, players[1]);
    expect(() => drafts.start(draft.id)).toThrow(/3 copies/);
    expect(drafts.findById(draft.id).status).toBe("pending");
    expect(db.prepare("select count(*) as n from draft_deal where draft_id = ?").get(draft.id)).toEqual({ n: 0 });
    db.close();
  });

  it("keeps the last takeable card moving after a player finishes (seed 15838)", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedCards(db, 12);
    let state = 15838;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const drafts = createDraftService(db, { seedSource: () => 15838, random });
    const players = [insertPlayer(db, "A"), insertPlayer(db, "B")];
    const draft = drafts.create("g", "c", "last card", {
      cubeCardIds: distinctCube(12).flatMap((id) => Array(10).fill(id)),
      packSize: 6, packsPerPlayer: 6, cardsPerPlayer: 36,
    }, "host", players[0]);
    drafts.join(draft.id, players[1]);
    drafts.start(draft.id);

    for (let guard = 0; guard < 200 && drafts.findById(draft.id).status === "active"; guard += 1) {
      const playerId = players.find((id) => drafts.pickOptions(draft.id, id).length > 0);
      expect(playerId).toBeDefined();
      const options = drafts.pickOptions(draft.id, playerId!);
      drafts.pickCard(draft.id, playerId!, options[Math.floor(random() * options.length)].id);
    }

    expect(drafts.findById(draft.id).status).toBe("completed");
    expect(players.map((id) => drafts.pool(draft.id, id).length)).toEqual([36, 36]);
    db.close();
  });

  it("rejects a fourth copy and leaves it out of the pick options", () => {
    const { db, drafts, draftId, a } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const pack = drafts.currentPackOptions(draftId, a);
    const capped = pack[0];
    grantCopies(db, draftId, a, capped.catalogCardId, MAX_COPIES_PER_PLAYER);

    expect(() => drafts.pickCard(draftId, a, capped.id)).toThrow(`You already have ${MAX_COPIES_PER_PLAYER} copies of this card`);
    expect(drafts.pickOptions(draftId, a).map((card) => card.id)).toEqual(pack.slice(1).map((card) => card.id));
    // The whole pack stays visible so the room can show the blocked card.
    expect(drafts.currentPackOptions(draftId, a)).toHaveLength(4);
    expect(drafts.heldCopies(draftId, a)).toEqual({ [capped.catalogCardId]: MAX_COPIES_PER_PLAYER });
    // The card is still unpicked: the failed pick changed nothing.
    expect(db.prepare("select picked_by_player_id as p from draft_cards where id = ?").get(capped.id)).toEqual({ p: null });
  });

  it("allows a third copy, then blocks the next", () => {
    const { db, drafts, draftId, a } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const target = drafts.currentPackOptions(draftId, a)[0];
    grantCopies(db, draftId, a, target.catalogCardId, MAX_COPIES_PER_PLAYER - 1);

    expect(drafts.pickOptions(draftId, a).map((card) => card.id)).toContain(target.id);
    drafts.pickCard(draftId, a, target.id);
    expect(drafts.heldCopies(draftId, a)[target.catalogCardId]).toBe(MAX_COPIES_PER_PLAYER);
  });

  it("auto-pick on timeout never picks a capped card", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const pack = drafts.currentPackOptions(draftId, a);
    const allowed = pack[2];
    for (const card of pack) {
      if (card.id !== allowed.id) grantCopies(db, draftId, a, card.catalogCardId, MAX_COPIES_PER_PLAYER);
    }

    expireNow(db, draftId);
    const result = drafts.expireCurrentPickStep(draftId);

    expect(result.autoPickedPlayerIds.sort()).toEqual([a, b].sort());
    const picked = db
      .prepare(
        `select dc.id as id from draft_picks pk join draft_cards dc on dc.id = pk.draft_card_id
          where pk.draft_id = ? and pk.player_id = ? and pk.pick_step = 1`,
      )
      .get(draftId, a) as { id: number };
    expect(picked.id).toBe(allowed.id);
  });

  it("passes the pick when every card in the pack is capped, and the next step still runs", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const aPack = drafts.currentPackOptions(draftId, a);
    const bPack = drafts.currentPackOptions(draftId, b);
    // Step 2 hands A the rest of B's pack. A holds the maximum of every card in it.
    for (const card of bPack) grantCopies(db, draftId, a, card.catalogCardId, MAX_COPIES_PER_PLAYER);

    drafts.pickCard(draftId, a, aPack[0].id);
    drafts.pickCard(draftId, b, bPack[0].id);

    const afterStep = drafts.findById(draftId);
    expect(afterStep.currentPickStep).toBe(2);
    // A passed step 2 on their own: no card, no stall, no human click.
    expect(drafts.pickOptions(draftId, a)).toEqual([]);
    expect(drafts.hasPassedStep(draftId, a)).toBe(true);
    expect(db.prepare("select count(*) as n from draft_passes where draft_id = ? and player_id = ? and pick_step = 2").get(draftId, a)).toEqual({ n: 1 });
    expect(db.prepare("select pick_count from draft_players where draft_id = ? and player_id = ?").get(draftId, a)).toEqual({ pick_count: 1 });
    expect(() => drafts.pickCard(draftId, a, bPack[1].id)).toThrow("Player has no card to pick this step");

    // B is the only player left to act. B's pick closes the step.
    const bNext = drafts.pickOptions(draftId, b);
    expect(bNext).toHaveLength(3);
    drafts.pickCard(draftId, b, bNext[0].id);
    expect(drafts.findById(draftId).currentPickStep).toBe(3);
  });

  it("a timeout closes a step where one player passed and the other is idle", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const aPack = drafts.currentPackOptions(draftId, a);
    const bPack = drafts.currentPackOptions(draftId, b);
    for (const card of bPack) grantCopies(db, draftId, a, card.catalogCardId, MAX_COPIES_PER_PLAYER);
    drafts.pickCard(draftId, a, aPack[0].id);
    drafts.pickCard(draftId, b, bPack[0].id);

    expireNow(db, draftId);
    const result = drafts.expireCurrentPickStep(draftId);

    expect(result.autoPickedPlayerIds).toEqual([b]);
    expect(drafts.findById(draftId).currentPickStep).toBe(3);
  });

  it("ends the draft when no remaining card can be taken, and a passing player finishes with fewer cards", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 8 }, distinctCube(8));
    // A holds the maximum of all 8 cards, so A can never pick. B picks everything.
    for (let id = 1; id <= 8; id += 1) grantCopies(db, draftId, a, id, MAX_COPIES_PER_PLAYER);
    expireNow(db, draftId);
    drafts.expireCurrentPickStep(draftId);

    for (let guard = 0; guard < 30 && drafts.findById(draftId).status === "active"; guard += 1) {
      const options = drafts.pickOptions(draftId, b);
      expect(options.length).toBeGreaterThan(0);
      drafts.pickCard(draftId, b, options[0].id);
    }

    expect(drafts.findById(draftId).status).toBe("completed");
    expect(db.prepare("select pick_count from draft_players where draft_id = ? and player_id = ?").get(draftId, b)).toEqual({ pick_count: 8 });
    expect(db.prepare("select pick_count from draft_players where draft_id = ? and player_id = ?").get(draftId, a)).toEqual({ pick_count: 0 });
  });

  it("opens the next wave when everything left in a wave is capped for every player", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 }, distinctCube(16));
    const waveOneCards = (
      db.prepare("select distinct catalog_card_id as id from draft_cards where draft_id = ? and wave_number = 1").all(draftId) as Array<{ id: number }>
    ).map((row) => row.id);
    for (const id of waveOneCards) {
      grantCopies(db, draftId, a, id, MAX_COPIES_PER_PLAYER);
      grantCopies(db, draftId, b, id, MAX_COPIES_PER_PLAYER);
    }

    expireNow(db, draftId);
    drafts.expireCurrentPickStep(draftId);

    const after = drafts.findById(draftId);
    expect(after.status).toBe("active");
    expect(after.currentPackRound).toBe(2);
    expect(after.currentPickStep).toBe(1);
    expect(drafts.pickOptions(draftId, a)).toHaveLength(4);
    expect(drafts.pickOptions(draftId, b)).toHaveLength(4);
  });

  it("plays a whole draft from a cube with many copies and never gives a player a fourth copy", () => {
    // 12 distinct cards, 5 copies each: players who hoard one card hit the cap and must be routed around it.
    const cube = Array.from({ length: 12 }, (_, i) => Array(5).fill(i + 1)).flat();
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 5, cardsPerPlayer: 20 }, cube, 12);
    const players = [a, b];

    for (let guard = 0; guard < 400 && drafts.findById(draftId).status === "active"; guard += 1) {
      for (const playerId of players) {
        const held = drafts.heldCopies(draftId, playerId);
        // Always take the card the player already holds the most of, to run into the cap.
        const options = [...drafts.pickOptions(draftId, playerId)].sort(
          (x, y) => (held[y.catalogCardId] ?? 0) - (held[x.catalogCardId] ?? 0),
        );
        if (options.length > 0) drafts.pickCard(draftId, playerId, options[0].id);
      }
    }

    expect(drafts.findById(draftId).status).toBe("completed");
    for (const playerId of players) {
      expect(drafts.pool(draftId, playerId)).toHaveLength(20);
      for (const [, copies] of heldByPlayer(db, draftId, playerId)) {
        expect(copies).toBeLessThanOrEqual(MAX_COPIES_PER_PLAYER);
      }
    }
  });

  it.each([
    [3, 15, 5, 6, 7919, false], [3, 15, 5, 6, 15838, true], [3, 15, 5, 6, 23757, true],
    [4, 16, 4, 8, 7919, true], [4, 16, 4, 8, 15838, true], [4, 16, 4, 8, 23757, false],
  ] as const)("preserves packs and reachable deck sizes (%i players, %i names, pack %i × %i, seed %i, passes %s)", (count, distinct, packSize, waves, seed, expectPass) => {
    const db = new Database(":memory:");
    migrate(db);
    seedCards(db, distinct);
    let state = seed;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const drafts = createDraftService(db, { seedSource: () => seed, random });
    const players = Array.from({ length: count }, (_, i) => insertPlayer(db, `P${i}`));
    const cardsPerPlayer = packSize * waves;
    const draft = drafts.create("g", "c", "seeded cap property", {
      cubeCardIds: distinctCube(distinct).flatMap((id) => Array(10).fill(id)),
      packSize, packsPerPlayer: waves, cardsPerPlayer,
    }, "host", players[0]);
    for (const id of players.slice(1)) drafts.join(draft.id, id);
    drafts.start(draft.id);
    const collisions = db.prepare(
      `select p.current_holder_seat_index from draft_packs p
       where p.draft_id = ? and p.wave_number = ?
         and exists (select 1 from draft_cards c where c.draft_pack_id = p.id and c.picked_by_player_id is null)
       group by p.current_holder_seat_index having count(*) > 1`,
    );
    let sawEarlyFinisher = false;
    let sawCap = false;
    let sawPass = false;
    for (let guard = 0; guard < 1000 && drafts.findById(draft.id).status === "active"; guard += 1) {
      const current = drafts.findById(draft.id);
      expect(collisions.all(draft.id, current.currentPackRound)).toEqual([]);
      const playerId = players.find((id) => drafts.pickOptions(draft.id, id).length > 0);
      // All-pass steps are settled synchronously; a takeable card must surface.
      expect(playerId).toBeDefined();
      const options = drafts.pickOptions(draft.id, playerId!);
      drafts.pickCard(draft.id, playerId!, options[Math.floor(random() * options.length)].id);
      expect(collisions.all(draft.id, drafts.findById(draft.id).currentPackRound)).toEqual([]);
      const counts = players.map((id) => drafts.pool(draft.id, id).length);
      sawEarlyFinisher ||= counts.some((n) => n === cardsPerPlayer) && counts.some((n) => n < cardsPerPlayer);
      sawPass ||= Boolean(db.prepare("select 1 from draft_passes where draft_id = ? limit 1").get(draft.id));
      for (const id of players) {
        for (const copies of Object.values(drafts.heldCopies(draft.id, id))) {
          expect(copies).toBeLessThanOrEqual(MAX_COPIES_PER_PLAYER);
          sawCap ||= copies === MAX_COPIES_PER_PLAYER;
        }
      }
    }
    expect(drafts.findById(draft.id).status).toBe("completed");
    expect(sawEarlyFinisher).toBe(true);
    expect(sawCap).toBe(true);
    if (expectPass) expect(sawPass).toBe(true);
    const remaining = db.prepare("select distinct catalog_card_id as id from draft_cards where draft_id = ? and picked_by_player_id is null")
      .all(draft.id) as Array<{ id: number }>;
    for (const id of players) {
      const picked = drafts.pool(draft.id, id).length;
      expect(picked).toBeLessThanOrEqual(cardsPerPlayer);
      expect(db.prepare("select pick_count as n from draft_players where draft_id = ? and player_id = ?").get(draft.id, id)).toEqual({ n: picked });
      if (picked < cardsPerPlayer) {
        expect(remaining.length).toBeGreaterThan(0);
        const held = drafts.heldCopies(draft.id, id);
        for (const card of remaining) expect(held[card.id]).toBe(MAX_COPIES_PER_PLAYER);
      }
    }
    db.close();
  });
});

describe("per-player copy cap in theme drafts", () => {
  function themeDraft(cubes: Array<Array<[number, number]>>, config: Partial<DraftConfig>) {
    const db = new Database(":memory:");
    migrate(db);
    seedCards(db, 20);
    const catalog = createCardCatalogService(db, {
      fetch: async () => ({ ok: true, async json() { return { data: [] }; } }) as Response,
    });
    const cubesService = createCubeService(db, catalog);
    const drafts = createDraftService(db, { seedSource: () => 3 });
    const cubeIds = cubes.map((cards, index) => {
      const cube = cubesService.createBlank("g", `Cube ${index}`, "host");
      for (const [cardId, copies] of cards) cubesService.addCard(cube.id, cardId, "main", copies);
      return cube.id;
    });
    const players = cubes.map((_, index) => insertPlayer(db, `P${index}`));
    const draft = drafts.create(
      "g", "c", "theme cap",
      {
        mode: "theme",
        allowedCubeIds: cubeIds,
        themeSelection: "host_assigned",
        themeAssignments: Object.fromEntries(players.map((playerId, index) => [String(playerId), cubeIds[index]])),
        extraDeckEnabled: false,
        ...config,
      },
      "host",
      players[0],
    );
    for (const playerId of players.slice(1)) drafts.join(draft.id, playerId);
    return { db, drafts, cubesService, cubeIds, players, draftId: draft.id, start: () => drafts.start(draft.id) };
  }

  it("never deals a card the player already holds three of, and rejects picking it", () => {
    // Card 1 is in the cube 10 times; cards 2 and 3 once each. Packs hold 2 choices.
    const cube: Array<[number, number]> = [[1, 10], [2, 1], [3, 1]];
    const { db, drafts, players, draftId, start } = themeDraft([cube, cube], { cardsPerPlayer: 3, themePackSize: 2 });
    start();
    const [p0, p1] = players;
    const first = drafts.currentPackOptions(draftId, p0);
    expect(first.map((card) => card.catalogCardId)).toContain(1);
    grantCopies(db, draftId, p0, 1, MAX_COPIES_PER_PLAYER);

    const cardOne = first.find((card) => card.catalogCardId === 1);
    if (cardOne) {
      expect(() => drafts.pickCard(draftId, p0, cardOne.id)).toThrow(`You already have ${MAX_COPIES_PER_PLAYER} copies of this card`);
    }

    for (let guard = 0; guard < 10 && drafts.findById(draftId).status === "active"; guard += 1) {
      for (const playerId of [p0, p1]) {
        const options = drafts.pickOptions(draftId, playerId);
        if (playerId === p0) expect(options.map((card) => card.catalogCardId)).not.toContain(1);
        if (options.length > 0) drafts.pickCard(draftId, playerId, options[0].id);
      }
    }

    expect(heldByPlayer(db, draftId, p0).get(1)).toBe(MAX_COPIES_PER_PLAYER);
    expect(drafts.findById(draftId).status).toBe("completed");
  });

  it("deals from the remaining allowed cards and finishes a player who has none left", () => {
    const cube: Array<[number, number]> = [[1, 10], [2, 1]];
    const { db, drafts, players, draftId, start } = themeDraft([cube, cube], { cardsPerPlayer: 3, themePackSize: 2 });
    start();
    const [p0, p1] = players;
    grantCopies(db, draftId, p0, 1, MAX_COPIES_PER_PLAYER);

    // p0 takes card 2 (card 1 is capped); p1 takes whatever is offered.
    const p0Pick = drafts.pickOptions(draftId, p0);
    expect(p0Pick.map((card) => card.catalogCardId)).toEqual([2]);
    drafts.pickCard(draftId, p0, p0Pick[0].id);
    drafts.pickCard(draftId, p1, drafts.pickOptions(draftId, p1)[0].id);

    // Round 2: card 1 is capped and card 2 is used up, so p0 gets no pack.
    expect(drafts.currentPackOptions(draftId, p0)).toEqual([]);
    expect(db.prepare("select finished_at from draft_players where draft_id = ? and player_id = ?").get(draftId, p0)).not.toEqual({ finished_at: null });
    expect(drafts.pickOptions(draftId, p1).length).toBeGreaterThan(0);
  });

  it("refuses to start when a cube cannot fill a deck within the three-copy limit", () => {
    // 2 cards x 99 copies is 198 cards, but one player can take only 6 of them.
    const heavy: Array<[number, number]> = [[1, 99], [2, 99]];
    const { start } = themeDraft([heavy, heavy], { cardsPerPlayer: 10, themePackSize: 1 });
    expect(() => start()).toThrow(/at most 3 copies of a card/);
  });

  it("rejects a burn pool whose excess copies hide too few reachable choices", () => {
    const narrow: Array<[number, number]> = [
      ...distinctCube(14).map((id): [number, number] => [id, 3]), [15, 99],
    ];
    const { drafts, draftId, start, cubesService, cubeIds } = themeDraft([narrow, narrow], {
      cardsPerPlayer: 40, themePackSize: 3, burnUnpicked: true,
    });
    const analysis = cubesService.analyzeCubePools(cubeIds[0], {
      cardsPerPlayer: 40, themePackSize: 3, burnUnpicked: true, extraDeckEnabled: false, extraDeckSize: 0,
    });
    expect(analysis.ok).toBe(false);
    expect(analysis.errors.join(" ")).toMatch(/burn/i);
    expect(() => start()).toThrow(/burn/i);
    expect(drafts.findById(draftId).status).toBe("pending");
  });

  it("fills a burn deck when the conservative reachable bound is met", () => {
    const enough: Array<[number, number]> = distinctCube(15).map((id) => [id, 3]);
    const { drafts, draftId, start, players } = themeDraft([enough, enough], {
      cardsPerPlayer: 15, themePackSize: 3, burnUnpicked: true,
    });
    start();
    for (let guard = 0; guard < 40 && drafts.findById(draftId).status === "active"; guard += 1) {
      for (const playerId of players) {
        const options = drafts.pickOptions(draftId, playerId);
        if (options.length) drafts.pickCard(draftId, playerId, options[0].id);
      }
    }
    expect(players.map((id) => drafts.pool(draftId, id).length)).toEqual([15, 15]);
  });
});

describe("cube copies above the per-player cap", () => {
  it("lets a cube hold 99 copies and starts a booster draft from it", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedCards(db, 20);
    const catalog = createCardCatalogService(db, {
      fetch: async () => ({ ok: true, async json() { return { data: [] }; } }) as Response,
    });
    const cubes = createCubeService(db, catalog);
    const cube = cubes.createBlank("g", "Heavy", "host");
    cubes.addCard(cube.id, 1, "main", 99);
    expect(cubes.getCubePools(cube.id).main[0].maxCopies).toBe(99);
    expect(() => cubes.addCard(cube.id, 2, "main", 100)).toThrow(/1 to 99/);

    const drafts = createDraftService(db, { seedSource: () => 1 });
    const a = insertPlayer(db, "A");
    const b = insertPlayer(db, "B");
    const ids = [...Array(8).fill(1), ...distinctCube(20).slice(1, 20)];
    const draft = drafts.create("g", "c", "heavy", { cubeCardIds: ids, packSize: 4, packsPerPlayer: 2 }, "host", a);
    drafts.join(draft.id, b);
    expect(drafts.start(draft.id).status).toBe("active");
  });
});

describe("a draft that started under the old pack rotation", () => {
  const unpicked = (db: Database.Database, draftId: number) =>
    (db.prepare("select count(*) as n from draft_cards where draft_id = ? and picked_by_player_id is null").get(draftId) as { n: number }).n;

  it("does not loop forever when packs stack on one seat and the first one is capped for everybody", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4 }, distinctCube(8));
    // Old rotation let two packs end up on the same seat. A seat only offers the lowest pack id on it.
    const packs = db.prepare("select id from draft_packs where draft_id = ? order by id").all(draftId) as Array<{ id: number }>;
    db.prepare("update draft_packs set current_holder_seat_index = 0 where draft_id = ?").run(draftId);
    const shadowing = db.prepare("select catalog_card_id as id from draft_cards where draft_pack_id = ?").all(packs[0].id) as Array<{ id: number }>;
    for (const card of shadowing) {
      grantCopies(db, draftId, a, card.id, MAX_COPIES_PER_PLAYER);
      grantCopies(db, draftId, b, card.id, MAX_COPIES_PER_PLAYER);
    }
    const before = unpicked(db, draftId);

    expireNow(db, draftId);
    drafts.expireCurrentPickStep(draftId);

    // The draft goes on (it is not ended), nothing was picked for anyone, and the stacked packs are on
    // two different seats again, so pack 2 is where a player can take from it.
    expect(drafts.findById(draftId).status).toBe("active");
    expect(unpicked(db, draftId)).toBe(before);
    const holders = db.prepare("select id, current_holder_seat_index as seat from draft_packs where draft_id = ? order by id").all(draftId) as Array<{ id: number; seat: number }>;
    expect(new Set(holders.map((pack) => pack.seat)).size).toBe(2);
    const pack2Seat = holders.find((pack) => pack.id === packs[1].id)!.seat;
    const pack2Holder = pack2Seat === 0 ? a : b;
    expect(drafts.pickOptions(draftId, pack2Holder).length).toBeGreaterThan(0);
    db.close();
  });

  it("ends the wave when the table is still stuck after the packs go back to their origin seats", () => {
    const { db, drafts, draftId, a, b } = boosterDraft({ packSize: 4, packsPerPlayer: 1, cardsPerPlayer: 4 }, distinctCube(8));
    // A holds all their picks but is not marked finished, so A can never take a card. B holds three copies
    // of every card. A card still looks pickable for A, and no pack order can give it to anyone.
    db.prepare("update draft_players set pick_count = 4 where draft_id = ? and player_id = ?").run(draftId, a);
    for (let id = 1; id <= 8; id += 1) grantCopies(db, draftId, b, id, MAX_COPIES_PER_PLAYER);
    const before = unpicked(db, draftId);

    expireNow(db, draftId);
    drafts.expireCurrentPickStep(draftId);

    expect(drafts.findById(draftId).status).toBe("completed");
    expect(unpicked(db, draftId)).toBe(before);
    db.close();
  });
});
