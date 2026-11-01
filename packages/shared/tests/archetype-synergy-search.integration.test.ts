import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { createCardInsightService } from "../src/services/card-insights.js";

const db = new Database(":memory:");
const service = createCardInsightService(db, { dataDirectory: "/tmp/no-synergy-test-engine" });
beforeAll(() => {
  migrate(db);
  importCardEffectArtifact(db);
  const insert = db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,?,?,?,?,'image','small','[]','now')`);
  insert.run(29762407, "Temple of the Kings", "Spell Card", "spell", "You can activate 1 Trap Card the turn it was Set.", null);
  insert.run(80101899, "Trap Trick", "Trap Card", "trap", "Banish 1 Normal Trap from your Deck, and Set 1 card with the same name directly from your Deck.", null);
  insert.run(52112003, "Card Advance", "Spell Card", "spell", "You can Tribute Summon 1 monster in addition to your Normal Summon/Set this turn.", null);
  insert.run(4929256, "Mobius the Frost Monarch", "Effect Monster", "effect", "When this card is Tribute Summoned: Destroy up to 2 Spell/Trap Cards on the field.", "Monarch");
  insert.run(62265044, "Dragon Ravine", "Spell Card", "spell", "Discard 1 card; send 1 Dragon monster from your Deck to the GY.", "Dragunity");
  insert.run(8696773, "The First Monarch", "Trap Card", "trap", "Special Summon this card as an Effect Monster.", "Monarch");
});
afterAll(() => db.close());

it.each(["Temple of the Kings synergy", "synergy with Temple of the Kings", "cards that work with Temple of the Kings"])("finds outside Trap partners through the stored profile: %s", text => {
  const result = service.effectSearch(text);
  expect(result.cards.map(card => card.passcode)).toContain(80101899);
  expect(result.cards.map(card => card.passcode)).toContain(29762407);
  expect(result.cards.find(card => card.passcode === 80101899)?.reason).toContain("Sets a Normal Trap from your Deck");
  expect(result.cards.find(card => card.passcode === 80101899)?.synergyCategory).toBe("outside");
  expect(result.cards.find(card => card.passcode === 29762407)?.synergyCategory).toBe("member");
});

it.each(["Temple of the Kings", "Labrynth"])("checks every setup and payoff filter against %s's Trap mechanic", target => {
  db.exec("SAVEPOINT trap_filter_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Effect Monster','effect',?,'image','small','[]','now')`);
    insert.run(53666449, "Minerva, Scholar of the Sky", 'Each time a Counter Trap Card is activated, immediately after it resolves, this card gains 500 ATK, and if it does, and "The Sanctuary in the Sky" is on the field, add 1 Counter Trap with a different name from your GY to your hand.');
    insert.run(98301564, "Guiding Ariadne", "If this card is destroyed: Reveal 3 Counter Traps from your Deck; your opponent chooses 1 to add to your hand.");
    insert.run(952523, "Traptrix Cularia", 'After you activate a "Hole" Normal Trap Card, you can Set it instead of sending it to the GY.');
    insert.run(91812341, "Traptrix Myrmeleo", 'When this card is Normal Summoned: You can add 1 "Hole" Normal Trap Card from your Deck to your hand.');
    insert.run(61307542, "Paleozoic Anomalocaris", "If a Trap Card is sent from your Spell & Trap Zone to the GY: Excavate the top card of your Deck, and if it is a Trap Card, add it to your hand.");
    const result = service.effectSearch(`${target} synergy`, [53666449, 98301564, 952523, 91812341, 61307542, 80101899]);
    expect(result.cards.map(card => card.name)).toEqual(["Trap Trick"]);

    const original = JSON.parse((db.prepare("SELECT tags_json FROM card_tags WHERE passcode=80101899").get() as { tags_json: string }).tags_json);
    for (const restriction of [{ subtypes: ["counter"] }, { names: ["Time Seal"] }, { archetypes: ["Hole"] }, { other: '"Hole" Normal Trap Card' }, { other: "Traps that equip themselves to monsters" }, { types: ["Fiend"] }, { level_min: 4 }]) {
      const tags = structuredClone(original);
      Object.assign(tags.effects[0].actions.find((action: { verb: string }) => action.verb === "set_spell_trap").what, restriction);
      db.prepare("UPDATE card_tags SET tags_json=? WHERE passcode=80101899").run(JSON.stringify(tags));
      expect(service.effectSearch(`${target} synergy`, [80101899]).cards, JSON.stringify(restriction)).toEqual([]);
    }
  } finally { db.exec("ROLLBACK TO trap_filter_test; RELEASE trap_filter_test"); }
});

it("separates weaker GY recursion from Deck setup and checks hand Sets against the Trap mechanic", () => {
  db.exec("SAVEPOINT trap_source_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,'image','small','[]','now')`);
    insert.run(28933734, "Mask of Darkness", "Flip Effect Monster", "effect", "FLIP: Target 1 Trap in your GY; add that target to your hand.");
    insert.run(11443677, "Blue-Eyes Tyrant Dragon", "Fusion Monster", "fusion", "At the end of the Damage Step, if this card battled: Target 1 Trap in your GY; Set it to your Spell & Trap Zone.");
    insert.run(24425055, "Booby Trap E", "Trap Card", "trap", "Discard 1 card; Set 1 Continuous Trap Card from your hand or Graveyard to your field.");
    const pool = [28933734, 11443677, 24425055, 80101899];
    const result = service.effectSearch("Temple of the Kings synergy", pool);
    const setup = result.cards.find(card => card.passcode === 80101899)!;
    const recursion = result.cards.find(card => card.passcode === 28933734)!;
    expect(recursion.reason).toContain("Returns a Trap from your GY to your hand");
    expect(recursion.score).toBeLessThan(setup.score);
    expect(result.cards.find(card => card.passcode === 11443677)?.reason).toContain("Re-Sets a Trap from your GY");
    expect(result.cards.find(card => card.passcode === 24425055)?.reason).toContain("Sets a Continuous Trap from your hand");
    expect(service.effectSearch("Labrynth synergy", [24425055]).cards).toEqual([]);
  } finally { db.exec("ROLLBACK TO trap_source_test; RELEASE trap_source_test"); }
});

it.each(["Monarch synergy", "cards that work with Monarch"])("uses the archetype rather than a fuzzy card anchor: %s", text => {
  const result = service.effectSearch(text);
  expect(result.reading?.query.supports?.archetypes).toEqual(["Monarch"]);
  expect(result.cards[0]?.passcode).toBe(4929256);
  expect(result.cards.map(card => card.passcode)).toContain(4929256);
});

it("shows separate lists when no candidate has a specific hook into both archetypes", () => {
  const result = service.effectSearch("synergy with Temple of the Kings and Blue-Eyes");
  expect(result.cards).toEqual([]);
  expect(result.total).toBe(0);
  expect(result.groups?.map(group => group.archetype)).toEqual(["Temple of the Kings", "Blue-Eyes"]);
  expect(result.groups?.[0]?.cards.map(card => card.passcode)).toContain(80101899);
  expect(result.groups?.[1]?.cards.map(card => card.passcode)).toContain(62265044);
});

it("preserves explicit pools, card-kind constraints, omitted chips and exact text", () => {
  expect(service.effectSearch("Temple of the Kings synergy", [80101899]).cards.map(card => card.passcode)).toEqual([80101899]);
  expect(service.effectSearch("Temple of the Kings synergy", []).total).toBe(0);
  expect(service.effectSearch("Monarch synergy spells").cards.every(card => [52112003, 62265044].includes(card.passcode))).toBe(true);
  expect(service.effectSearch("Monarch synergy", undefined, { exact: true }).total).toBe(0);
  const initial = service.effectSearch("Monarch synergy");
  const relaxed = service.effectSearch("Monarch synergy", undefined, { omittedChips: initial.reading!.chips });
  expect(relaxed.total).toBe(6);
});

it("keeps named support when an optional profile is missing or corrupt", () => {
  db.exec("SAVEPOINT profile_test");
  try {
    db.prepare("UPDATE card_tag_profiles SET hooks_json='invalid' WHERE archetype='Monarch'").run();
    expect(service.effectSearch("Monarch synergy").cards.map(card => card.passcode)).toContain(4929256);
    db.prepare("DELETE FROM card_tag_profiles WHERE archetype='Monarch'").run();
    expect(service.effectSearch("Monarch synergy").cards.map(card => card.passcode)).toContain(4929256);
  } finally { db.exec("ROLLBACK TO profile_test; RELEASE profile_test"); }
});

it("rejects Rank and Link Rating alone and preserves individual-card Works with", () => {
  db.exec("SAVEPOINT extra_deck_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,?,?,'image','small','[]','now')`);
    insert.run(39972129, "Number 64: Ronin Raccoon Sandayu", "Beast / Xyz Monster", "xyz", "2 Level 2 Beast monsters", "EARTH", 2);
    insert.run(65741786, "I:P Masquerena", "Cyberse / Link Effect Monster", "link", "2 non-Link Monsters", "DARK", 2);
    expect(service.effectSearch("Spright synergy", [39972129]).cards).toEqual([]);
    expect(service.effectSearch("Code Talker synergy", [65741786]).cards).toEqual([]);
    expect(service.worksWith(29762407, [29762407, 80101899]).map(card => card.passcode)).not.toContain(29762407);
    expect(service.readQuery("works with Trap Trick")?.query.supports?.archetypes).toEqual(["Trap Trick"]);
  } finally { db.exec("ROLLBACK TO extra_deck_test; RELEASE extra_deck_test"); }
});

it("rejects generic Trap removal and type-only partners even in a tiny explicit pool", () => {
  db.exec("SAVEPOINT generic_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,?,?,'image','small','[]','now')`);
    insert.run(49868263, "Ryu Senshi", "Warrior / Fusion Monster", "fusion", "Negate the activation of a Normal Trap Card, and destroy it.", "EARTH", 6);
    insert.run(10515412, "Lightstorm Dragon", "Dragon / Synchro Effect Monster", "synchro", "Destroy 1 Spell/Trap on the field.", "LIGHT", 9);
    expect(service.effectSearch("Temple of the Kings synergy", [49868263, 10515412]).cards).toEqual([]);
    expect(service.effectSearch("Blue-Eyes synergy", [10515412]).cards).toEqual([]);
  } finally { db.exec("ROLLBACK TO generic_test; RELEASE generic_test"); }
});

it("reserves outside space even when more than 40 members qualify", () => {
  db.exec("SAVEPOINT cap_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Effect Monster','effect','Tribute Summon this card.','Monarch','image','small','[]','now')`);
    for (let n = 0; n < 50; n++) insert.run(900000000 + n, `Monarch fixture ${n}`);
    const result = service.effectSearch("Monarch synergy", undefined, { limit: 120 });
    expect(result.cards.filter(card => card.synergyCategory !== "outside")).toHaveLength(15);
    expect(result.cards.find(card => card.passcode === 52112003)?.synergyCategory).toBe("outside");
    expect(result.total).toBe(result.cards.length);
  } finally { db.exec("ROLLBACK TO cap_test; RELEASE cap_test"); }
});

it("caps each outside archetype before the result share while keeping ungrouped partners independent", () => {
  db.exec("SAVEPOINT diversity_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,archetype,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Effect Monster','effect',?,'Kaiju','image','small','[]','now')`);
    const kaiju = [
      [55063751, "Gameciel, the Sea Turtle Kaiju"], [63941210, "Jizukiru, the Star Destroying Kaiju"],
      [93332803, "Dogoran, the Mad Flame Kaiju"], [28674152, "Radian, the Multidimensional Kaiju"],
      [48770333, "Thunder King, the Lightningstrike Kaiju"],
    ] as const;
    for (const [code, name] of kaiju) insert.run(code, name, "You can Special Summon this card to your opponent's field by Tributing 1 monster they control.");
    const result = service.effectSearch("Monarch synergy", undefined, { limit: 120 });
    const outside = result.cards.filter(card => card.synergyCategory === "outside");
    expect(outside.filter(card => kaiju.some(([code]) => code === card.passcode))).toHaveLength(3);
    expect(outside.map(card => card.passcode)).toContain(52112003);
    expect(result.total).toBe(result.cards.length);
    const pool = kaiju.map(([code]) => code);
    expect(service.effectSearch("Monarch synergy", pool).total).toBe(3);
    for (const [at, [code]] of kaiju.entries()) db.prepare("INSERT INTO card_release(passcode,tcg_date,quality,source_version) VALUES(?,?,'ok','integration') ON CONFLICT(passcode) DO UPDATE SET tcg_date=excluded.tcg_date,ocg_date=NULL").run(code, `202${at}-01`);
    const newest = service.effectSearch("Monarch synergy", pool, { sort: "newest", limit: 1 });
    expect(newest.total).toBe(3);
    expect(newest.cards.map(card => card.passcode)).toEqual([48770333, 28674152, 93332803]);
  } finally { db.exec("ROLLBACK TO diversity_test; RELEASE diversity_test"); }
});

it("rejects random Deck milling while preserving both printed orders of deliberate Blue-Eyes setup", () => {
  db.exec("SAVEPOINT deliberate_setup_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Effect Monster','effect',?,'image','small','[]','now')`);
    insert.run(572850, "Tearlaments Scheiren", "Special Summon this card from your hand, send 1 monster from your hand to the GY, then send the top 3 cards of your Deck to the GY.");
    insert.run(67441435, "Glow-Up Bulb", "Send the top card of your Deck to the GY, and Special Summon this card.");
    insert.run(81439173, "Foolish Burial", "Send from your Deck to the GY, 1 monster.");
    insert.run(63198739, "Primite Dragon Ether Beryl", "You can Tribute this card; send 1 Normal Monster from your Deck to the GY.");
    insert.run(15381252, "Berserker Soul", "Excavate the top card of your Deck, and if it is a Monster Card, send it to the Graveyard.");
    insert.run(27552504, "Beatrice, Lady of the Eternal", "Send 1 card from your hand or Deck to the GY.");
    const result = service.effectSearch("Blue-Eyes synergy", [572850, 67441435, 15381252, 81439173, 63198739, 62265044, 27552504]);
    expect(result.cards.map(card => card.name)).toEqual(expect.arrayContaining(["Foolish Burial", "Primite Dragon Ether Beryl", "Dragon Ravine", "Beatrice, Lady of the Eternal"]));
    expect(result.cards).toHaveLength(4);
  } finally { db.exec("ROLLBACK TO deliberate_setup_test; RELEASE deliberate_setup_test"); }
});

it("counts overlapping engine memberships without charging rejected cards to another group", () => {
  const directory = mkdtempSync(join(tmpdir(), "synergy-overlap-"));
  db.exec("SAVEPOINT overlap_test");
  const engine = new Database(join(directory, "cards.cdb"));
  try {
    engine.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER,setcode INTEGER,ot INTEGER DEFAULT 3);
      CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);`);
    writeFileSync(join(directory, "strings.conf"), "!setname 0x123 First fixture group\n!setname 0x124 Second fixture group\n");
    const codes = [55063751, 93332803, 28674152, 63941210, 36956512, 48770333, 29726552, 27204311];
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,'Effect Monster','effect',?,'image','small','[]','now')`);
    for (const [at, code] of codes.entries()) {
      const name = `Overlap fixture ${code}`, text = "Tribute 1 monster your opponent controls.";
      insert.run(code, name, text);
      db.prepare("UPDATE card_tags SET popularity=? WHERE passcode=?").run(100 - at, code);
      engine.prepare("INSERT INTO datas VALUES(?,0,33,1000,1000,4,1,16,?,3)").run(code, at < 3 ? 0x123 : at < 5 ? 0x1240123 : 0x124);
      engine.prepare("INSERT INTO texts VALUES(?,?,?)").run(code, name, text);
    }
    const result = createCardInsightService(db, { dataDirectory: directory }).effectSearch("Monarch synergy", codes, { limit: 120 });
    expect(result.cards.map(card => card.passcode)).toEqual([...codes.slice(0, 3), ...codes.slice(5)]);
    expect(result.total).toBe(6);
  } finally {
    engine.close();
    db.exec("ROLLBACK TO overlap_test; RELEASE overlap_test");
    rmSync(directory, { recursive: true, force: true });
  }
});
