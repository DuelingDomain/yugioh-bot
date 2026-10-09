import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDraftService, totalBoosterCards, totalThemeRounds, boosterDraftConfigError, themeDraftNumberError } from "../../src/services/drafts.js";
import { createCubeService } from "../../src/services/cubes.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { seededShuffle } from "../../src/services/deal.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";
import type { DraftConfig } from "../../src/types/index.js";

function setup(playerCount: number, mainCount = 600, extraCount = 20) {
  const db = new Database(":memory:");
  migrate(db);
  const drafts = createDraftService(db, { seedSource: () => 7 });
  const players = Array.from({ length: playerCount }, (_, i) => {
    const user = seedUser(db, `u${i}`);
    return seedIdentity(db, { guildId: "g", name: `P${i}`, userId: user.userId, discordUserId: user.discordUserId }).playerId;
  });
  const main = Array.from({ length: mainCount }, (_, i) => i + 1);
  const extra = Array.from({ length: extraCount }, (_, i) => 1001 + i);
  const insert = db.prepare("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,?, 'i','i','[]','t')");
  for (const id of main) insert.run(id, `M${id}`, "Normal Monster", "normal");
  for (const id of extra) insert.run(id, `X${id}`, "Fusion Monster", "fusion");
  const create = (config: DraftConfig) => {
    const draft = drafts.create("g", "c", "Size", config, seedUser(db, "u0").userId, players[0]);
    for (const player of players.slice(1)) drafts.join(draft.id, player);
    return draft;
  };
  return { db, drafts, players, main, extra, create };
}

function finish(app: ReturnType<typeof setup>, draftId: number, cap: number) {
  for (let step = 0; step < 500 && app.drafts.findById(draftId).status === "active"; step++) {
    let acted = false;
    for (const player of app.players) {
      const options = app.drafts.currentPackOptions(draftId, player);
      if (options.length === 0) continue;
      app.drafts.pickCard(draftId, player, options[0].id);
      acted = true;
      expect(app.drafts.pool(draftId, player).filter((card) => card.catalogCardId < 1000).length).toBeLessThanOrEqual(cap);
    }
    expect(acted || app.drafts.findById(draftId).status === "completed").toBe(true);
  }
  expect(app.drafts.findById(draftId).status).toBe("completed");
}

describe("Main Deck picks per player", () => {
  it.each([2, 3, 4].flatMap((players) => [1, 2].flatMap((picksPerStep) => [20, 40, 41, 60].map((cap) => ({ players, picksPerStep, cap })))))
    ("drafts exactly $cap Main cards for $players players with $picksPerStep picks before passing", ({ players, picksPerStep, cap }) => {
      const app = setup(players);
      try {
        // The configured packs/legacy target may be below or above the requested size.
        const config = { cubeCardIds: app.main, packSize: 24, packsPerPlayer: cap < 40 ? 5 : 1, cardsPerPlayer: 40, mainPicksPerPlayer: cap, picksPerStep };
        const draft = app.create(config);
        expect(totalBoosterCards(draft.config)).toBe(cap);
        expect(app.drafts.analyzeBoosterDraft(draft.config, players, "g").errors).toEqual([]);
        app.drafts.start(draft.id);
        finish(app, draft.id, cap);
        for (const player of app.players) expect(app.drafts.pool(draft.id, player)).toHaveLength(cap);
        expect(app.drafts.findById(draft.id).currentPackRound).toBe(Math.ceil(cap / 24));
      } finally { app.db.close(); }
    });

  it.each([80, 79])("deals partial final packs from a truly finite %i-card pool", (size) => {
    const app = setup(2, size);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, packsPerPlayer: 5, mainPicksPerPlayer: 40 });
      const analysis = app.drafts.analyzeBoosterDraft(draft.config, 2, "g");
      expect(analysis.errors).toEqual([]);
      expect(analysis.warnings.length).toBe(size < 80 ? 1 : 0);
      app.drafts.start(draft.id);
      finish(app, draft.id, 40);
      const counts = app.players.map((player) => app.drafts.pool(draft.id, player).length);
      expect(counts.reduce((sum, n) => sum + n, 0)).toBe(size);
      expect(Math.min(...counts)).toBe(size === 80 ? 40 : 39);
      expect(Math.max(...counts)).toBe(40);
    } finally { app.db.close(); }
  });

  it.each([false, true])("handles leftover Main cards with burnUnpicked=%s", (burnUnpicked) => {
    const app = setup(2, 96);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, packsPerPlayer: 5, mainPicksPerPlayer: 40, burnUnpicked });
      app.drafts.start(draft.id);
      finish(app, draft.id, 40);
      expect(app.db.prepare("select count(*) as n from draft_undealt where draft_id = ?").get(draft.id)).toEqual({ n: burnUnpicked ? 0 : 16 });
      expect(app.db.prepare("select count(*) as n from draft_cards where draft_id = ? and picked_by_player_id is null").get(draft.id)).toEqual({ n: 0 });
    } finally { app.db.close(); }
  });

  it.each([40, 80])("keeps all Extra picks separate with %i Main cards available", (mainCount) => {
    const app = setup(2, mainCount);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, packsPerPlayer: 5, mainPicksPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 3, customExtraCardIds: app.extra, picksPerStep: 2 });
      expect(totalBoosterCards(draft.config)).toBe(43);
      app.drafts.start(draft.id);
      finish(app, draft.id, 40);
      for (const player of app.players) {
        const pool = app.drafts.pool(draft.id, player);
        expect(pool.filter((card) => card.catalogCardId < 1000)).toHaveLength(mainCount / 2);
        expect(pool.filter((card) => card.catalogCardId > 1000)).toHaveLength(3);
      }
    } finally { app.db.close(); }
  });

  it("counts only Main cards from an authored mixed pool when the cap is set", () => {
    const app = setup(2, 80);
    try {
      const draft = app.create({ cubeCardIds: [...app.main, ...app.extra], packSize: 24, mainPicksPerPlayer: 40, extraDeckEnabled: false });
      app.drafts.start(draft.id);
      expect(app.db.prepare("select count(*) as n from draft_deal where draft_id = ? and catalog_card_id > 1000").get(draft.id)).toEqual({ n: 0 });
      finish(app, draft.id, 40);
      for (const player of app.players) expect(app.drafts.pool(draft.id, player).filter((card) => card.catalogCardId < 1000)).toHaveLength(40);
    } finally { app.db.close(); }
  });

  it("rejects another pick as soon as a player reaches an odd cap during a two-pick turn", () => {
    const app = setup(2);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, mainPicksPerPlayer: 41, picksPerStep: 2 });
      app.drafts.start(draft.id);
      while (app.drafts.pool(draft.id, app.players[0]).length < 40) {
        for (const player of app.players) app.drafts.pickCard(draft.id, player, app.drafts.currentPackOptions(draft.id, player)[0].id);
      }
      const options = app.drafts.currentPackOptions(draft.id, app.players[0]);
      app.drafts.pickCard(draft.id, app.players[0], options[0].id);
      expect(app.drafts.findById(draft.id).status).toBe("active");
      expect(app.drafts.currentPackOptions(draft.id, app.players[0])).toEqual([]);
      expect(() => app.drafts.pickCard(draft.id, app.players[0], options[1].id)).toThrow(/finished drafting/);
      finish(app, draft.id, 41);
    } finally { app.db.close(); }
  });

  it.each([19, 61, 20.5, "40", null])("validates the optional cap %j for both draft modes", (cap) => {
    const config = { mainPicksPerPlayer: cap } as unknown as DraftConfig;
    expect(boosterDraftConfigError(config)).toMatch(/whole number from 20 to 60/);
    expect(themeDraftNumberError(config)).toMatch(/whole number from 20 to 60/);
  });

  it.each([2, 3, 4].flatMap((players) => [false, true].flatMap((burnUnpicked) => [20, 40].map((cap) => ({ players, burnUnpicked, cap })))))
    ("uses the $cap cap for theme rounds and sufficiency with $players players, burn=$burnUnpicked", ({ players, burnUnpicked, cap }) => {
      const app = setup(players, burnUnpicked ? cap * 3 : cap + 2);
      try {
        const cubes = createCubeService(app.db, createCardCatalogService(app.db));
        const cube = cubes.createBlank("g", "Theme", seedUser(app.db, "u0").userId);
        for (const id of app.main) cubes.addCard(cube.id, id, "main", 1);
        for (const id of app.extra) cubes.addCard(cube.id, id, "extra", 1);
        const draft = app.create({ mode: "theme", allowedCubeIds: [cube.id], themeSelection: "random", uniqueThemes: false, cardsPerPlayer: cap === 20 ? 60 : 20, mainPicksPerPlayer: cap, themePackSize: 3, burnUnpicked, extraDeckEnabled: true, extraDeckSize: 3 });
        expect(totalThemeRounds(draft.config)).toBe(cap + 3);
        app.drafts.start(draft.id);
        finish(app, draft.id, cap);
        for (const player of app.players) {
          const pool = app.drafts.pool(draft.id, player);
          expect(pool.filter((card) => card.catalogCardId < 1000)).toHaveLength(cap);
          expect(pool.filter((card) => card.catalogCardId > 1000)).toHaveLength(3);
        }
      } finally { app.db.close(); }
    });

  it.each([2, 3, 4].flatMap((players) => [1, 2].flatMap((picksPerStep) => [0, -1, 1].map((delta) => ({ players, picksPerStep, delta })))))
    ("uses every available copy near an odd cap: $players players, $picksPerStep picks, pool delta $delta", ({ players, picksPerStep, delta }) => {
      const cap = 41;
      const app = setup(players, players * cap + delta);
      try {
        const draft = app.create({ cubeCardIds: app.main, packSize: 24, mainPicksPerPlayer: cap, picksPerStep });
        app.drafts.start(draft.id);
        const dealt = app.db.prepare("select catalog_card_id as id from draft_deal where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
        const undealt = app.db.prepare("select catalog_card_id as id from draft_undealt where draft_id = ? order by position").all(draft.id) as Array<{ id: number }>;
        expect([...dealt, ...undealt].map((card) => card.id)).toEqual(seededShuffle(app.main, 7));
        finish(app, draft.id, cap);
        const counts = app.players.map((player) => app.drafts.pool(draft.id, player).length);
        expect(counts.reduce((sum, n) => sum + n, 0)).toBe(players * cap + Math.min(delta, 0));
        expect(Math.max(...counts) - Math.min(...counts)).toBe(delta < 0 ? 1 : 0);
      } finally { app.db.close(); }
    });

  it("caps automatic picks and resumes the persisted partial round", () => {
    const app = setup(3, 150);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, mainPicksPerPlayer: 41, picksPerStep: 2 });
      app.drafts.start(draft.id);
      const resumed = createDraftService(app.db, { seedSource: () => { throw new Error("Must keep the persisted shuffle"); } });
      for (let step = 0; step < 100 && resumed.findById(draft.id).status === "active"; step++) {
        resumed.expireCurrentPickStep(draft.id, new Date(resumed.findById(draft.id).pickDeadlineAt!));
        for (const player of app.players) expect(resumed.pool(draft.id, player).length).toBeLessThanOrEqual(41);
      }
      expect(resumed.findById(draft.id).status).toBe("completed");
      for (const player of app.players) expect(resumed.pool(draft.id, player)).toHaveLength(41);
    } finally { app.db.close(); }
  });

  it("retains legacy targets and rounds when the field is absent", () => {
    const app = setup(2, 96);
    try {
      const draft = app.create({ cubeCardIds: app.main, packSize: 24, packsPerPlayer: 2, cardsPerPlayer: 40 });
      expect(draft.config).not.toHaveProperty("mainPicksPerPlayer");
      app.drafts.start(draft.id);
      finish(app, draft.id, 40);
      for (const player of app.players) expect(app.drafts.pool(draft.id, player)).toHaveLength(40);
      expect(app.db.prepare("select count(*) as n from draft_undealt where draft_id = ?").get(draft.id)).toEqual({ n: 0 });
    } finally { app.db.close(); }
  });
});
