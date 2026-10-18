import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
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

it.each(["synchro", "xyz", "link", "fusion", "trishula", "trishula_ready", "link_names", "contact_fusion", "two_tuners", "two_tuners_ready", "synchro_or_more"])("uses the same scorer for theme timeouts and %s material supply", subtype => {
  const { db, seats } = setup(16);
  db.prepare("UPDATE card_catalog SET archetype=NULL").run();
  db.prepare("DELETE FROM card_tags").run();
  db.prepare("UPDATE card_catalog SET type='Tuner Effect Monster',level=3 WHERE ygoprodeck_id=1").run();
  db.prepare("UPDATE card_catalog SET level=5 WHERE ygoprodeck_id=2").run();
  if (subtype === "xyz") db.prepare("UPDATE card_catalog SET level=4 WHERE ygoprodeck_id IN (1,2)").run();
  db.prepare("UPDATE card_catalog SET type='Spell Card',frame_type='spell' WHERE ygoprodeck_id=3").run();
  const tags = (id: number, raw: unknown) => db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(?,'Fixture','[]',?,'fixture',1)")
    .run(id, JSON.stringify(CardTags.parse(fillDefaults(raw))));
  tags(3, { summary: "Fusion enabler", effects: [{ timing: "ignition", actions: [{ verb: "fusion_summon", player: "you" }] }] });
  for (const [id, level] of [[15, subtype === "link" ? 2 : subtype === "xyz" ? 4 : 8], [16, subtype === "link" ? 4 : 12]]) {
    db.prepare("UPDATE card_catalog SET type=?,frame_type=?,level=? WHERE ygoprodeck_id=?").run(`${subtype} Effect Monster`, subtype, level, id);
    if (subtype === "fusion") tags(id, { summary: "Fusion", materials: [{ names: ["Card 1"] }, { names: [id === 15 ? "Card 2" : "Card 9"] }] });
  }
  if (subtype.startsWith("trishula")) {
    importCardEffectArtifact(db);
    const realTags = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=52687916").get() as { tags_json: string };
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(15,'Trishula','[]',?,'searchygo-fixture',1)").run(realTags.tags_json);
    db.prepare("UPDATE card_catalog SET type='Synchro Effect Monster',frame_type='synchro',level=9,effect_text='1 Tuner + 2+ non-Tuner monsters' WHERE ygoprodeck_id=15").run();
    db.prepare("UPDATE card_catalog SET type='Synchro Effect Monster',frame_type='synchro',level=?,effect_text='1 Tuner + 1+ non-Tuner monsters' WHERE ygoprodeck_id=16").run(subtype === "trishula_ready" ? 12 : 9);
    db.prepare("UPDATE card_catalog SET level=? WHERE ygoprodeck_id=2").run(subtype === "trishula_ready" ? 2 : 6);
    if (subtype === "trishula_ready") db.prepare("UPDATE card_catalog SET type='Effect Monster',frame_type='effect',level=4 WHERE ygoprodeck_id=3").run();
  }
  if (subtype === "link_names") {
    importCardEffectArtifact(db);
    const realTags = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=2857636").get() as { tags_json: string };
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(15,'Knightmare Phoenix','[]',?,'searchygo-fixture',1)").run(realTags.tags_json);
    db.prepare("UPDATE card_catalog SET type='Link Effect Monster',frame_type='link',level=2,effect_text='2 monsters with different names' WHERE ygoprodeck_id IN (15,16)").run();
    db.prepare("UPDATE card_catalog SET effect_text='2 monsters' WHERE ygoprodeck_id=16").run();
    db.prepare("UPDATE card_catalog SET name='Same monster' WHERE ygoprodeck_id IN (1,2)").run();
  }
  if (subtype === "contact_fusion") {
    importCardEffectArtifact(db);
    const realTags = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=1561110").get() as { tags_json: string };
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(15,'ABC','[]',?,'searchygo-fixture',1)").run(realTags.tags_json);
    db.prepare("UPDATE card_catalog SET type='Fusion Effect Monster',frame_type='fusion',level=8 WHERE ygoprodeck_id IN (15,16)").run();
    for (const [id, name] of [[1, "A-Assault Core"], [2, "B-Buster Drake"], [3, "C-Crush Wyvern"]]) {
      db.prepare("UPDATE card_catalog SET type='Effect Monster',frame_type='effect',name=? WHERE ygoprodeck_id=?").run(name, id);
    }
    db.prepare("DELETE FROM card_tags WHERE passcode=3").run();
  }
  if (subtype.startsWith("two_tuners") || subtype === "synchro_or_more") {
    importCardEffectArtifact(db);
    const realTags = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=?").get(subtype === "synchro_or_more" ? 44508094 : 80666118) as { tags_json: string };
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version) VALUES(15,'Synchro','[]',?,'searchygo-fixture',1)").run(realTags.tags_json);
    db.prepare("UPDATE card_catalog SET type='Synchro Effect Monster',frame_type='synchro',level=?,effect_text=? WHERE ygoprodeck_id=15").run(subtype === "synchro_or_more" ? 8 : 10, subtype === "synchro_or_more" ? "1 Tuner + 1 or more non-Tuner monsters" : "2 Tuners + 1+ non-Tuner monsters");
    db.prepare("UPDATE card_catalog SET type='Synchro Effect Monster',frame_type='synchro',level=?,effect_text='1 Tuner + 1+ non-Tuner monsters' WHERE ygoprodeck_id=16").run(subtype === "two_tuners" ? 10 : 12);
    db.prepare("UPDATE card_catalog SET level=? WHERE ygoprodeck_id=1").run(subtype === "synchro_or_more" ? 3 : 4);
    db.prepare("UPDATE card_catalog SET level=? WHERE ygoprodeck_id=2").run(subtype === "two_tuners" ? 6 : 3);
    if (subtype !== "two_tuners") {
      db.prepare("UPDATE card_catalog SET type='Effect Monster',frame_type='effect',level=? WHERE ygoprodeck_id=3").run(subtype === "synchro_or_more" ? 2 : 3);
      if (subtype === "two_tuners_ready") db.prepare("UPDATE card_catalog SET type='Tuner Effect Monster' WHERE ygoprodeck_id=2").run();
    }
  }
  const catalog = createCardCatalogService(db);
  const cubes = createCubeService(db, catalog);
  const cube = cubes.createBlank("g", "Materials", seats[0].userId);
  cubes.addCard(cube.id, 1, "main", 2); cubes.addCard(cube.id, 2, "main", 2); cubes.addCard(cube.id, 3, "main", 2);
  cubes.addCard(cube.id, 15, "extra", 2); cubes.addCard(cube.id, 16, "extra", 2);
  const drafts = createDraftService(db, { seedSource: () => 183 });
  const draft = drafts.create("g", null, "Theme materials", {
    mode: "theme", allowedCubeIds: [cube.id], uniqueThemes: false, themeSelection: "random",
    cardsPerPlayer: 3, themePackSize: 3, extraDeckEnabled: true, extraDeckSize: 1,
  }, seats[0].userId, seats[0].playerId);
  drafts.join(draft.id, seats[1].playerId); drafts.start(draft.id, now);
  for (const target of [1, 2, 3]) for (const seat of seats.slice(0, 2)) {
    const card = drafts.pickOptions(draft.id, seat.playerId).find(card => card.catalogCardId === target)!;
    drafts.pickCard(draft.id, seat.playerId, card.id, "manual", now);
  }
  expect(drafts.findById(draft.id).currentPackRound).toBe(4);
  if (subtype === "contact_fusion") {
    const before = drafts.rankPickOptions(draft.id, seats[0].playerId).find(card => card.catalogCardId === 15)!.score;
    tags(3, { summary: "Fusion enabler", effects: [{ timing: "ignition", actions: [{ verb: "fusion_summon", player: "you" }] }] });
    expect(drafts.rankPickOptions(draft.id, seats[0].playerId).find(card => card.catalogCardId === 15)!.score).toBe(before);
  }
  if (subtype === "synchro_or_more") {
    const before = drafts.rankPickOptions(draft.id, seats[0].playerId).find(card => card.catalogCardId === 15)!.score;
    db.prepare("UPDATE card_catalog SET effect_text='1 Tuner + 1+ non-Tuner monsters' WHERE ygoprodeck_id=15").run();
    expect(drafts.rankPickOptions(draft.id, seats[0].playerId).find(card => card.catalogCardId === 15)!.score).toBe(before);
  }
  const expected = ["trishula", "link_names", "two_tuners"].includes(subtype) ? 16 : 15;
  for (const seat of seats.slice(0, 2)) expect(drafts.rankPickOptions(draft.id, seat.playerId)[0].catalogCardId).toBe(expected);
  const expiry = drafts.findById(draft.id).pickDeadlineAt!;
  expect(drafts.expireCurrentPickStep(draft.id, new Date(expiry)).autoPickedPlayerIds).toHaveLength(2);
  expect(drafts.findById(draft.id).status).toBe("completed");
  for (const seat of seats.slice(0, 2)) expect(drafts.pool(draft.id, seat.playerId).at(-1)?.catalogCardId).toBe(expected);
});
