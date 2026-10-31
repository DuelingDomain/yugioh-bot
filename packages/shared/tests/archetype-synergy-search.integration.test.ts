import Database from "better-sqlite3";
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
  expect(result.cards.find(card => card.passcode === 80101899)?.reason).toContain("Sets Traps");
});

it.each(["Monarch synergy", "cards that work with Monarch"])("uses the archetype rather than a fuzzy card anchor: %s", text => {
  const result = service.effectSearch(text);
  expect(result.reading?.query.supports?.archetypes).toEqual(["Monarch"]);
  expect(result.cards[0]?.passcode).toBe(52112003);
  expect(result.cards.map(card => card.passcode)).toContain(4929256);
});

it("ranks cards fitting both profiles before the union of single-archetype partners", () => {
  const result = service.effectSearch("synergy with Temple of the Kings and Blue-Eyes");
  expect(result.cards[0]?.passcode).toBe(62265044);
  expect(result.cards[0]?.reason).toContain("Temple of the Kings + Blue-Eyes");
  expect(result.cards.map(card => card.passcode)).toContain(80101899);
  expect(new Set(result.cards.map(card => card.passcode)).size).toBe(result.total);
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

it("keeps explicit Rank and Link Rating hooks searchable and preserves individual-card Works with", () => {
  db.exec("SAVEPOINT extra_deck_test");
  try {
    const insert = db.prepare(`INSERT INTO card_catalog
      (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,image_url,image_url_small,card_sets_json,cached_at)
      VALUES(?,?,?,?,?,?,?,'image','small','[]','now')`);
    insert.run(39972129, "Number 64: Ronin Raccoon Sandayu", "Beast / Xyz Monster", "xyz", "2 Level 2 Beast monsters", "EARTH", 2);
    insert.run(65741786, "I:P Masquerena", "Cyberse / Link Effect Monster", "link", "2 non-Link Monsters", "DARK", 2);
    expect(service.effectSearch("Spright synergy", [39972129]).cards.map(card => card.passcode)).toEqual([39972129]);
    expect(service.effectSearch("Code Talker synergy", [65741786]).cards.map(card => card.passcode)).toEqual([65741786]);
    expect(service.worksWith(29762407, [29762407, 80101899]).map(card => card.passcode)).not.toContain(29762407);
    expect(service.readQuery("works with Trap Trick")?.query.supports?.archetypes).toEqual(["Trap Trick"]);
  } finally { db.exec("ROLLBACK TO extra_deck_test; RELEASE extra_deck_test"); }
});
