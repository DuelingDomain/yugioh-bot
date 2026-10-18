import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createDraftService } from "../src/services/drafts.js";
import { createCardInsightService } from "../src/services/card-insights.js";
import { createCubeService } from "../src/services/cubes.js";
import { createCardCatalogService } from "../src/services/card-catalog.js";
import { mulberry32 } from "../src/services/deal.js";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { seedIdentity } from "./helpers/identity.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const now = new Date("2030-01-01T00:00:00Z");

function setup(count = 320) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const seats = Array.from({ length: 8 }, (_, index) => seedIdentity(db, { name: `Bot ${index}`, guildId: "g" }));
  const card = db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,level,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,?,'effect',?,4,'Printed effect','i','i','[]','t')`);
  const tag = db.prepare(`INSERT INTO card_tags(passcode,summary,roles_json,tags_json,popularity,source,schema_version) VALUES(?,'Fixture','[]',?,?,'fixture',1)`);
  for (let id = 1; id <= count; id++) {
    const family = `Family ${Math.floor((id - 1) / 40)}`;
    card.run(id, `Card ${id}`, "Effect Monster", family);
    tag.run(id, JSON.stringify(CardTags.parse(fillDefaults({ summary: "Fixture", supports: { archetypes: [family] } }))), 100);
  }
  const drafts = createDraftService(db, { seedSource: () => 183, pickSeed: "integration" });
  const draft = drafts.create("g", null, "Eight bots", {
    cubeCardIds: Array.from({ length: count }, (_, i) => i + 1), packSize: 8,
    packsPerPlayer: 5, cardsPerPlayer: 40, pickSeconds: 45,
  }, seats[0].userId, seats[0].playerId);
  for (const seat of seats.slice(1)) drafts.join(draft.id, seat.playerId);
  return { db, seats, drafts, draft };
}

function runDraft(policy: "smart" | "random" | "timeout") {
  const fixture = setup();
  const { db, drafts, draft, seats } = fixture;
  drafts.start(draft.id, now);
  const random = mulberry32(624);
  for (let step = 0; step < 40; step++) {
    if (policy === "timeout") {
      const state = drafts.findById(draft.id);
      expect(drafts.expireCurrentPickStep(draft.id, new Date(state.pickDeadlineAt!)).autoPickedPlayerIds).toHaveLength(8);
    } else for (const seat of seats) {
      const options = policy === "smart" ? drafts.rankPickOptions(draft.id, seat.playerId) : drafts.pickOptions(draft.id, seat.playerId);
      const choice = options[policy === "random" ? Math.floor(random() * options.length) : 0];
      drafts.pickCard(draft.id, seat.playerId, choice.id, "auto", now);
    }
  }
  expect(drafts.findById(draft.id).status).toBe("completed");
  const pools = seats.map(seat => drafts.pool(draft.id, seat.playerId).map(card => card.catalogCardId));
  const insights = createCardInsightService(db);
  const links = pools.map(pool => pool.reduce((sum, card, index) => sum + insights.pickScore(card, pool.slice(0, index)), 0));
  expect(pools.every(pool => pool.length === 40)).toBe(true);
  expect(drafts.picks(draft.id).every(pick => pick.pickMethod === "auto")).toBe(true);
  return { pools, links };
}

it("completes a fixed-seed eight-seat bot draft; every seat links more than the same deal picked at random", () => {
  const smart = runDraft("smart"), random = runDraft("random"), timeout = runDraft("timeout");
  for (let seat = 0; seat < 8; seat++) expect(smart.links[seat]).toBeGreaterThan(random.links[seat]);
  expect(timeout).toEqual(smart);
  expect(runDraft("smart")).toEqual(smart);
  console.info("DRAFT_PICK_LINKS", JSON.stringify({ smart: smart.links, random: random.links }));
}, 20000);

it("keeps rankings stable after restart, reports actual pool links, and prefers popularity in an empty pool", () => {
  const { db, drafts, draft, seats } = setup();
  drafts.start(draft.id, now);
  const player = seats[0].playerId;
  const options = drafts.pickOptions(draft.id, player);
  db.prepare("UPDATE card_tags SET popularity=1000000 WHERE passcode=?").run(options[0].catalogCardId);
  const ranked = drafts.rankPickOptions(draft.id, player);
  expect(ranked[0].id).toBe(options[0].id);
  expect(ranked.every(card => card.fitsYourPool === undefined)).toBe(true);
  expect(createDraftService(db, { pickSeed: "integration" }).rankPickOptions(draft.id, player)).toEqual(ranked);
  for (const seat of seats) drafts.pickCard(draft.id, seat.playerId, drafts.rankPickOptions(draft.id, seat.playerId)[0].id, "auto", now);
  const pool = drafts.pool(draft.id, player).map(card => card.catalogCardId);
  const insights = createCardInsightService(db);
  for (const card of drafts.rankPickOptions(draft.id, player)) {
    expect(card.pickScore).toBe(insights.pickScore(card.catalogCardId, pool));
    if (card.fitsYourPool) expect(card.pickScore).toBeGreaterThan(0);
  }
});

it("uses the same scorer for theme draft timeouts, including Extra Deck material supply", () => {
  const { db, seats } = setup(16);
  db.prepare("UPDATE card_catalog SET archetype=NULL").run();
  db.prepare("DELETE FROM card_tags").run();
  db.prepare("UPDATE card_catalog SET type='Tuner Effect Monster',level=3 WHERE ygoprodeck_id=1").run();
  db.prepare("UPDATE card_catalog SET level=5 WHERE ygoprodeck_id=2").run();
  for (const [id, level] of [[15, 8], [16, 12]]) {
    db.prepare("UPDATE card_catalog SET type='Synchro Effect Monster',frame_type='synchro',level=? WHERE ygoprodeck_id=?").run(level, id);
  }
  const catalog = createCardCatalogService(db);
  const cubes = createCubeService(db, catalog);
  const cube = cubes.createBlank("g", "Materials", seats[0].userId);
  cubes.addCard(cube.id, 1, "main", 2); cubes.addCard(cube.id, 2, "main", 2);
  cubes.addCard(cube.id, 15, "extra", 2); cubes.addCard(cube.id, 16, "extra", 2);
  const drafts = createDraftService(db, { seedSource: () => 183 });
  const draft = drafts.create("g", null, "Theme materials", {
    mode: "theme", allowedCubeIds: [cube.id], uniqueThemes: false, themeSelection: "random",
    cardsPerPlayer: 2, themePackSize: 2, extraDeckEnabled: true, extraDeckSize: 1,
  }, seats[0].userId, seats[0].playerId);
  drafts.join(draft.id, seats[1].playerId); drafts.start(draft.id, now);
  for (const target of [1, 2]) for (const seat of seats.slice(0, 2)) {
    const card = drafts.pickOptions(draft.id, seat.playerId).find(card => card.catalogCardId === target)!;
    drafts.pickCard(draft.id, seat.playerId, card.id, "manual", now);
  }
  expect(drafts.findById(draft.id).currentPackRound).toBe(3);
  for (const seat of seats.slice(0, 2)) expect(drafts.rankPickOptions(draft.id, seat.playerId)[0].catalogCardId).toBe(15);
  const expiry = drafts.findById(draft.id).pickDeadlineAt!;
  expect(drafts.expireCurrentPickStep(draft.id, new Date(expiry)).autoPickedPlayerIds).toHaveLength(2);
  expect(drafts.findById(draft.id).status).toBe("completed");
  for (const seat of seats.slice(0, 2)) expect(drafts.pool(draft.id, seat.playerId).at(-1)?.catalogCardId).toBe(15);
});
