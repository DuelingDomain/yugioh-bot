import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { seededShuffle } from "../../src/services/deal.js";
import { createDraftService } from "../../src/services/drafts.js";

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, displayName: string) {
  const result = db
    .prepare(
      `
        insert into players (guild_id, discord_user_id, display_name)
        values (?, ?, ?)
      `,
    )
    .run(guildId, discordUserId, displayName);

  return {
    id: Number(result.lastInsertRowid),
    guildId,
    discordUserId,
    displayName,
  };
}

function setup(options: { random?: () => number; seedSource?: () => number | string } = {}) {
  const db = new Database(":memory:");
  migrate(db);

  return {
    db,
    drafts: createDraftService(db, options),
  };
}

function seedCatalogCards(db: Database.Database, count: number) {
  const insertCard = db.prepare(
    `
      insert into card_catalog (
        ygoprodeck_id,
        name,
        type,
        frame_type,
        image_url,
        image_url_small,
        card_sets_json,
        cached_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (let id = 1; id <= count; id += 1) {
    insertCard.run(
      id,
      `Card ${id}`,
      "Spellcaster / Normal Monster",
      "normal",
      `https://img/full/${id}`,
      `https://img/small/${id}`,
      JSON.stringify([{ set_name: "Metal Raiders" }]),
      "2026-01-01T00:00:00Z",
    );
  }
}

describe("shared draft service", () => {
  it.each(["set", "names"].flatMap((source) => [[61], [61, 1, 1, 62, 999]].map((customCardIds) => ({ source, customCardIds }))))("expands only the $source cards in a mixed pool and preserves custom copies $customCardIds", ({ source, customCardIds }) => {
    const { db, drafts } = setup({ seedSource: () => 7 });
    try {
      seedCatalogCards(db, 62);
      db.prepare("update card_catalog set card_sets_json = '[]' where ygoprodeck_id > 60").run();
      db.prepare("update card_catalog set frame_type = 'fusion' where ygoprodeck_id = 62").run();
      const players = Array.from({ length: 3 }, (_, i) => insertPlayer(db, "guild-1", `u${i}`, `P${i}`));
      const baseIds = Array.from({ length: 60 }, (_, i) => i + 1);
      const pool = source === "set" ? { setNames: ["Metal Raiders"] } : { includeNames: baseIds.map((id) => `Card ${id}`) };
      const draft = drafts.create("guild-1", "channel-1", "mixed pool", {
        ...pool, customCardIds, packSize: 8, packsPerPlayer: 5,
      }, "u0", players[0].id);
      for (const player of players.slice(1)) drafts.join(draft.id, player.id);

      expect(drafts.start(draft.id).status).toBe("active");
      const dealt = db.prepare("select catalog_card_id as id from draft_deal where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
      const remainder = db.prepare("select catalog_card_id as id from draft_undealt where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
      const copies = [...baseIds.flatMap((id) => [id, id]), ...customCardIds.filter((id) => id !== 62 && id !== 999)];
      expect(dealt).toHaveLength(120);
      expect([...dealt, ...remainder].map((card) => card.id)).toEqual(seededShuffle(copies, 7));
    } finally { db.close(); }
  });

  it.each([3, 4, 8].flatMap((count) => ["set", "names"].map((source) => ({ count, source }))))("deals one shuffle of evenly expanded $source copies for $count players", ({ count, source }) => {
    const { db, drafts } = setup({ seedSource: () => 7 });
    try {
      seedCatalogCards(db, 100);
      const players = Array.from({ length: count }, (_, i) => insertPlayer(db, "guild-1", `u${i}`, `P${i}`));
      const pool = source === "set" ? { setNames: ["Metal Raiders"] } : { includeNames: Array.from({ length: 100 }, (_, i) => `Card ${i + 1}`) };
      const draft = drafts.create("guild-1", "channel-1", "set night", { ...pool, packSize: 8, packsPerPlayer: 5 }, "u0", players[0].id);
      for (const player of players.slice(1)) drafts.join(draft.id, player.id);
      expect(drafts.start(draft.id).status).toBe("active");
      const slots = count * 8 * 5;
      const ids = Array.from({ length: 100 }, (_, i) => i + 1);
      const copies = ids.flatMap((id) => Array(Math.ceil(slots / ids.length)).fill(id));
      const dealt = db.prepare("select catalog_card_id as id from draft_deal where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
      const remainder = db.prepare("select catalog_card_id as id from draft_undealt where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
      expect([...dealt, ...remainder].map((card) => card.id)).toEqual(seededShuffle(copies, 7));
      expect(dealt).toHaveLength(slots);
      for (const player of players) expect(drafts.currentPackOptions(draft.id, player.id)).toHaveLength(8);
    } finally { db.close(); }
  });

  it.each(["injected", "default crypto"])("persists different deals for identical drafts using %s seeds", (source) => {
    const dealForSeed = (seed?: number | string) => {
      const { db, drafts } = setup(seed === undefined ? {} : { seedSource: () => seed });
      try {
        const yugi = insertPlayer(db, "guild-1", "user-1", "Yugi");
        const kaiba = insertPlayer(db, "guild-1", "user-2", "Kaiba");
        seedCatalogCards(db, 80);
        const draft = drafts.create(
          "guild-1", "channel-1", "cube night",
          { cubeCardIds: Array.from({ length: 80 }, (_, i) => i + 1) }, "user-1", yugi.id,
        );
        drafts.join(draft.id, kaiba.id);
        drafts.start(draft.id);
        return db.prepare("select catalog_card_id from draft_deal where draft_id = ? order by position").all(draft.id);
      } finally {
        db.close();
      }
    };

    const firstSeed = source === "injected" ? "a".repeat(64) : undefined;
    const secondSeed = source === "injected" ? "b".repeat(64) : undefined;
    const first = dealForSeed(firstSeed);
    expect(first).toHaveLength(80);
    if (source === "injected") expect(dealForSeed(firstSeed)).toEqual(first);
    expect(dealForSeed(secondSeed)).not.toEqual(first);
  });

  it("reads later waves from the stored deal without requesting another seed", () => {
    const { db, drafts } = setup({ seedSource: () => 555 });
    try {
      const yugi = insertPlayer(db, "guild-1", "user-1", "Yugi");
      const kaiba = insertPlayer(db, "guild-1", "user-2", "Kaiba");
      seedCatalogCards(db, 8);
      const draft = drafts.create(
        "guild-1", "channel-1", "cube night",
        { cubeCardIds: [1, 2, 3, 4, 5, 6, 7, 8], packsPerPlayer: 2, packSize: 2, cardsPerPlayer: 4 },
        "user-1", yugi.id,
      );
      drafts.join(draft.id, kaiba.id);
      drafts.start(draft.id);
      const storedDeal = db.prepare("select catalog_card_id from draft_deal where draft_id = ? order by position")
        .all(draft.id) as Array<{ catalog_card_id: number }>;
      const resumed = createDraftService(db, { seedSource: () => { throw new Error("Deal must not be rebuilt"); } });
      for (let step = 0; step < 2; step++) {
        for (const playerId of [yugi.id, kaiba.id]) {
          resumed.pickCard(draft.id, playerId, resumed.currentPackOptions(draft.id, playerId)[0].id, "manual");
        }
      }
      expect(resumed.findById(draft.id).currentPackRound).toBe(2);
      expect(resumed.currentPackOptions(draft.id, yugi.id).map((card) => card.catalogCardId))
        .toEqual(storedDeal.slice(4, 6).map((row) => row.catalog_card_id));
    } finally {
      db.close();
    }
  });

  it("creates a pending draft, stores config, and auto-joins the creator", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");

    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "cube night",
      {
        setNames: ["Battle Pack 3"],
        includeNames: ["Dark Magician"],
        excludeNames: ["Pot of Greed"],
      },
      "user-1",
      yugi.id,
    );

    expect(draft).toEqual({
      id: expect.any(Number),
      guildId: "guild-1",
      channelId: "channel-1",
      name: "cube night",
      status: "pending",
      createdByUserId: "user-1",
      config: {
        setNames: ["Battle Pack 3"],
        includeNames: ["Dark Magician"],
        excludeNames: ["Pot of Greed"],
        packSize: 8,
        packsPerPlayer: 5,
        cardsPerPlayer: 40,
        pickSeconds: 45,
        alternatePassDirection: true,
        randomizeSeats: false,
        copyLimit: true,
      },
      currentPackRound: 0,
      currentPickStep: 0,
      pickDeadlineAt: null,
      statusMessageId: null,
      webSlug: expect.any(String),
    });
    expect(app.drafts.players(draft.id)).toEqual([{ playerId: yugi.id, displayName: "Yugi" }]);
  });

  it("starts a draft by seating players and opening one 8-card pack per player", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", { setNames: ["Metal Raiders"] }, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);

    const started = app.drafts.start(draft.id, new Date("2026-05-01T00:00:00.000Z"));

    expect(started).toEqual(expect.objectContaining({
      id: draft.id,
      status: "active",
      currentPackRound: 1,
      currentPickStep: 1,
      pickDeadlineAt: "2026-05-01T00:00:45.000Z",
    }));
    expect(app.drafts.players(draft.id)).toEqual([
      { playerId: yugi.id, displayName: "Yugi", seatIndex: 0 },
      { playerId: kaiba.id, displayName: "Kaiba", seatIndex: 1 },
    ]);
    expect(app.drafts.currentPackOptions(draft.id, yugi.id)).toHaveLength(8);
    expect(app.drafts.currentPackOptions(draft.id, kaiba.id)).toHaveLength(8);
  });

  it.each(["booster", "cube"])("randomizes %s draft seats using the injected RNG", (pool) => {
    const randomValues = [0.5, 0, 0.5];
    const app = setup({ random: () => randomValues.shift()! });
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const joey = insertPlayer(app.db, "guild-1", "user-3", "Joey");
    const mai = insertPlayer(app.db, "guild-1", "user-4", "Mai");
    const draft = app.drafts.create(
      "guild-1", "channel-1", "random seats",
      {
        ...(pool === "cube" ? { cubeCardIds: [1, 2, 3, 4, 5, 6, 7, 8] } : { setNames: ["Metal Raiders"] }),
        packSize: 2, packsPerPlayer: 1, cardsPerPlayer: 2, randomizeSeats: true,
      },
      "user-1", yugi.id,
    );
    app.drafts.join(draft.id, kaiba.id);
    app.drafts.join(draft.id, joey.id);
    app.drafts.join(draft.id, mai.id);
    seedCatalogCards(app.db, 8);

    expect(app.drafts.players(draft.id).map((player) => player.playerId)).toEqual([
      yugi.id, kaiba.id, joey.id, mai.id,
    ]);

    app.drafts.start(draft.id);

    expect(app.db.prepare("select player_id, seat_index from draft_players where draft_id = ? order by seat_index").all(draft.id)).toEqual([
      { player_id: mai.id, seat_index: 0 },
      { player_id: kaiba.id, seat_index: 1 },
      { player_id: yugi.id, seat_index: 2 },
      { player_id: joey.id, seat_index: 3 },
    ]);
    expect(app.drafts.players(draft.id)).toEqual([
      { playerId: mai.id, displayName: "Mai", seatIndex: 0 },
      { playerId: kaiba.id, displayName: "Kaiba", seatIndex: 1 },
      { playerId: yugi.id, displayName: "Yugi", seatIndex: 2 },
      { playerId: joey.id, displayName: "Joey", seatIndex: 3 },
    ]);
  });

  it.each([false, undefined])("keeps join order when randomizeSeats is %s", (randomizeSeats) => {
    const app = setup({ random: () => { throw new Error("Seat randomization is disabled"); } });
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const joey = insertPlayer(app.db, "guild-1", "user-3", "Joey");
    const mai = insertPlayer(app.db, "guild-1", "user-4", "Mai");
    const draft = app.drafts.create(
      "guild-1", "channel-1", "join order",
      { packSize: 2, packsPerPlayer: 1, cardsPerPlayer: 2, randomizeSeats }, "user-1", yugi.id,
    );
    app.drafts.join(draft.id, joey.id);
    app.drafts.join(draft.id, mai.id);
    app.drafts.join(draft.id, kaiba.id);
    // Equal timestamps must retain the rowid tie-breaker, rather than player-id order.
    app.db.prepare("update draft_players set joined_at = ? where draft_id = ?").run("2026-05-01 00:00:00", draft.id);
    seedCatalogCards(app.db, 8);

    app.drafts.start(draft.id);

    expect(app.drafts.players(draft.id)).toEqual([
      { playerId: yugi.id, displayName: "Yugi", seatIndex: 0 },
      { playerId: joey.id, displayName: "Joey", seatIndex: 1 },
      { playerId: mai.id, displayName: "Mai", seatIndex: 2 },
      { playerId: kaiba.id, displayName: "Kaiba", seatIndex: 3 },
    ]);
  });

  it("passes packs between persisted shuffled neighbours in both directions", () => {
    const randomValues = [0.5, 0, 0.5];
    const app = setup({ random: () => randomValues.shift()! });
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const joey = insertPlayer(app.db, "guild-1", "user-3", "Joey");
    const mai = insertPlayer(app.db, "guild-1", "user-4", "Mai");
    const draft = app.drafts.create(
      "guild-1", "channel-1", "passing order",
      { packSize: 2, packsPerPlayer: 2, cardsPerPlayer: 4, alternatePassDirection: true, randomizeSeats: true },
      "user-1", yugi.id,
    );
    const playerIds = [yugi.id, kaiba.id, joey.id, mai.id];
    for (const playerId of playerIds.slice(1)) app.drafts.join(draft.id, playerId);
    seedCatalogCards(app.db, 16);
    app.drafts.start(draft.id);

    // A new service instance must use the stored seats: Mai, Kaiba, Yugi, Joey.
    const drafts = createDraftService(app.db);
    const firstPacks = playerIds.map((playerId) => drafts.currentPackOptions(draft.id, playerId));
    for (const [index, playerId] of playerIds.entries()) drafts.pickCard(draft.id, playerId, firstPacks[index][0].id);

    expect(drafts.currentPackOptions(draft.id, mai.id)).toEqual(firstPacks[2].slice(1));
    expect(drafts.currentPackOptions(draft.id, kaiba.id)).toEqual(firstPacks[3].slice(1));
    expect(drafts.currentPackOptions(draft.id, yugi.id)).toEqual(firstPacks[1].slice(1));
    expect(drafts.currentPackOptions(draft.id, joey.id)).toEqual(firstPacks[0].slice(1));

    for (const playerId of playerIds) drafts.pickCard(draft.id, playerId, drafts.currentPackOptions(draft.id, playerId)[0].id);
    expect(drafts.findById(draft.id).currentPackRound).toBe(2);
    const secondPacks = playerIds.map((playerId) => drafts.currentPackOptions(draft.id, playerId));
    for (const [index, playerId] of playerIds.entries()) drafts.pickCard(draft.id, playerId, secondPacks[index][0].id);

    expect(drafts.currentPackOptions(draft.id, mai.id)).toEqual(secondPacks[1].slice(1));
    expect(drafts.currentPackOptions(draft.id, kaiba.id)).toEqual(secondPacks[0].slice(1));
    expect(drafts.currentPackOptions(draft.id, yugi.id)).toEqual(secondPacks[2].slice(1));
    expect(drafts.currentPackOptions(draft.id, joey.id)).toEqual(secondPacks[3].slice(1));
  });

  it.each([["synchro_pendulum", "Synchro Pendulum Effect Monster"], ["xyz_pendulum", "XYZ Pendulum Effect Monster"]])("keeps %s cards out of the booster pool", (frame, type) => {
    const { db, drafts } = setup();
    seedCatalogCards(db, 2);
    db.prepare("update card_catalog set frame_type = ?, type = ? where ygoprodeck_id = 2").run(frame, type);
    expect(drafts.resolveCubeCardIds({ customCardIds: [1, 2] })).toEqual([1]);
    expect(drafts.resolveCubeCardIds({ setNames: ["Metal Raiders"] })).toEqual([1]);
    db.close();
  });

  it("uses custom card ids as an explicit draft pool", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "custom pool night",
      // 2 players × packSize 2 => 4 distinct needed for one wave.
      { setNames: ["Missing Set"], customCardIds: [101, 102, 103, 104], packSize: 2, packsPerPlayer: 1, cardsPerPlayer: 2 },
      "user-1",
      yugi.id,
    );

    app.drafts.join(draft.id, kaiba.id);

    const insertCard = app.db.prepare(
      `
        insert into card_catalog (
          ygoprodeck_id,
          name,
          type,
          frame_type,
          image_url,
          image_url_small,
          card_sets_json,
          cached_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const id of [101, 102, 103, 104]) {
      insertCard.run(
        id,
        `Custom Card ${id}`,
        "Spellcaster / Normal Monster",
        "normal",
        `https://img/full/${id}`,
        `https://img/small/${id}`,
        JSON.stringify([{ set_name: "Different Set" }]),
        "2026-01-01T00:00:00Z",
      );
    }

    app.drafts.start(draft.id);

    const openedCardIds = app.db
      .prepare("select distinct catalog_card_id from draft_cards where draft_id = ? order by catalog_card_id")
      .all(draft.id);

    expect(openedCardIds).toEqual([
      { catalog_card_id: 101 },
      { catalog_card_id: 102 },
      { catalog_card_id: 103 },
      { catalog_card_id: 104 },
    ]);
  });

  it("preserves duplicate custom card ids when resolving a draft pool", () => {
    const app = setup();
    const insertCard = app.db.prepare(
      `
        insert into card_catalog (
          ygoprodeck_id,
          name,
          type,
          frame_type,
          image_url,
          image_url_small,
          card_sets_json,
          cached_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const id of [101, 102]) {
      insertCard.run(
        id,
        `Custom Card ${id}`,
        "Spellcaster / Normal Monster",
        "normal",
        `https://img/full/${id}`,
        `https://img/small/${id}`,
        JSON.stringify([{ set_name: "Different Set" }]),
        "2026-01-01T00:00:00Z",
      );
    }

    expect(app.drafts.resolveCubeCardIds({ customCardIds: [101, 101, 102] })).toEqual([101, 101, 102]);
  });

  it("resolveCubeCardIds reads a legacy poolCardIds config key", () => {
    const app = setup();
    const ids = app.drafts.resolveCubeCardIds({ poolCardIds: [1, 2, 3] } as any);
    expect(ids).toEqual([1, 2, 3]);
  });

  it("resolveCubeCardIds prefers cubeCardIds when present", () => {
    const app = setup();
    const ids = app.drafts.resolveCubeCardIds({ cubeCardIds: [7, 8], poolCardIds: [1] } as any);
    expect(ids).toEqual([7, 8]);
  });

  it("records synchronized pick steps after all players pick", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", {}, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    app.drafts.start(draft.id);

    const yugiPick = app.drafts.currentPackOptions(draft.id, yugi.id)[0];
    const kaibaPick = app.drafts.currentPackOptions(draft.id, kaiba.id)[0];

    app.drafts.pickCard(draft.id, yugi.id, yugiPick.id);
    expect(app.drafts.findById(draft.id).currentPickStep).toBe(1);

    app.drafts.pickCard(draft.id, kaiba.id, kaibaPick.id);

    expect(app.drafts.findById(draft.id).currentPickStep).toBe(2);
    expect(app.drafts.picks(draft.id)).toEqual([
      expect.objectContaining({ playerId: yugi.id, draftCardId: yugiPick.id, waveNumber: 1, pickStep: 1 }),
      expect.objectContaining({ playerId: kaiba.id, draftCardId: kaibaPick.id, waveNumber: 1, pickStep: 1 }),
    ]);
  });

  it("recordManualPick returns alreadyPicked: true when expiry auto-picked the player before the manual pick runs", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", { packSize: 8, packsPerPlayer: 5 }, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    app.drafts.start(draft.id);

    // Get a valid card from Yugi's current pack
    const options = app.drafts.currentPackOptions(draft.id, yugi.id);
    expect(options.length).toBeGreaterThan(0);
    const cardId = options[0].id;

    // Set deadline to the past so the next expiry fires immediately
    app.db
      .prepare("update drafts set pick_deadline_at = ? where id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), draft.id);

    // recordManualPick fires expiry inside the transaction, which auto-picks Yugi
    const started = app.drafts.findById(draft.id);
    const result = app.drafts.recordManualPick(draft.id, yugi.id, cardId);

    expect(result).toEqual({ alreadyPicked: true });

    // A pick row must exist for Yugi at the current wave/step
    const pickRow = app.db
      .prepare(
        "select * from draft_picks where draft_id = ? and player_id = ? and wave_number = ? and pick_step = ?",
      )
      .get(draft.id, yugi.id, started.currentPackRound, started.currentPickStep);

    expect(pickRow).toBeTruthy();
  });

  it("recordManualPick records the manual pick and returns alreadyPicked: false when no expiry fires", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", { packSize: 8, packsPerPlayer: 5 }, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    // Deadline is in the future after start, so expiry will not fire
    app.drafts.start(draft.id, new Date());

    const options = app.drafts.currentPackOptions(draft.id, yugi.id);
    expect(options.length).toBeGreaterThan(0);
    const cardId = options[0].id;

    const result = app.drafts.recordManualPick(draft.id, yugi.id, cardId);

    expect(result).toEqual({ alreadyPicked: false });

    // A pick row with pick_method = 'manual' must exist
    const pickRow = app.db
      .prepare("select * from draft_picks where draft_id = ? and player_id = ?")
      .get(draft.id, yugi.id) as { pick_method: string } | undefined;

    expect(pickRow).toBeTruthy();
    expect(pickRow?.pick_method).toBe("manual");
  });

  it.each([30, 60])("exports all picks in a %s-card draft", (cardsPerPlayer) => {
    const { db, drafts } = setup({ seedSource: () => 7 });
    const a = insertPlayer(db, "g", "a", "A");
    const b = insertPlayer(db, "g", "b", "B");
    seedCatalogCards(db, 2 * cardsPerPlayer);
    const draft = drafts.create("g", "c", "Export", { packSize: 15, packsPerPlayer: cardsPerPlayer / 15, cardsPerPlayer }, "a", a.id);
    drafts.join(draft.id, b.id);
    drafts.start(draft.id);
    expect(() => drafts.exportYdk(draft.id, a.id)).toThrow("Deck is not complete yet");
    for (let step = 0; step < cardsPerPlayer; step++) {
      for (const id of [a.id, b.id]) drafts.pickCard(draft.id, id, drafts.currentPackOptions(draft.id, id)[0].id);
    }
    const lines = drafts.exportYdk(draft.id, a.id).split("\n");
    expect(lines.slice(1, lines.indexOf("#extra"))).toEqual(drafts.pool(draft.id, a.id).map((card) => String(card.catalogCardId)));
    expect(lines.indexOf("#extra")).toBe(cardsPerPlayer + 1);
    db.close();
  });

  it("exports a completed old draft even with fewer picks than its target", () => {
    const { db, drafts } = setup();
    const a = insertPlayer(db, "g", "a", "A");
    const draft = drafts.create("g", "c", "Old export", { cardsPerPlayer: 40 }, "a", a.id);
    db.prepare("update drafts set status = 'completed' where id = ?").run(draft.id);
    expect(drafts.exportYdk(draft.id, a.id)).toContain("#main\n#extra");
    db.close();
  });

  it("exports a completed deck in YGOPro YDK format", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", { packSize: 8, packsPerPlayer: 5 }, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    app.drafts.start(draft.id);

    // Pick 40 cards to complete the deck (both players need to pick so packs pass)
    for (let i = 0; i < 40; i++) {
      const yugiOptions = app.drafts.currentPackOptions(draft.id, yugi.id);
      const kaibaOptions = app.drafts.currentPackOptions(draft.id, kaiba.id);
      if (yugiOptions.length > 0) {
        app.drafts.pickCard(draft.id, yugi.id, yugiOptions[0].id);
      }
      if (kaibaOptions.length > 0) {
        app.drafts.pickCard(draft.id, kaiba.id, kaibaOptions[0].id);
      }
    }

    const ydk = app.drafts.exportYdk(draft.id, yugi.id);

    // Verify YDK format
    const lines = ydk.split("\n");
    expect(lines[0]).toBe("#main");
    expect(lines[41]).toBe("#extra");
    expect(lines[42]).toBe("");
    expect(lines[43]).toBe("!side");
    expect(lines[44]).toBe("");
    expect(lines.length).toBe(45);

    // Verify card IDs are present
    for (let i = 1; i <= 40; i++) {
      expect(lines[i]).toMatch(/^\d+$/);
    }
  });

  it("creates the draft_deal table on migrate", () => {
    const app = setup();
    const row = app.db
      .prepare("select name from sqlite_master where type = 'table' and name = 'draft_deal'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("draft_deal");

    const columns = (app.db.pragma("table_info(draft_deal)") as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["draft_id", "position", "catalog_card_id"]));
  });

  it("respects a custom cardsPerPlayer cap above the default 40", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    // 5 packs of 10 => 50 cards available per player, target 50
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "big draft",
      { packSize: 10, packsPerPlayer: 5, cardsPerPlayer: 50 },
      "user-1",
      yugi.id,
    );

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 100);
    app.drafts.start(draft.id);

    for (let i = 0; i < 60; i++) {
      const yugiOptions = app.drafts.currentPackOptions(draft.id, yugi.id);
      const kaibaOptions = app.drafts.currentPackOptions(draft.id, kaiba.id);
      if (yugiOptions.length > 0) app.drafts.pickCard(draft.id, yugi.id, yugiOptions[0].id);
      if (kaibaOptions.length > 0) app.drafts.pickCard(draft.id, kaiba.id, kaibaOptions[0].id);
    }

    const yugiRow = app.db
      .prepare("select pick_count, finished_at from draft_players where draft_id = ? and player_id = ?")
      .get(draft.id, yugi.id) as { pick_count: number; finished_at: string | null };
    expect(yugiRow.pick_count).toBe(50);
    expect(yugiRow.finished_at).not.toBeNull();

    const draftRow = app.db.prepare("select status from drafts where id = ?").get(draft.id) as { status: string };
    expect(draftRow.status).toBe("completed");
  });

  it("openWave falls back to the legacy generator when no draft_deal rows exist", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "legacy night", {}, "user-1", yugi.id);

    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    app.drafts.start(draft.id);

    // After Task 6, startDraft materializes deal rows, so the cube path runs.
    const cubeCount = (
      app.db.prepare("select count(*) as n from draft_deal where draft_id = ?").get(draft.id) as { n: number }
    ).n;
    expect(cubeCount).toBe(80);
    expect(app.drafts.currentPackOptions(draft.id, yugi.id)).toHaveLength(8);
    expect(app.drafts.currentPackOptions(draft.id, kaiba.id)).toHaveLength(8);
  });

  it("blocks start when the cube has too few copies for the deal", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "small cube", { cubeCardIds: Array.from({ length: 15 }, (_, i) => i + 1) }, "user-1", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    // 2 players × 5 packs × 8 cards needs 80 authored copies; provide 15.
    seedCatalogCards(app.db, 15);

    expect(() => app.drafts.start(draft.id)).toThrow(/15.*80/);
  });

  it("starts with two card names when there are enough copies", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    // 2 distinct ids, each pasted 40× => 80 total, packSize 8 needs 8 distinct.
    const customCardIds = [...Array(40).fill(101), ...Array(40).fill(102)];
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "skewed",
      { customCardIds, packSize: 8, packsPerPlayer: 5 },
      "user-1",
      yugi.id,
    );
    app.drafts.join(draft.id, kaiba.id);
    for (const id of [101, 102]) {
      app.db
        .prepare(
          `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
           values (?, ?, 'Spellcaster / Normal Monster', 'normal', '', '', '[]', '2026-01-01T00:00:00Z')`,
        )
        .run(id, `Custom ${id}`);
    }

    expect(app.drafts.start(draft.id).status).toBe("active");
  });

  it("deals all copies when the cube fits exactly", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    // waves = packsPerPlayer = 5. Card 101 pasted 11× (> 5 waves) — now capped, not blocked.
    const customCardIds = [...Array(11).fill(101), ...Array.from({ length: 69 }, (_, i) => 200 + i)];
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "over-copied",
      { customCardIds, packSize: 8, packsPerPlayer: 5 },
      "user-1",
      yugi.id,
    );
    app.drafts.join(draft.id, kaiba.id);
    const ins = app.db.prepare(
      `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
       values (?, ?, 'Spellcaster / Normal Monster', 'normal', '', '', '[]', '2026-01-01T00:00:00Z')`,
    );
    ins.run(101, "Custom 101");
    for (let i = 0; i < 69; i += 1) ins.run(200 + i, `Custom ${200 + i}`);

    expect(() => app.drafts.start(draft.id)).not.toThrow();
    // Card 101 is capped at the wave count (5), one copy per wave.
    const copies = (
      app.db
        .prepare("select count(*) as n from draft_deal where draft_id = ? and catalog_card_id = 101")
        .get(draft.id) as { n: number }
    ).n;
    expect(copies).toBe(11);
  });

  it("materializes draft_deal at start and deals wave 1 from it", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "cube night", { setNames: ["Metal Raiders"] }, "user-1", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80); // 80 distinct == slots

    app.drafts.start(draft.id);

    const cubeRows = app.db
      .prepare("select position, catalog_card_id from draft_deal where draft_id = ? order by position")
      .all(draft.id) as Array<{ position: number; catalog_card_id: number }>;
    expect(cubeRows).toHaveLength(80); // packSize 8 × (2 players × 5 packs)
    expect(cubeRows.map((r) => r.position)).toEqual(Array.from({ length: 80 }, (_, i) => i));

    // Wave 1 = first 2 packs of the cube (one per player), each 8 distinct.
    const wave1 = app.db
      .prepare("select catalog_card_id from draft_cards where draft_id = ? and wave_number = 1 order by draft_pack_id, position")
      .all(draft.id) as Array<{ catalog_card_id: number }>;
    expect(wave1).toHaveLength(16);
    expect(wave1.map((r) => r.catalog_card_id)).toEqual(
      cubeRows.slice(0, 16).map((r) => r.catalog_card_id),
    );
    expect(app.drafts.currentPackOptions(draft.id, yugi.id)).toHaveLength(8);
  });

  it("legacy guard: a started draft with draft_deal deleted opens later waves via the generator", () => {
    const app = setup();
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const draft = app.drafts.create("guild-1", "channel-1", "midflight", { setNames: ["Metal Raiders"] }, "user-1", yugi.id);
    app.drafts.join(draft.id, kaiba.id);
    seedCatalogCards(app.db, 80);
    app.drafts.start(draft.id);

    // Simulate a pre-deploy in-flight draft: drop its deal rows.
    app.db.prepare("delete from draft_deal where draft_id = ?").run(draft.id);

    // Drive wave 1 to completion so openWave(wave 2) fires (legacy branch).
    for (let step = 0; step < 8; step += 1) {
      const y = app.drafts.currentPackOptions(draft.id, yugi.id);
      const k = app.drafts.currentPackOptions(draft.id, kaiba.id);
      if (y.length > 0) app.drafts.pickCard(draft.id, yugi.id, y[0].id);
      if (k.length > 0) app.drafts.pickCard(draft.id, kaiba.id, k[0].id);
    }

    const wave2 = app.db
      .prepare("select count(*) as n from draft_cards where draft_id = ? and wave_number = 2")
      .get(draft.id) as { n: number };
    expect(wave2.n).toBeGreaterThan(0);
  });

  it("materializes each repeated custom card id as an authored copy", () => {
    const app = setup({ seedSource: () => 7 });
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    // 2 players × packSize 2 => 4 distinct needed; waves = packsPerPlayer = 2.
    // Card 101 pasted twice => 2 copies, one per distinct wave (capped at waves).
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "multiplicity",
      { customCardIds: [101, 101, 102, 103, 104, 105, 106, 107], packSize: 2, packsPerPlayer: 2, cardsPerPlayer: 4 },
      "user-1",
      yugi.id,
    );
    app.drafts.join(draft.id, kaiba.id);
    const ins = app.db.prepare(
      `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
       values (?, ?, 'Spellcaster / Normal Monster', 'normal', '', '', '[]', '2026-01-01T00:00:00Z')`,
    );
    for (const id of [101, 102, 103, 104, 105, 106, 107]) ins.run(id, `Custom ${id}`);

    app.drafts.start(draft.id);

    // S = 2 players × 2 waves × 2 packSize = 8 total deal slots.
    const total = app.db
      .prepare("select count(*) as n from draft_deal where draft_id = ?")
      .get(draft.id) as { n: number };
    expect(total.n).toBe(8);

    // Card 101 was authored twice and lands one copy in each of two distinct waves.
    // The deal is laid out wave-major (positions 0..3 = wave 1, 4..7 = wave 2).
    const card101Positions = app.db
      .prepare("select position from draft_deal where draft_id = ? and catalog_card_id = 101 order by position")
      .all(draft.id) as Array<{ position: number }>;
    expect(card101Positions).toHaveLength(2);
    const cardsPerWave = 2 * 2; // players × packSize
    const wavesWithCard101 = new Set(card101Positions.map((r) => Math.floor(r.position / cardsPerWave)));
    expect(card101Positions.map((r) => r.position)).toEqual(
      seededShuffle([101, 101, 102, 103, 104, 105, 106, 107], 7).flatMap((id, i) => id === 101 ? [i] : []),
    );
  });

  it("a started draft deals no card twice within a wave (reads draft_deal)", () => {
    const app = setup();
    // 4 players, packSize 4, packsPerPlayer 3, a 60-distinct cube.
    const yugi = insertPlayer(app.db, "guild-1", "user-1", "Yugi");
    const kaiba = insertPlayer(app.db, "guild-1", "user-2", "Kaiba");
    const joey = insertPlayer(app.db, "guild-1", "user-3", "Joey");
    const mai = insertPlayer(app.db, "guild-1", "user-4", "Mai");
    const draft = app.drafts.create(
      "guild-1",
      "channel-1",
      "regression draft",
      { setNames: ["Metal Raiders"], packSize: 4, packsPerPlayer: 3, cardsPerPlayer: 12 },
      "user-1",
      yugi.id,
    );
    app.drafts.join(draft.id, kaiba.id);
    app.drafts.join(draft.id, joey.id);
    app.drafts.join(draft.id, mai.id);
    seedCatalogCards(app.db, 60);

    app.drafts.start(draft.id);

    const rows = app.db
      .prepare("select position, catalog_card_id from draft_deal where draft_id = ? order by position")
      .all(draft.id) as Array<{ position: number; catalog_card_id: number }>;
    expect(rows).toHaveLength(48); // S = 4*3*4

    const players = 4, packSize = 4;
    const cardsPerWave = players * packSize; // 16
    for (let w = 0; w * cardsPerWave < rows.length; w += 1) {
      const wave = rows.slice(w * cardsPerWave, (w + 1) * cardsPerWave).map((r) => r.catalog_card_id);
      expect(new Set(wave).size).toBe(wave.length); // all distinct in the wave
    }
  });
});
