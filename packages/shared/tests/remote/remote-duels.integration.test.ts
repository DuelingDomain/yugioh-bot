import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { deleteUserAccount, DELETED_PLAYER_NAME } from "../../src/services/account-deletion.js";
import { migrate } from "../../src/db/index.js";
import { seedUser } from "../helpers/identity.js";
import { createRemoteDuelService } from "../../src/services/remote-duels.js";
import { getRemoteGame, resolveAttack, ygoModule, remoteActionSchema, type GameModule, type SeatCount } from "../../src/remote/index.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys = ON"); migrate(db);
  const users = ["a", "b", "c", "d"].map(key => seedUser(db, key).userId);
  const service = createRemoteDuelService(db, { dataDirectory: deckData });
  let table = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 3 }, 1000);
  table = registerTestDeck(db, service, table.slug, users[0], 1000);
  return { db, users, service, table };
}

function registerTestDeck(db: Database.Database, service: ReturnType<typeof createRemoteDuelService>, slug: string, user: number, now: number) {
  const saved = createSavedDeckService(db, new Map()).create("g", user, { name: "Remote fixture", mode: "normal",
    deck: { main: Array.from({length:40},(_,i)=>i+1), extra: [], side: [] } });
  return service.selectDeck(slug, "g", user, { savedDeckId: saved.id }, now);
}

const deckData = mkdtempSync(join(tmpdir(), "remote-deck-checks-"));
mkdirSync(join(deckData, "card-scripts"));
writeFileSync(join(deckData, "strings.conf"), "");
{
  const catalog = new Database(join(deckData, "cards.cdb"));
  catalog.exec("create table datas(id integer primary key,ot integer,alias integer,setcode integer,type integer,race integer,attribute integer,atk integer default 0,def integer default 0,level integer default 1); create table texts(id integer primary key,name text,desc text)");
  const add = (id: number, name: string, type = 0x11, alias = 0) => {
    catalog.prepare("insert into datas(id,ot,alias,setcode,type,race,attribute) values(?,3,?,0,?,1,1)").run(id, alias, type);
    catalog.prepare("insert into texts values(?,?, '')").run(id, name);
    writeFileSync(join(deckData, "card-scripts", "c" + id + ".lua"), "");
  };
  for (let i = 1; i <= 100; i++) add(i, "Filler " + i);
  add(14558127, "Ash Blossom", 0x21); add(55144522, "Pot of Greed", 2);
  add(101, "Fusion", 0x41); add(102, "Link", 0x4000021);
  add(103, "Outside Domain", 0x11);
  catalog.prepare("update datas set race=2,attribute=2 where id=103").run();
  add(104, "Ash Blossom", 0x21, 14558127);
  add(33396948, "Limited Test");
  // Real printed metadata; this fixture never needs a developer engine bundle.
  const realCards: [number, string, string, number, number, number, number, number, number][] = [
    [80101899, "Trap Trick", "Banish 1 Normal Trap from your Deck, except \"Trap Trick\", and if you do, Set 1 card with the same name directly from your Deck. It can be activated this turn. You can only activate 1 Trap Card for the rest of this turn after this card resolves. You can only activate 1 \"Trap Trick\" per turn.", 4, 0, 0, 0, 0, 0],
    [70825459, "Trap Tracks", "Target 1 monster you control; destroy it, and if you do, Set 1 Normal Trap directly from your Deck, except \"Trap Tracks\". It can be activated this turn. You can only activate 1 Trap Card for the rest of this turn after this card resolves. You can only activate 1 \"Trap Tracks\" per turn.", 4, 0, 0, 0, 0, 0],
    [23898021, "Lilith, Lady of Lament", "If this card is Normal Summoned, its original ATK becomes 1000. (Quick Effect): You can Tribute 1 DARK monster; reveal 3 Normal Traps from your Deck, your opponent randomly chooses 1 for you to Set on your field, and you shuffle the rest back into your Deck. You can only use this effect of \"Lilith, Lady of Lament\" once per turn.", 33, 8, 32, 2000, 0, 3],
    [73628505, "Terraforming", "Add 1 Field Spell from your Deck to your hand.", 2, 0, 0, 0, 0, 0],
    [32807846, "Reinforcement of the Army", "Add 1 Level 4 or lower Warrior monster from your Deck to your hand.", 2, 0, 0, 0, 0, 0],
    [53582587, "Torrential Tribute", "When a monster(s) is Summoned: Destroy all monsters on the field.", 4, 0, 0, 0, 0, 0],
    [37576645, "Reckless Greed", "Draw 2 cards and skip your next 2 Draw Phases.", 4, 0, 0, 0, 0, 0],
    [10045474, "Infinite Impermanence", "Target 1 face-up monster your opponent controls; negate its effects (until the end of this turn), then, if this card was Set before activation and is on the field at resolution, for the rest of this turn all other Spell/Trap effects in this column are negated. If you control no cards, you can activate this card from your hand.", 4, 0, 0, 0, 0, 0],
    [97077563, "Call of the Haunted", "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position. When this card leaves the field, destroy that monster. When that monster is destroyed, destroy this card.", 131076, 0, 0, 0, 0, 0],
    [5318639, "Mystical Space Typhoon", "Target 1 Spell/Trap on the field; destroy that target.", 65538, 0, 0, 0, 0, 0],
    [14087893, "Book of Moon", "Target 1 face-up monster on the field; change that target to face-down Defense Position.", 65538, 0, 0, 0, 0, 0],
    [47355498, "Necrovalley", "All \"Gravekeeper's\" monsters gain 500 ATK/DEF. Cards in the GY cannot be banished. Negate any card effect that would move a card in the GY to a different place. Negate any card effect that changes Types or Attributes in the GY.", 524290, 0, 0, 0, 0, 0],
    [67616300, "Chicken Game", "The player with the lowest LP takes no damage. Once per turn, during the Main Phase: The turn player can pay 1000 LP, then activate 1 of these effects;\r\n● Draw 1 card.\r\n● Destroy this card.\r\n● Your opponent gains 1000 LP.\r\nNeither player can activate cards or effects in response to this effect's activation.", 524290, 0, 0, 0, 0, 0],
    [2460565, "Marauding Captain", "Monsters your opponent controls cannot target Warrior monsters for attacks, except this one. When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower monster from your hand.", 33, 1, 1, 1200, 400, 3],
    [63977008, "Junk Synchron", "When this card is Normal Summoned: You can target 1 Level 2 or lower monster in your GY; Special Summon that target in Defense Position, but negate its effects.", 4129, 1, 32, 1300, 500, 3],
    [89631133, "Blue-Eyes White Dragon", "This legendary dragon is a powerful engine of destruction. Virtually invincible, very few have faced this awesome creature and lived to tell the tale.", 17, 8192, 16, 3000, 2500, 8],
    [46986414, "Dark Magician", "The ultimate wizard in terms of attack and defense.", 17, 2, 32, 2500, 2100, 7],
    [71413901, "Breaker the Magical Warrior", "If this card is Normal Summoned: Place 1 Spell Counter on it (max. 1). Gains 300 ATK for each Spell Counter on it. You can remove 1 Spell Counter from this card, then target 1 Spell/Trap on the field; destroy that target.", 33, 2, 32, 1600, 1000, 4],
    [73752131, "Skilled Dark Magician", "Each time a Spell Card is activated, place 1 Spell Counter on this card when that Spell resolves (max. 3). You can Tribute this card with 3 Spell Counters on it; Special Summon 1 \"Dark Magician\" from your hand, Deck, or GY.", 33, 2, 32, 1900, 1700, 4],
    [9156135, "Apprentice Magician", "If this card is Summoned: Target 1 face-up card on the field that you can place a Spell Counter on; place 1 Spell Counter on that target. When this card is destroyed by battle: You can Special Summon 1 Level 2 or lower Spellcaster monster from your Deck in face-down Defense Position.", 33, 2, 32, 400, 800, 2],
    [45141844, "Old Vindictive Magician", "FLIP: Target 1 monster your opponent controls; destroy that target.", 2097185, 2, 32, 450, 600, 2],
    [97268402, "Effect Veiler", "During your opponent's Main Phase (Quick Effect): You can send this card from your hand to the GY, then target 1 Effect Monster your opponent controls; negate the effects of that face-up monster your opponent controls, until the end of this turn.", 4129, 2, 16, 0, 0, 1],
    [31560081, "Magician of Faith", "FLIP: Target 1 Spell in your GY; add that target to your hand.", 2097185, 2, 16, 300, 400, 1],
    [423585, "Summoner Monk", "While this card is face-up on the field, it cannot be Tributed. If this card is Normal or Flip Summoned: Change this card to Defense Position. Once per turn: You can discard 1 Spell; Special Summon 1 Level 4 monster from your Deck, but that monster cannot attack this turn.", 33, 2, 32, 800, 1600, 4],
  ];
  for (const [id, name, text, type, race, attribute, atk, def, level] of realCards) {
    add(id, name, type);
    catalog.prepare("update datas set race=?,attribute=?,atk=?,def=?,level=? where id=?").run(race,attribute,atk,def,level,id);
    catalog.prepare("update texts set desc=? where id=?").run(text,id);
  }
  catalog.close();
}
afterAll(() => rmSync(deckData, { recursive: true, force: true }));
function deckSession(format: "normal" | "domain" | "genesys" | "genesys-domain" = "domain", solo = true) {
  const { db, users } = setup();
  const service = createRemoteDuelService(db, { dataDirectory: deckData });
  let room = service.create({ guildId: "g", userId: users[0], displayName: "Sulman", gameId: "ygo", seatCount: 2, solo, format }, 2000);
  const decks = createSavedDeckService(db, new Map());
  const save = (main = Array.from({ length: format.includes("domain") ? 60 : 40 }, (_, i) => i + 1), extra: number[] = [], owner = users[0]) =>
    decks.create("g", owner, { name: "Registered", mode: format.includes("domain") ? "domain" : "normal",
      deck: { main, extra, side: [], ...(format.includes("domain") ? { deckMaster: 100 } : {}) } });
  const select = (id: number | null, seat = 0) => room = service.selectDeck(room.slug, "g", users[0], { savedDeckId: id, seat }, 2001);
  const start = () => { service.ready(room.slug, "g", users[0], true, 2002); room = service.start(room.slug, "g", users[0], 2003); };
  let n = 0;
  const act = (input: Record<string, unknown>) => room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq,
    action: remoteActionSchema.parse({ actorSeat: 0, idempotencyKey: "check-" + (++n), ...input }) }, 2100 + n);
  const place = (ref: string, zone = "monster", slot = 1, cardId = 14558127) => act({ type: "twin.place", seat: 0, zone, card: { ref, cardId, slot } });
  return { db, users, service, save, select, start, act, place, get room() { return room; } };
}
describe("remote deck registration and live checks", () => {
  it("defaults Deck choice publicity on and preserves a strict table option through configuration and replay", () => {
    const s = deckSession("normal");
    expect(s.room.showCardsSetFromDeck).toBe(true);
    expect(s.room.state.showCardsSetFromDeck).toBe(true);
    const strict = s.service.configure(s.room.slug, "g", s.users[0], { format: "normal", showCardsSetFromDeck: false }, 2001);
    expect(strict.showCardsSetFromDeck).toBe(false);
    expect(strict.state.showCardsSetFromDeck).toBe(false);
    expect(s.service.replay(strict.slug, "g", s.users[0])).toEqual(strict.state);
    const unchanged = s.service.configure(strict.slug, "g", s.users[0], { format: "normal" }, 2002);
    expect(unchanged.showCardsSetFromDeck).toBe(false);
    expect(s.service.list("g", s.users[0]).find(t => t.slug === strict.slug)?.showCardsSetFromDeck).toBe(false);
    expect(() => s.service.configure(strict.slug, "g", s.users[0], { format: "normal", showCardsSetFromDeck: "false" as unknown as boolean }, 2003)).toThrow(/publicity setting/i);
    const created = s.service.create({guildId:"g",userId:s.users[0],displayName:"A",gameId:"ygo",seatCount:2,showCardsSetFromDeck:false},2004);
    expect(created.showCardsSetFromDeck).toBe(false);
    expect(s.service.replay(created.slug,"g",s.users[0])).toEqual(created.state);
    expect(() => s.service.create({guildId:"g",userId:s.users[0],displayName:"A",gameId:"ygo",seatCount:2,showCardsSetFromDeck:0 as unknown as boolean},2005)).toThrow(/publicity setting/i);
    s.start();
    expect(() => s.service.configure(strict.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:true},2200)).toThrow(/lobby/i);
  });
  it("adds default-on Deck publicity to populated tables without rewriting their state or events", () => {
    const {db, service, table, users} = setup();
    const before = db.prepare("select state_json from remote_tables where slug=?").get(table.slug);
    const events = service.get(table.slug,"g",users[0]).events;
    db.exec("alter table remote_tables drop column show_cards_set_from_deck");
    migrate(db); migrate(db);
    expect(db.prepare("select show_cards_set_from_deck from remote_tables where slug=?").get(table.slug)).toEqual({show_cards_set_from_deck:1});
    expect(db.prepare("select state_json from remote_tables where slug=?").get(table.slug)).toEqual(before);
    expect(service.get(table.slug,"g",users[0]).events).toEqual(events);
    expect(service.get(table.slug,"g",users[0]).showCardsSetFromDeck).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("blocks multiplayer readiness without a deck and rejects invalid selected decks in solo", () => {
    const live = deckSession("normal", false);
    expect(() => live.service.ready(live.room.slug, "g", live.users[0], true, 2001)).toThrow(/select.*deck/i);
    const solo = deckSession("domain");
    solo.select(solo.save([1, 1]).id);
    expect(solo.room.seats[0].deck?.validation.issues.map(i => i.message)).toEqual(expect.arrayContaining(["Main Deck must have exactly 60 cards", "Duplicate card: filler 1"]));
    expect(() => solo.start()).toThrow(/60 cards|Duplicate card/);
    solo.select(null); solo.start(); expect(solo.room.status).toBe("active");
  });
  it("snapshots owned saved decks and resets ready on format changes", () => {
    const s = deckSession("normal"); const saved = s.save();
    expect(() => s.select(s.save(undefined, [], s.users[1]).id)).toThrow(/not found/i);
    s.select(saved.id); s.service.ready(s.room.slug, "g", s.users[0], true, 2002);
    const configured = s.service.configure(s.room.slug, "g", s.users[0], { format: "domain" }, 2003);
    expect(configured.seats[0].ready).toBe(false);
    expect(configured.seats[0].deck?.validation.issues.some(i => /Deck Master/.test(i.message))).toBe(true);
    expect(() => s.service.configure(s.room.slug, "g", s.users[1], { format: "normal" }, 2004)).toThrow();
    expect(createSavedDeckService(s.db).get(saved.id, "g", s.users[0]).deck).toEqual(saved.deck);
  });
  it("recognizes an unregistered card, offers a valid addition, logs it and replays", () => {
    const s = deckSession("normal"); const original = s.save(); s.select(original.id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "click" });
    expect(s.room.state.identified).toMatchObject({ name: "Ash Blossom", notInDecklist: true, addErrors: [] });
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(s.room.state.identified?.notInDecklist).toBe(false);
    expect(s.room.events.at(-1)?.messages).toContain("Sulman added Ash Blossom to their decklist");
    expect(s.room.seats[0].deck?.deck.main).toHaveLength(41);
    expect(createSavedDeckService(s.db).get(original.id, "g", s.users[0]).deck.main).toHaveLength(40);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["normal", "domain"] as const)("shows why an addition cannot stay legal in %s", format => {
    const s = deckSession(format); s.select(s.save(Array.from({ length: 60 }, (_, i) => i + 1)).id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "click" });
    expect(s.room.state.identified?.notInDecklist).toBe(true);
    expect(s.room.state.identified?.addErrors.some(e => /60/.test(e))).toBe(true);
    const seq = s.room.lastSeq;
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/60/);
    expect(s.service.get(s.room.slug, "g", s.users[0]).lastSeq).toBe(seq);
  });
  it("uses full Domain membership and Genesys rules for registration", () => {
    const domain = deckSession("domain");
    domain.select(domain.save([...Array.from({length:59},(_,i)=>i+1),103]).id);
    expect(domain.room.seats[0].deck?.validation.issues.some(i => /outside.*Domain/.test(i.message))).toBe(true);
    const genesys = deckSession("genesys"); genesys.select(genesys.save().id);
    expect(genesys.room.seats[0].deck?.validation.issues.some(i => /points are unknown/.test(i.message))).toBe(true);
    expect(() => genesys.start()).toThrow(/points/);
  });
  it.each(["hand", "deck"])("does not flag a card bounced to %s and replayed with a new scan/ref", zone => {
    const s = deckSession(); s.start(); s.place("first");
    s.act({ type: "twin.move", seat: 0, cardRef: "first", zone });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 2, source: "auto" });
    s.place("replayed", "monster", 2);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
  });
  it("does not flag a card sent to GY then revived or re-scanned", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "twin.move", seat: 0, cardRef: "one", zone: "graveyard" });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "graveyard", source: "auto" });
    s.act({ type: "twin.move", seat: 0, cardRef: "one", zone: "monster", slot: 3 });
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 3, source: "auto" });
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
  });
  it.each(["monster", "graveyard"])("proves two concurrent copies with the first still in %s", zone => {
    const s = deckSession(); s.start(); s.place("first", zone, 1); s.place("second", "monster", 2);
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    const flag = s.room.state.deckChecks.flags[0];
    expect(flag.message).toMatch(/Deck no longer valid: 2 copies of Ash Blossom seen \(Domain allows 1\)/);
    expect(flag.proof).toEqual(expect.arrayContaining(zone === "monster" ? ["field zone 1", "field zone 2"] : ["GY", "field zone 2"]));
    expect(s.room.events.at(-1)?.messages?.join(" ")).toContain("at the same time");
    expect(s.room.state.ended).toBe(false);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("reuses instances through unlocated recognition, flips and removals", () => {
    const s = deckSession(); s.start(); s.place("one");
    for (let i=0;i<3;i++) s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "auto" });
    s.act({ type: "twin.flip", seat: 0, cardRef: "one", faceUp: false }); s.place("two", "monster", 2);
    s.act({ type: "twin.remove", seat: 0, cardRef: "two" }); s.place("three", "monster", 3);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
  });
  it("proves a recognition batch of hand reveals and ignores later re-sightings", () => {
    const s = deckSession(); s.start();
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "region-1", zone: "hand-reveal" },
      { cardId: 14558127, observationId: "region-2", zone: "hand-reveal" },
    ] });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    expect(s.room.state.deckChecks.flags[0].proof.join(" ")).toMatch(/same recognition batch/);
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "auto" });
    expect(s.room.state.deckChecks.instances).toHaveLength(2);
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("flags forbidden cards and uses artwork identity for singleton proof", () => {
    const banned = deckSession("normal"); banned.start();
    banned.act({ type: "card.identified", seat: 0, cardId: 55144522, source: "click" });
    expect(banned.room.state.deckChecks.flags[0]?.message).toMatch(/Pot of Greed.*allows 0/);
    const domain = deckSession(); domain.start(); domain.place("a"); domain.place("b", "monster", 2, 104);
    expect(domain.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("logs dismissal and instance merge, with deterministic replay", () => {
    const s = deckSession(); s.start(); s.place("first"); s.place("second", "monster", 2);
    const flag = s.room.state.deckChecks.flags[0];
    s.act({ type: "deck.flag.dismiss", flagId: flag.id, reason: "Wrong recognition" });
    expect(s.room.state.deckChecks.flags[0].dismissed).toBe(true);
    const instances = s.room.state.deckChecks.instances;
    s.act({ type: "twin.merge", seat: 0, keepInstanceId: instances[0].id, removeInstanceId: instances[1].id, reason: "Same physical card" });
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
    expect(s.room.state.seats[0].twin).toHaveLength(1);
    expect(s.room.events.at(-1)?.messages?.join(" ")).toMatch(/merged/);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("does not use old scans or overlapping field coordinates as concurrent proof", () => {
    const s = deckSession(); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, zone: "monster", slot: 1, source: "auto" });
    s.place("one", "monster", 2);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    s.place("different", "monster", 2, 1);
    s.act({ type: "card.identified", seat: 0, cardRef: "different", cardId: 14558127, zone: "monster", slot: 2, source: "auto" });
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("recognizes two cards in the same pile in one batch, without counting duplicate field coordinates", () => {
    const s = deckSession(); s.start();
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "a", zone: "graveyard" },
      { cardId: 14558127, observationId: "b", zone: "graveyard" },
    ] });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    const overlap = deckSession(); overlap.start();
    overlap.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, observationId: "a", zone: "monster", slot: 1 },
      { cardId: 14558127, observationId: "b", zone: "monster", slot: 1 },
    ] });
    expect(overlap.room.state.deckChecks.flags).toEqual([]);
  });
  it("applies current Advanced limits and full validation to banned/duplicate additions", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 55144522, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/forbidden/);
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 55144522 })).toThrow(/forbidden/);
    for (let i=0;i<3;i++) s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/More than 3/);
    for (let i=1;i<=3;i++) s.place("ash"+i, "monster", i);
    expect(s.room.state.deckChecks.flags.filter(f => f.copyKey === 14558127)).toHaveLength(0);
    s.place("ash4", "monster", 4);
    expect(s.room.state.deckChecks.flags.filter(f => f.copyKey === 14558127)).toHaveLength(1);
  });
  it.each(["genesys", "genesys-domain"] as const)("uses current points and type bans for %s additions", format => {
    const s = deckSession(format);
    s.db.prepare("insert into genesys_points_meta values(1,'test','2026-10-05','test','test')").run();
    const point = s.db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at,genesys_points,genesys_revision) values(?,?,'Normal Monster','normal','','','[]','test',?,'test')");
    for (let i=1;i<=104;i++) point.run(i, "Card "+i, 0);
    point.run(14558127, "Ash Blossom", 101);
    s.select(s.save().id); s.start();
    s.act({ type: "card.identified", seat: 0, cardId: 14558127, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/101 Genesys points; the cap is 100/);
    expect(() => s.act({ type: "deck.add", seat: 0, cardId: 14558127 })).toThrow(/Genesys points/);
    s.act({ type: "card.identified", seat: 0, cardId: 102, source: "typed" });
    expect(s.room.state.identified?.addErrors.join(" ")).toMatch(/Link or Pendulum/);
  });
  it("undoes a valid deck edit in both the state and seat snapshot", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    const actionId = s.room.state.undo!.actionId;
    s.act({ type: "undo", targetActionId: actionId });
    expect(s.room.seats[0].deck?.deck.main).toHaveLength(40);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it("adds the new columns to populated pre-deck tables without rewriting events", () => {
    const { db, service, table, users } = setup();
    const events = service.get(table.slug,"g",users[0]).events;
    db.exec("alter table remote_tables drop column format_json; alter table remote_seats drop column saved_deck_id; alter table remote_seats drop column deck_json; alter table remote_bot_seats drop column saved_deck_id; alter table remote_bot_seats drop column deck_json; alter table remote_events drop column effects_json; alter table remote_events drop column messages_json");
    migrate(db); migrate(db);
    expect(service.get(table.slug,"g",users[0]).events).toEqual(events);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("reuses the known public instance for an unlocated one-card recognition batch", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [{ cardId: 14558127, observationId: "region" }] });
    expect(s.room.state.deckChecks.instances).toHaveLength(1);
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not prove extra copies from unspecified row slots or a single field position", () => {
    const s = deckSession(); s.start(); s.place("one");
    s.act({ type: "cards.identified", seat: 0, source: "auto", cards: [{ cardId: 14558127, zone: "monster", observationId: "region" }] });
    expect(s.room.state.deckChecks.flags).toEqual([]);
    const ambiguous = deckSession(); ambiguous.start();
    ambiguous.act({type:"twin.place",seat:0,zone:"monster",card:{ref:"unknown-slot",cardId:14558127}});
    ambiguous.place("known-slot","monster",2);
    expect(ambiguous.room.state.deckChecks.flags).toEqual([]);
    const field = deckSession(); field.start(); field.place("field-a","field",1); field.place("field-b","field",2);
    expect(field.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not count conflicting same-slot batch refs as separate physical detections", () => {
    const s = deckSession(); s.start(); s.place("a"); s.place("b","monster",1,1);
    s.act({ type:"cards.identified",seat:0,source:"auto",cards:[
      {cardId:14558127,cardRef:"a",observationId:"a"}, {cardId:14558127,cardRef:"b",observationId:"b"},
    ]});
    expect(s.room.state.deckChecks.flags).toEqual([]);
  });
  it("applies an Advanced limited-card cap to simultaneous copies", () => {
    const s = deckSession("normal"); s.start(); s.place("one","monster",1,33396948);
    expect(s.room.state.deckChecks.flags).toEqual([]);
    s.place("two","monster",2,33396948);
    expect(s.room.state.deckChecks.flags[0]?.message).toMatch(/2 copies of Limited Test seen.*Advanced allows 1/);
  });
  it("binds recognition to the referenced twin's known position and visibility", () => {
    const s = deckSession(); s.start();
    s.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "a", slot: 1 } });
    s.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "b", slot: 2 } });
    s.act({ type: "card.identified", seat: 0, cardRef: "a", cardId: 14558127, source: "click" });
    s.act({ type: "card.identified", seat: 0, cardRef: "b", cardId: 14558127, source: "click" });
    expect(s.room.state.deckChecks.flags).toHaveLength(1);
    expect(s.room.state.deckChecks.flags[0].proof.join(" and ")).toMatch(/field zone 1 and field zone 2/);
    const hidden = deckSession(); hidden.start(); hidden.place("public");
    hidden.act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "hidden", slot: 2, faceUp: false } });
    hidden.act({ type: "card.identified", seat: 0, cardRef: "hidden", cardId: 14558127, zone: "graveyard", source: "click" });
    expect(hidden.room.state.deckChecks.flags).toEqual([]);
    hidden.act({ type: "twin.flip", seat: 0, cardRef: "hidden", faceUp: true });
    expect(hidden.room.state.deckChecks.flags).toHaveLength(1);
  });
  it("preserves twin ownership and keeps saved-deck snapshots out of open listings", () => {
    const s = deckSession(); s.select(s.save().id);
    expect(s.service.list("g",s.users[1],"open").flatMap(t => t.seats).every(seat => !seat.deck)).toBe(true);
    s.start(); s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone: "monster", card: { ref: "bot", slot: 1 } });
    expect(() => s.act({ type: "card.identified", seat: 1, cardRef: "bot", cardId: 14558127, source: "click" })).toThrow(/owner/);
  });
  it("uses configured starting LP and preserves it through replay", () => {
    const s = deckSession();
    const room = s.service.configure(s.room.slug,"g",s.users[0],{format:"domain",rules:{startingLP:12000}},2001);
    expect(room.state.seats.every(seat => seat.resources.lp === 12000)).toBe(true);
    expect(s.service.replay(room.slug,"g",s.users[0])).toEqual(room.state);
  });
  it("renders logged deck edits with current seat names without copying personal names into events", () => {
    const s = deckSession("normal"); s.select(s.save().id); s.start();
    s.act({ type: "deck.add", seat: 0, cardId: 14558127 });
    expect(s.room.events.at(-1)?.messages).toContain("Sulman added Ash Blossom to their decklist");
    expect(JSON.stringify(s.db.prepare("select * from remote_events").all())).not.toContain("Sulman");
    deleteUserAccount(s.db,s.users[0]);
    expect(s.service.get(s.room.slug,"g",s.users[0]).events.at(-1)?.messages).toContain(DELETED_PLAYER_NAME+" added Ash Blossom to their decklist");
  });
});
describe("solo remote tables", () => {
  it("parses voice controls for the selected bot through the same reducer", () => {
    let state = ygoModule.initialState({ seatCount: 3 }); let n = 0;
    const speak = (text: string, actorSeat = 1) => {
      const proposal = ygoModule.parseCommand({ text, actorSeat, state });
      expect(proposal, text).not.toBeNull();
      state = ygoModule.reduce(state, { ...proposal!, idempotencyKey: `speech-${++n}`, at: n });
    };
    speak("place Dark Magician in monster slot 3");
    expect(state.seats[1].twin[0]).toMatchObject({ name: "Dark Magician", slot: 3, faceUp: true });
    speak("flip Dark Magician face down");
    speak("move slot 3 to graveyard");
    expect(state.seats[1].twin[0]).toMatchObject({ zone: "graveyard", faceUp: false });
    speak("lose 500 LP"); expect(state.seats[1].resources.lp).toBe(7500);
    speak("undo"); expect(state.seats[1].resources.lp).toBe(8000);
    speak("set LP to 7000"); expect(state.seats[1].resources.lp).toBe(7000);
    speak("gain 1000 LP"); expect(state.seats[1].resources.lp).toBe(8000);
    speak("note bot adjusted");
    speak("identify 89631139", 0); expect(state.identified).toMatchObject({ seat: 0, cardId: 89631139, source: "voice" });
    speak("end turn", 0); speak("next phase"); expect(state.phase).toBe("standby");
    speak("main 1 phase"); expect(state.phase).toBe("main1");
    speak("remove Dark Magician"); expect(state.seats[1].twin).toEqual([]);
    expect(ygoModule.parseCommand({ text: "nonsense", actorSeat: 1, state })).toBeNull();
    expect(ygoModule.parseCommand({ text: "gain 0 LP", actorSeat: 1, state })).toBeNull();
    expect(ygoModule.parseCommand({ text: "next phase", actorSeat: 3, state })).toBeNull();
  });

  it.each([2, 3, 4] as SeatCount[])("fills a %i-seat solo table with userless, ready bots and runs the full action loop", seatCount => {
    const { service, users, db } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount, solo: true }, 2000);
    expect(room.solo).toBe(true);
    expect(room.mySeat).toBe(0);
    expect(room.seats).toHaveLength(seatCount);
    expect(room.seats[0]).toMatchObject({ userId: users[0], bot: false });
    expect(room.seats.slice(1).every(s => s.userId === null && s.bot && s.ready && s.displayName.startsWith("Test Bot"))).toBe(true);
    expect(canReadRemote(db, { slug: room.slug, guildId: "g", userId: users[0], seat: 1, expiresAt: 999999 })).toBe(false);
    expect(service.list("g", users[0], "open").some(t => t.slug === room.slug)).toBe(false);
    expect(() => service.join(room.slug, "g", users[1], "Intruder", 1, 2001)).toThrow(/solo/i);
    expect(() => service.get(room.slug, "g", users[1])).toThrow(/not found/i);
    expect(() => service.start(room.slug, "g", users[0], 2001)).toThrow(/ready/i);
    service.ready(room.slug, "g", users[0], true, 2002);
    room = service.start(room.slug, "g", users[0], 2003);
    let n = 0;
    const act = (actorSeat: number, action: Record<string, unknown>) => {
      room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq,
        action: remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `solo-${seatCount}-${++n}` }) }, 2100 + n);
    };
    act(0, { type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1 } });
    act(1, { type: "twin.place", seat: 1, zone: "monster", card: { ref: "dark", name: "Dark Magician", slot: 3 } });
    act(1, { type: "twin.flip", seat: 1, cardRef: "dark", faceUp: false });
    act(1, { type: "twin.flip", seat: 1, cardRef: "dark", faceUp: true });
    act(1, { type: "twin.move", seat: 1, cardRef: "dark", zone: "extra-monster", slot: 1 });
    act(0, { type: "card.identified", seat: 0, cardId: 89631139, source: "click" });
    act(1, { type: "lp.change", seat: 1, delta: -500, reason: "Solo correction" });
    const key = room.state.undo!.actionId;
    act(1, { type: "log.note", text: "Bot field adjusted" });
    act(0, { type: "undo", targetActionId: key });
    expect(room.state.seats[1].resources.lp).toBe(8000);
    for (let seat = 0; seat < seatCount; seat++) act(seat, { type: "turn.end" });
    act(0, { type: "phase.set", phase: "battle" });
    const result = ygoModule.resolveAttack(room.state, { text: "my dragon attacks Test Bot 1's magician", players: room.seats }, 0);
    expect(result.status).toBe("unique");
    act(0, result.candidates[0].proposal);
    expect(room.state.attack).toMatchObject({ attackerSeat: 0, targetSeat: 1, targetCardRef: "dark" });
    act(1, { type: "attack.resolve", attackId: room.state.attack!.id, outcome: "resolved" });
    act(1, { type: "twin.remove", seat: 1, cardRef: "dark" });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
    expect(room.events.filter(e => !e.id.startsWith("sys:")).every(e => e.userId === users[0] && e.action.type !== "table.created")).toBe(true);
    expect(room.events.some(e => e.actorSeat === 1 && e.userId === users[0])).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects forged actors and keeps normal twin ownership, idempotency and undo rules", () => {
    const { service, users } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 3, solo: true }, 2000);
    service.ready(room.slug, "g", users[0], true, 2001);
    room = service.start(room.slug, "g", users[0], 2002);
    const command = { type: "twin.place" as const, actorSeat: 1, idempotencyKey: "bot-place", seat: 1, zone: "monster", card: { ref: "bot", faceUp: true, position: "attack" as const } };
    expect(() => service.act(room.slug, "g", users[1], { baseSeq: room.lastSeq, action: command }, 2100)).toThrow(/not found/i);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 3 } }, 2100)).toThrow(/seat/i);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 0 } }, 2100)).toThrow(/owner/i);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: command }, 2100);
    expect(service.act(room.slug, "g", users[0], { baseSeq: 0, action: command }, 2200).lastSeq).toBe(room.lastSeq);
    expect(() => service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { ...command, actorSeat: 2 } }, 2200)).toThrow(/different action/i);
    const before = room;
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: "owner-out" } }, 2300);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "turn.end", actorSeat: 1, idempotencyKey: "bot-turn" } }, 2400);
    expect(room.state.turnSeat).toBe(1);
    expect(before.state.seats[0].eliminated).toBe(false);
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
  });

  it("migrates existing remote rows additively and reruns without changing data", () => {
    const { service, table, users, db } = setup();
    // Recreate the exact pre-solo state: no new column or bot storage.
    db.exec("drop table remote_bot_seats; alter table remote_tables drop column solo");
    migrate(db); migrate(db);
    const existing = service.get(table.slug, "g", users[0]);
    expect(existing.solo).toBe(false);
    expect(existing.seats).toHaveLength(1);
    expect(existing.seats[0]).toMatchObject({ bot: false, userId: users[0] });
    expect(existing.events).toEqual(table.events);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("lets the owner undo a game-winning bot concession without impersonating a user", () => {
    const { service, users } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 2, solo: true }, 2000);
    service.ready(room.slug, "g", users[0], true, 2000); room = service.start(room.slug, "g", users[0], 2000);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 1, idempotencyKey: "bot-loses" } }, 2100);
    expect(room.status).toBe("ended"); expect(room.state.winnerSeat).toBe(0);
    room = service.act(room.slug, "g", users[0], { baseSeq: room.lastSeq, action: { type: "undo", actorSeat: 1, idempotencyKey: "undo-bot-loss", targetActionId: "bot-loses" } }, 7100);
    expect(room.status).toBe("active"); expect(room.state.seats[1].eliminated).toBe(false);
    expect(room.events.at(-1)).toMatchObject({ userId: users[0], actorSeat: 1 });
    expect(service.replay(room.slug, "g", users[0])).toEqual(room.state);
  });

  it("warns and expires solo lobbies and games with the same idle clock", () => {
    const { service, users } = setup();
    const create = () => service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount: 2, solo: true }, 2000);
    const lobby = create(); let active = create();
    service.ready(active.slug, "g", users[0], true, 2000); active = service.start(active.slug, "g", users[0], 2000);
    expect(service.sweepIdle(2000 + 8 * 60_000).filter(t => t.solo)).toHaveLength(2);
    expect(service.get(active.slug, "g", users[0]).lastEventAt).toBe(2000);
    expect(service.sweepIdle(2000 + 10 * 60_000).filter(t => t.solo && t.status === "ended")).toHaveLength(2);
    expect(() => service.ready(lobby.slug, "g", users[0], true, 602001)).toThrow(/ended/i);
    expect(() => service.act(active.slug, "g", users[0], { baseSeq: service.get(active.slug, "g", users[0]).lastSeq,
      action: { type: "log.note", actorSeat: 1, idempotencyKey: "late", text: "Too late" } }, 602001)).toThrow(/active/i);
  });
});
describe("remote foundation", () => {
  it("validates the action bus and keeps the reducer pure with FFA battle/turn rules", () => {
    expect(remoteActionSchema.safeParse({ type: "lp.change", actorSeat: 0, idempotencyKey: "bad", seat: 9, delta: -1, reason: "damage" }).success).toBe(false);
    const initial = ygoModule.initialState({ seatCount: 3 });
    expect(initial.seats.map(s => s.resources.lp)).toEqual([8000, 8000, 8000]);
    expect(() => ygoModule.reduce(initial, { type: "phase.set", actorSeat: 1, idempotencyKey: "no", phase: "main1", at: 1000 })).toThrow(/turn/i);
    const proposal: ReturnType<GameModule["parseCommand"]> = { type: "phase.set", actorSeat: 0, phase: "battle" };
    expect(() => ygoModule.reduce(initial, { ...proposal, idempotencyKey: "no-battle", at: 1000 })).toThrow(/battle/i);
    let state = initial;
    for (const seat of [0, 1]) state = ygoModule.reduce(state, { type: "turn.end", actorSeat: seat, idempotencyKey: `turn-${seat}`, at: 1000 });
    state = ygoModule.reduce(state, { type: "phase.set", actorSeat: 2, idempotencyKey: "battle", phase: "battle", at: 1000 });
    expect(state.turnSeat).toBe(2); expect(state.phase).toBe("battle"); expect(initial.turn).toBe(1);
    const hit = ygoModule.reduce(state, { type: "lp.change", actorSeat: 1, idempotencyKey: "hit", seat: 0, delta: -9000, reason: "damage", at: 2000 });
    expect(hit.seats[0].eliminated).toBe(true);
    expect(ygoModule.reduce(hit, { type: "undo", actorSeat: 0, idempotencyKey: "undo", targetActionId: "hit", at: 7000 }).seats[0].resources.lp).toBe(8000);
    expect(() => ygoModule.reduce(hit, { type: "undo", actorSeat: 0, idempotencyKey: "late", targetActionId: "hit", at: 7001 })).toThrow(/undo/i);
  });
  it("scopes admission, starts a ready table, deduplicates retries and replays events", () => {
    const { service, table, users, db } = setup();
    expect(() => service.get(table.slug, "other", users[0])).toThrow(/not found/i);
    expect(() => service.get(table.slug, "g", users[3])).toThrow(/not found/i);
    service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    service.join(table.slug, "g", users[2], "C", 2, 1200);
    registerTestDeck(db, service, table.slug, users[2], 1200);
    for (const user of users.slice(0, 3)) service.ready(table.slug, "g", user, true, 1300);
    let room = service.start(table.slug, "g", users[0], 1400);
    const command = { type: "lp.change" as const, actorSeat: 0, idempotencyKey: "hit", seat: 1, delta: -500, reason: "effect" };
    room = service.act(table.slug, "g", users[0], { baseSeq: room.lastSeq, action: command }, 2000);
    expect(room.state.seats[1].resources.lp).toBe(7500);
    const retry = service.act(table.slug, "g", users[0], { baseSeq: 0, action: command }, 3000);
    expect(retry.lastSeq).toBe(room.lastSeq);
    expect(() => service.act(table.slug, "g", users[1], { baseSeq: room.lastSeq, action: { ...command, idempotencyKey: "spoof" } }, 3000)).toThrow(/seat/i);
    expect(() => service.act(table.slug, "g", users[0], { baseSeq: 0, action: { ...command, idempotencyKey: "stale" } }, 3000)).toThrow(/sequence/i);
    expect(service.replay(table.slug, "g", users[0])).toEqual(room.state);
    expect((db.prepare("select count(*) as n from remote_events where idempotency_key='hit'").get() as { n: number }).n).toBe(1);
    expect(() => db.prepare("delete from remote_events").run()).toThrow(/append.only/i);
  });
  it("warns at eight minutes and closes at ten without warning renewing activity", () => {
    const { service, table, users, db } = setup();
    expect(service.sweepIdle(1000 + 8 * 60_000 - 1)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 8 * 60_000)).toHaveLength(1);
    expect(service.get(table.slug, "g", users[0]).lastEventAt).toBe(1000);
    expect(service.sweepIdle(1000 + 9 * 60_000)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 10 * 60_000)[0].status).toBe("ended");
  });
  it("keeps a table open while a seated player reports activity, and refuses others and ended tables", () => {
    const { service, table, users } = setup();
    expect(service.sweepIdle(1000 + 8 * 60_000)).toHaveLength(1);
    const seq = service.get(table.slug, "g", users[0]).lastSeq;
    service.touch(table.slug, "g", users[0], 1000 + 9 * 60_000);
    const room = service.get(table.slug, "g", users[0]);
    expect(room.lastEventAt).toBe(1000 + 9 * 60_000); expect(room.idleWarningAt).toBeNull(); expect(room.lastSeq).toBe(seq);
    expect(service.sweepIdle(1000 + 10 * 60_000)).toHaveLength(0);
    expect(service.sweepIdle(1000 + 19 * 60_000)[0].status).toBe("ended");
    expect(() => service.touch(table.slug, "g", users[0], 1000 + 19 * 60_000 + 1)).toThrow(/ended/i);
  });
});

describe("remote board and transactional edge cases", () => {
  it("supports all twin, identification and attack actions without inferring battle damage", () => {
    let state = ygoModule.initialState({ seatCount: 2 }); let n = 0;
    const act = (action: Record<string, unknown>, actorSeat = 0) => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `a${++n}`, at: n * 100 }));
    };
    act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", cardId: 89631139 } });
    act({ type: "twin.flip", seat: 0, cardRef: "blue", faceUp: false });
    expect(state.seats[0].twin[0].faceUp).toBe(false);
    act({ type: "twin.move", seat: 0, cardRef: "blue", zone: "graveyard" });
    expect(state.seats[0].twin[0].zone).toBe("graveyard");
    expect(() => ygoModule.reduce(state, { type: "twin.remove", seat: 0, actorSeat: 1, cardRef: "blue", idempotencyKey: "theft" })).toThrow(/owner/);
    act({ type: "card.identified", seat: 1, passcode: 46986414, source: "auto" });
    expect(state.identified?.passcode).toBe(46986414);
    act({ type: "turn.end" });
    act({ type: "phase.set", phase: "battle" }, 1);
    act({ type: "attack.declare", attackerSeat: 1, targetSeat: 0, direct: true }, 1);
    const attackId = state.attack!.id;
    act({ type: "attack.resolve", attackId, outcome: "resolved" });
    expect(state.attack).toBeNull(); expect(state.seats[0].resources.lp).toBe(8000);
    act({ type: "twin.remove", seat: 0, cardRef: "blue" });
    act({ type: "log.note", text: "Agreed correction" });
    expect(state.seats[0].twin).toEqual([]);
  });
  it("skips opening Battle phases, preserves fixed FFA seats and skips eliminated future turns", () => {
    let state = ygoModule.initialState({ seatCount: 4 });
    for (let i = 0; i < 3; i++) {
      state = ygoModule.reduce(state, { type: "phase.advance", actorSeat: 0, idempotencyKey: `p${i}` });
    }
    expect(state.phase).toBe("main2");
    state = ygoModule.reduce(state, { type: "player.concede", actorSeat: 1, idempotencyKey: "leave" });
    state = ygoModule.reduce(state, { type: "turn.end", actorSeat: 0, idempotencyKey: "next" });
    expect(state.turnSeat).toBe(2);
    state = ygoModule.reduce(state, { type: "turn.end", actorSeat: 2, idempotencyKey: "next2" });
    state = ygoModule.reduce(state, { type: "phase.set", actorSeat: 3, idempotencyKey: "battle", phase: "battle" });
    expect(state.seats.map(s => s.seat)).toEqual([0, 1, 2, 3]); expect(state.phase).toBe("battle");
  });
  it("guards readiness, occupied seats and key reuse, and allows a five-second undo of a winning action", () => {
    const { service, table, users, db } = setup();
    expect(() => service.start(table.slug, "g", users[0], 1100)).toThrow(/ready/);
    service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    expect(() => service.join(table.slug, "g", users[2], "C", 1, 1100)).toThrow(/seat/i);
    service.join(table.slug, "g", users[2], "C", 2, 1100);
    registerTestDeck(db, service, table.slug, users[2], 1100);
    users.slice(0, 3).forEach(user => service.ready(table.slug, "g", user, true, 1200));
    let room = service.start(table.slug, "g", users[0], 1300);
    for (const seat of [1, 2]) room = service.act(table.slug, "g", users[seat], { baseSeq: room.lastSeq,
      action: { type: "player.concede", actorSeat: seat, idempotencyKey: `concede${seat}`, at: 1 } }, 2000 + seat);
    expect(room.status).toBe("ended"); expect(room.state.winnerSeat).toBe(0);
    expect(room.state.updatedAt).toBe(2002);
    room = service.act(table.slug, "g", users[2], { baseSeq: room.lastSeq,
      action: { type: "undo", actorSeat: 2, idempotencyKey: "undo-win", targetActionId: "concede2" } }, 3000);
    expect(room.status).toBe("active");
    expect(() => service.act(table.slug, "g", users[2], { baseSeq: room.lastSeq,
      action: { type: "log.note", actorSeat: 2, idempotencyKey: "undo-win", text: "different" } }, 3001)).toThrow(/different action/);
    expect(service.replay(table.slug, "g", users[2])).toEqual(room.state);
  });
});

import { canReadRemote } from "../../src/services/remote-access.js";
it("revokes departed seat tokens and keeps the final game snapshot readable to stored members", () => {
  const { service, table, users, db } = setup();
  const claims = { slug: table.slug, guildId: "g", userId: users[1], seat: 1, expiresAt: 999999 };
  expect(canReadRemote(db, claims)).toBe(false);
  service.join(table.slug, "g", users[1], "B", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
  expect(canReadRemote(db, claims)).toBe(true);
  expect(canReadRemote(db, { ...claims, guildId: "other" })).toBe(false);
  expect(canReadRemote(db, { ...claims, seat: 2 })).toBe(false);
  service.leave(table.slug, "g", users[1], 1200);
  expect(canReadRemote(db, claims)).toBe(false);
  service.join(table.slug, "g", users[2], "C", 1, 1300);
  registerTestDeck(db, service, table.slug, users[2], 1300);
  expect(canReadRemote(db, claims)).toBe(false);
  const final = service.leave(table.slug, "g", users[0], 1400);
  expect(final.status).toBe("ended");
  expect(canReadRemote(db, { ...claims, userId: users[0], seat: 0 })).toBe(true);
  expect(service.snapshot(table.slug, "g").table.status).toBe("ended");
});

describe("tolerant voice attack resolution", () => {
  const players = [
    { seat: 0, displayName: "Alex", nicknames: ["Al"] },
    { seat: 1, displayName: "Imran Khan", nicknames: ["Immy"] },
    { seat: 2, displayName: "Sara", nicknames: ["Saz"] },
  ];
  function board(seatCount: 2 | 3 | 4 = 2) {
    let state = ygoModule.initialState({ seatCount });
    let seq = 0;
    const place = (seat: number, card: Record<string, unknown>, zone = "monster") => {
      state = ygoModule.reduce(state, remoteActionSchema.parse({
        type: "twin.place", actorSeat: seat, seat, zone, card,
        idempotencyKey: `voice-${++seq}`,
      }));
    };
    place(0, { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1, cardId: 89631139 });
    place(1, { ref: "dark", name: "Dark Magician", race: "Spellcaster", slot: 3, cardId: 46986414 });
    return { get state() { return state; }, place };
  }
  const resolve = (state: ReturnType<typeof ygoModule.initialState>, text: string, actorSeat = 0) =>
    ygoModule.resolveAttack(state, { text, players }, actorSeat);

  it.each([
    "Blue Eyes attacks the magician",
    "my dragon attacks his monster",
    "my dragon attacks her monster",
    "my dragon attacks their monster",
    "blew eyes attacks dark magishun",
    "Blue Ice attacks Dark Magician",
    "Blue Eyex attacks Dark Magiciat",
    "Bule Eyes attacks the magican",
    "my drag attacks the mag",
  ])("proposes one matching field pair for '%s'", text => {
    const b = board();
    const before = structuredClone(b.state);
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposal).toEqual({
      type: "attack.declare", actorSeat: 0, attackerSeat: 0, attackerCardRef: "blue", targetSeat: 1, targetCardRef: "dark",
    });
    expect(result.candidates[0].score).toBeGreaterThan(0);
    expect(result.candidates[0].score).toBeLessThanOrEqual(1);
    expect(b.state).toEqual(before);
    expect(resolve(b.state, text)).toEqual(result);
  });

  it.each(["attack Imran's dragon", "attack Immy’s dragon", "attack Imran Khan's dragon"])("scopes '%s' by current player names/nicknames", text => {
    const b = board(3);
    b.place(1, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ targetSeat: 1, targetCardRef: "red" });
  });

  it("matches race words even when absent from the printed card name", () => {
    const b = board();
    b.place(0, { ref: "buster", name: "Buster Blader", race: "Warrior", slot: 5 });
    const result = resolve(b.state, "my warrior attacks his spellcaster");
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "buster", targetCardRef: "dark" });
  });

  it("returns all fitting pairs ranked for quick pick instead of silently selecting the highest score", () => {
    const b = board();
    b.place(0, { ref: "dragonling", name: "Dragonling", race: "Dragon", slot: 5 });
    b.place(1, { ref: "magician-girl", name: "Dark Magician Girl", race: "Spellcaster", slot: 5 });
    const result = resolve(b.state, "my dragon attacks Dark Magician");
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[0].proposal.targetCardRef).toBe("dark");
    expect(result.candidates.map(c => c.score)).toEqual(result.candidates.map(c => c.score).sort((a, b) => b - a));
    expect(new Set(result.candidates.map(c => `${c.proposal.attackerCardRef}/${c.proposal.targetCardRef}`)).size).toBe(4);
  });

  it.each([
    ["my left monster attacks the middle monster", "blue", "dark"],
    ["my right dragon attacks the right monster", "red", "girl"],
    ["my zone 1 attacks zone 3", "blue", "dark"],
    ["my zone five attacks zone five", "red", "girl"],
  ])("uses fixed owner-view field positions in '%s'", (text, attackerCardRef, targetCardRef) => {
    const b = board();
    b.place(0, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    b.place(1, { ref: "girl", name: "Dark Magician Girl", race: "Spellcaster", slot: 5 });
    const result = resolve(b.state, text);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef, targetCardRef });
  });

  it("accepts parsed hints and keeps explicit refs/seat/slot constraints conjunctive", () => {
    const b = board(3);
    b.place(1, { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 });
    const result = ygoModule.resolveAttack(b.state, {
      attacker: { cardRef: "blue" }, target: { text: "dragon", slot: 5 }, targetSeat: 1,
    }, 0);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "blue", targetCardRef: "red", targetSeat: 1 });
    expect(ygoModule.resolveAttack(b.state, { attacker: { cardRef: "blue", slot: 5 }, targetSeat: 1 }, 0).status).toBe("none");
    expect(ygoModule.resolveAttack(b.state, { targetSeat: 2, targetPlayer: "Imran", players }, 0).status).toBe("none");
  });

  it.each([1, 2, 3, 4, 5])("resolves zone %i without depending on twin array order", slot => {
    const b = board();
    b.place(1, { ref: `slot-${slot}`, slot });
    const state = structuredClone(b.state);
    state.seats[1].twin.reverse();
    const result = resolve(state, `my dragon attacks zone ${slot}`);
    expect(result.candidates.some(c => c.proposal.targetCardRef === `slot-${slot}`)).toBe(true);
    expect(result.status).toBe(slot === 3 ? "ambiguous" : "unique");
  });

  it("keeps legacy twins useful without catalog metadata and exposes the registry hook", () => {
    const state = ygoModule.initialState({ seatCount: 2 });
    state.seats[0].twin.push({ ref: "old-own", zone: "monster", cardId: 89631139, faceUp: true, position: "attack" });
    state.seats[1].twin.push({ ref: "old-other", zone: "monster", faceUp: false, position: "defense" });
    expect(getRemoteGame("ygo").resolveAttack).toBe(resolveAttack);
    expect(resolveAttack(state, "my monster attacks their monster", 0).status).toBe("unique");
    expect(resolveAttack(state, "Blue Eyes attacks their monster", 0).status).toBe("none");
    expect(resolveAttack(state, "my monster attacks the left monster", 0).status).toBe("none");
  });

  it("bounds public metadata at the shared action boundary", () => {
    const place = (card: Record<string, unknown>) => remoteActionSchema.safeParse({
      type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", idempotencyKey: "metadata", card: { ref: "bounded", ...card },
    }).success;
    for (const slot of [0, 6, 1.5, Number.NaN]) expect(place({ slot })).toBe(false);
    expect(place({ name: " " })).toBe(false);
    expect(place({ name: "x".repeat(201) })).toBe(false);
    expect(place({ race: "x".repeat(41) })).toBe(false);
    expect(place({ name: "Blue-Eyes White Dragon", race: "Dragon", slot: 5 })).toBe(true);
  });

  it("keeps unnamed FFA opponents and duplicate nicknames ambiguous", () => {
    const b = board(3);
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    expect(resolve(b.state, "my dragon attacks his monster").candidates.map(c => c.proposal.targetSeat)).toEqual([1, 2]);
    const result = ygoModule.resolveAttack(b.state, {
      text: "my dragon attacks Sam's monster",
      players: [{ seat: 1, displayName: "Sam" }, { seat: 2, displayName: "Sara", nicknames: ["Sam"] }],
    }, 0);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    const reordered = structuredClone(b.state);
    reordered.seats.reverse();
    for (const seat of reordered.seats) seat.twin.reverse();
    expect(resolve(reordered, "my dragon attacks their monster")).toEqual(resolve(b.state, "my dragon attacks their monster"));
  });

  it("keeps player names that overlap card words from consuming card references", () => {
    const b = board(3);
    const result = ygoModule.resolveAttack(b.state, {
      text: "Blue Eyes attacks Dark Magician",
      players: [{ seat: 0, displayName: "Blue" }, { seat: 2, displayName: "Dark" }],
    }, 0);
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "blue", targetCardRef: "dark", targetSeat: 1 });
  });

  it.each([
    { text: "my dragon attacks my monster", target: { text: "his monster" } },
    { text: "my dragon attacks zone 1", target: { text: "zone 3" } },
    { text: "my dragon attacks Sara's monster", target: { text: "" } },
    { text: "my unicorn attacks his monster", attacker: { text: "dragon" } },
  ])("keeps raw utterance and parsed constraints conjunctive: %j", hints => {
    expect(ygoModule.resolveAttack(board(3).state, { ...hints, players }, 0).status).toBe("none");
  });

  it.each([
    "my unicorn attacks his monster",
    "my dragon attacks Nobody's monster",
    "my dragon attacks my monster",
    "Imran's monster attacks my dragon",
    "my dragon attacks zone 6",
    "my dragon attacks zone 0",
    "my dragon attacks the left middle monster",
    "hello there",
    "",
  ])("returns none for incompatible or missing intent '%s'", text => {
    expect(resolve(board().state, text)).toEqual({ status: "none", candidates: [] });
  });

  it("ignores off-field/non-monster cards and does not infer direct attacks from missing twins", () => {
    const b = board();
    b.place(0, { ref: "dead-blue", name: "Blue-Eyes White Dragon", race: "Dragon" }, "graveyard");
    b.place(1, { ref: "banished-dark", name: "Dark Magician", race: "Spellcaster" }, "banished");
    b.place(1, { ref: "spell-dark", name: "Dark Magician", race: "Spellcaster" }, "spell-trap");
    expect(resolve(b.state, "Blue Eyes attacks the magician").candidates).toHaveLength(1);
    const empty = structuredClone(b.state);
    empty.seats[1].twin = [];
    expect(resolve(empty, "my dragon attacks his monster").status).toBe("none");
  });

  it("can identify extra-monster and unnamed face-down twins by public slot without reading hidden metadata", () => {
    const b = board();
    b.place(0, { ref: "extra", name: "Stardust Dragon", race: "Dragon", slot: 2 }, "extra-monster");
    b.place(1, { ref: "set", faceUp: false, slot: 1 });
    const result = resolve(b.state, "my extra monster on the right attacks his left monster");
    expect(result.status).toBe("unique");
    expect(result.candidates[0].proposal).toMatchObject({ attackerCardRef: "extra", targetCardRef: "set" });
    const hidden = structuredClone(b.state);
    hidden.seats[1].twin.find(c => c.ref === "set")!.name = "Secret Unicorn";
    expect(resolve(hidden, "my dragon attacks unicorn").status).toBe("none");
  });

  it("supports raw strings, nonzero actor seats and explicit direct proposals", () => {
    const b = board();
    const raw = ygoModule.resolveAttack(b.state, "my magician attacks his dragon", 1);
    expect(raw.status).toBe("unique");
    expect(raw.candidates[0].proposal).toMatchObject({ actorSeat: 1, attackerSeat: 1, attackerCardRef: "dark", targetSeat: 0, targetCardRef: "blue" });
    const direct = resolve(b.state, "my dragon attacks Imran directly");
    expect(direct.status).toBe("unique");
    expect(direct.candidates[0].proposal).toEqual({ type: "attack.declare", actorSeat: 0, attackerSeat: 0, attackerCardRef: "blue", targetSeat: 1, direct: true });
  });

  it("excludes eliminated/self seats and unavailable actors", () => {
    const b = board(3);
    b.place(2, { ref: "sara-dragon", name: "Stardust Dragon", race: "Dragon", slot: 1 });
    const state = structuredClone(b.state);
    state.seats[1].eliminated = true;
    expect(resolve(state, "my dragon attacks his monster").candidates.map(c => c.proposal.targetSeat)).toEqual([2]);
    expect(resolve(state, "attack Imran's monster").status).toBe("none");
    expect(resolve(state, "attack Alex's monster").status).toBe("none");
    expect(resolve(state, "attack his monster", 1).status).toBe("none");
    expect(resolve(state, "attack his monster", 9).status).toBe("none");
    state.ended = true;
    expect(resolve(state, "attack his monster").status).toBe("none");
  });

  it("preserves slot metadata on same-zone moves and clears stale positions on cross-zone moves", () => {
    const b = board();
    const move = (state: typeof b.state, zone: string, slot?: number) => ygoModule.reduce(state, remoteActionSchema.parse({
      type: "twin.move", actorSeat: 0, seat: 0, cardRef: "blue", zone, slot, idempotencyKey: `move-${zone}`,
    }));
    const repositioned = move(b.state, "monster", 5);
    expect(repositioned.seats[0].twin[0].slot).toBe(5);
    expect(move(repositioned, "monster").seats[0].twin[0].slot).toBe(5);
    expect(move(repositioned, "graveyard").seats[0].twin[0].slot).toBeUndefined();
  });

  it("persists public annotations and replays a confirmed proposal through the normal event store", () => {
    const { service, table, users, db } = setup();
    service.join(table.slug, "g", users[1], "Imran", 1, 1100);
    registerTestDeck(db, service, table.slug, users[1], 1100);
    service.join(table.slug, "g", users[2], "Sara", 2, 1100);
    registerTestDeck(db, service, table.slug, users[2], 1100);
    users.slice(0, 3).forEach(user => service.ready(table.slug, "g", user, true, 1200));
    let room = service.start(table.slug, "g", users[0], 1300);
    let seq = 0;
    const act = (actorSeat: number, action: Record<string, unknown>) => {
      room = service.act(table.slug, "g", users[actorSeat], { baseSeq: room.lastSeq,
        action: remoteActionSchema.parse({ ...action, actorSeat, idempotencyKey: `confirmed-${++seq}` }) }, 1300 + seq);
    };
    act(0, { type: "twin.place", seat: 0, zone: "monster", card: { ref: "blue", name: "Blue-Eyes White Dragon", race: "Dragon", slot: 1 } });
    act(1, { type: "twin.place", seat: 1, zone: "monster", card: { ref: "red", name: "Red-Eyes Black Dragon", race: "Dragon", slot: 5 } });
    act(0, { type: "turn.end" }); act(1, { type: "turn.end" }); act(2, { type: "turn.end" });
    act(0, { type: "phase.set", phase: "battle" });
    const before = service.get(table.slug, "g", users[0]);
    const result = ygoModule.resolveAttack(before.state, { text: "attack Imran's dragon", players: before.seats }, before.mySeat);
    expect(result.status).toBe("unique");
    expect(service.get(table.slug, "g", users[0])).toEqual(before);
    act(0, result.candidates[0].proposal);
    expect(room.state.attack).toMatchObject({ attackerCardRef: "blue", targetCardRef: "red", targetSeat: 1 });
    expect(service.replay(table.slug, "g", users[0])).toEqual(room.state);
    expect(room.events.some(e => JSON.stringify(e).includes("attack Imran"))).toBe(false);
  });
});

const originDeck = [80101899, 70825459, 23898021, 73628505, 32807846, 53582587, 53582587,
  37576645, 37576645, 10045474, 97077563, 5318639, 14087893, 47355498, 67616300, 2460565, 63977008, 89631133,
  46986414, 46986414, 46986414, 71413901, 71413901, 71413901, 73752131, 73752131, 73752131, 9156135, 9156135, 9156135, 45141844, 45141844, 45141844, 97268402, 97268402, 97268402, 31560081, 31560081, 423585, 423585];
function originSession(showCardsSetFromDeck = false) {
  const s = deckSession("normal");
  if (!showCardsSetFromDeck) s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:false},2000);
  s.select(s.save(originDeck).id); s.start(); return s;
}
const originOf = (s: ReturnType<typeof originSession>) => s.room.state.effectTracking!.origins.at(-1)!;
describe("remote effect origins and hidden information", () => {
  it.each(["set-private","set-camera","hand-private","hand-announced","extra"])("preserves old private-event semantics across migration and replay (%s)", mode => {
    const hand=mode.startsWith("hand");
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:hand ? 73628505 : 70825459}});
    if(!hand) s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"legacy-set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:hand ? 47355498 : 53582587});
    if(mode==="set-camera") s.act({type:"card.identified",seat:0,cardRef:"legacy-set",cardId:53582587,source:"auto"});
    if(mode==="hand-announced") s.act({type:"effect.announce",originId:originOf(s).id});
    // Copy a pre-option fixture, leaving the original append-only events untouched.
    const legacyState=structuredClone(s.room.state);
    if(mode==="hand-announced") {
      // Original announcements exposed announcedCard, but did not mark/observe the private hand twin.
      delete legacyState.seats[0].twin[0].publicIdentity;
      legacyState.deckChecks.instances=[];
      const origin=legacyState.effectTracking!.origins[0]; delete origin.revealedCardId;
      origin.candidates=structuredClone(origin.pool);
    }
    if(mode==="extra") {
      s.act({type:"twin.place",seat:0,zone:"extra",card:{ref:"legacy-extra",cardId:5318639,name:"Mystical Space Typhoon"}});
      Object.assign(legacyState,structuredClone(s.room.state));
      // The old reducer marked extra instances public internally; projections still hid the Extra Deck.
      const extra=legacyState.deckChecks.instances.find(i=>i.refs.includes("legacy-extra"))!;
      extra.public=true; extra.anchored=true;
    }
    delete legacyState.showCardsSetFromDeck;
    if(legacyState.undo) delete legacyState.undo.before.showCardsSetFromDeck;
    const oldId=(s.db.prepare("select id from remote_tables where slug=?").get(s.room.slug) as {id:number}).id;
    const id=s.db.prepare("insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,last_seq,created_at,last_event_at,solo,format_json) select 'legacy','g',game_id,seat_count,status,created_by,?,last_seq,created_at,last_event_at,solo,format_json from remote_tables where id=?")
      .run(JSON.stringify(legacyState),oldId).lastInsertRowid;
    for(const table of ["remote_seats","remote_bot_seats"]) {
      const columns=table==="remote_seats" ? "seat,user_id,display_name,ready,saved_deck_id,deck_json" : "seat,display_name,saved_deck_id,deck_json";
      s.db.prepare(`insert into ${table}(table_id,${columns}) select ?,${columns} from ${table} where table_id=?`).run(id,oldId);
    }
    const rows=s.db.prepare("select * from remote_events where table_id=? order by seq").all(oldId) as {seq:number;idempotency_key:string;actor_seat:number;user_id:number;action_json:string;created_at:number;effects_json:string|null;messages_json:string|null}[];
    for(const row of rows) {
      const action=JSON.parse(row.action_json); delete action.showCardsSetFromDeck;
      const effects=row.effects_json ? JSON.parse(row.effects_json) : null;
      if(effects) {delete effects.showCardsSetFromDeck;delete effects.publicEffectChoice;}
      s.db.prepare("insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at,effects_json,messages_json) values(?,?,?,?,?,?,?,?,?)")
        .run(id,row.seq,row.idempotency_key,row.actor_seat,row.user_id,JSON.stringify(action),row.created_at,effects ? JSON.stringify(effects) : null,row.messages_json);
    }
    const cached=s.service.get("legacy","g",s.users[0]);
    expect(cached.showCardsSetFromDeck).toBe(true);
    expect(s.service.replay("legacy","g",s.users[0])).toEqual(cached.state);
    s.service.act("legacy","g",s.users[0],{baseSeq:cached.lastSeq,action:{type:"lp.change",actorSeat:0,seat:0,delta:-100,reason:"effect",idempotencyKey:"after-upgrade"}},2300);
    const publicView=s.service.snapshot("legacy","g");
    expect(publicView.state.seats[0].twin[0].cardId).toBe(mode==="set-camera" ? 53582587 : undefined);
    expect(s.service.replay("legacy","g",s.users[0])).toEqual(s.service.get("legacy","g",s.users[0]).state);
  });
  it("keeps Extra Deck placements and returns private even when their faceUp flag is true", () => {
    const s=originSession(true);
    s.act({type:"twin.place",seat:0,zone:"extra",card:{ref:"extra-secret",cardId:5318639,name:"Mystical Space Typhoon"}});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBeUndefined();
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"return",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    s.act({type:"twin.flip",seat:0,cardRef:"return",faceUp:true});
    s.act({type:"twin.move",seat:0,cardRef:"return",zone:"extra"});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin.find(c=>c.ref==="return")?.cardId).toBeUndefined();
  });
  it("publishes a default-table Set choice without flipping it or sharing the other candidates", () => {
    const s=originSession(true); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"public-set",faceUp:false,slot:1}});
    const origin=originOf(s);
    s.act({type:"effect.choose",originId:origin.id,cardId:53582587});
    for(const view of [s.service.snapshot(s.room.slug,"g").state,s.service.replay(s.room.slug,"g",s.users[0])]) {
      expect(view.seats[0].twin[0]).toMatchObject({cardId:53582587,name:"Torrential Tribute",faceUp:false,publicIdentity:true,setBy:{name:"Trap Tracks"}});
      expect(view.effectTracking!.origins[0].announcedCard).toEqual({cardId:53582587,name:"Torrential Tribute"});
    }
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.events.at(-1)?.action).toMatchObject({type:"effect.choose",cardId:53582587});
    for(const key of ['"pool"','"candidates"','"eligibleIds"','"chosenCardId"','"savedDeckId"','"facts"','"minimumCopies"']) expect(JSON.stringify(publicView)).not.toContain(key);
    expect(JSON.stringify(publicView)).not.toContain("Reckless Greed");
    const chooseId=s.room.state.undo!.actionId;
    s.act({type:"undo",targetActionId:chooseId});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBeUndefined();
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("applies Deck publicity %s to search-to-hand choices", show => {
    const s=originSession(show); s.act({type:"effect.activated",source:{cardId:73628505}});
    const origin=originOf(s); s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.effectTracking!.origins[0].announcedCard?.cardId).toBe(show ? 47355498 : undefined);
    expect(publicView.state.seats[0].twin[0].cardId).toBe(show ? 47355498 : undefined);
    expect(publicView.state.effectTracking!.origins[0].candidates).toBeUndefined();
    expect(JSON.stringify(publicView)).not.toContain("Chicken Game");
    if(!show) {
      expect(JSON.stringify(publicView)).not.toContain("Necrovalley");
      s.act({type:"effect.announce",originId:origin.id});
      expect(s.service.snapshot(s.room.slug,"g").state.effectTracking!.origins[0].announcedCard?.cardId).toBe(47355498);
    }
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("handles shown Set camera reads with publicity %s and soft off-candidate notes", show => {
    const s=originSession(show); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"shown",faceUp:false}});
    s.act({type:"card.identified",seat:0,cardRef:"shown",cardId:5318639,source:"auto"});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0]).toMatchObject({cardId:5318639,name:"Mystical Space Typhoon",faceUp:!show});
    expect(publicView.state.effectTracking!.notes[0].message).toBe("Mystical Space Typhoon could not be Set by Trap Tracks");
    expect(publicView.state.ended).toBe(false);
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it("publishes a camera-read searched card on a public table and validates the original candidates", () => {
    const s=originSession(true); s.act({type:"effect.activated",source:{cardId:73628505}});
    const origin=originOf(s);
    s.act({type:"twin.place",seat:0,zone:"hand",card:{ref:origin.ref,faceUp:false}});
    s.act({type:"card.identified",seat:0,cardRef:origin.ref,cardId:5318639,source:"auto"});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0]).toMatchObject({cardId:5318639,faceUp:false,publicIdentity:true});
    expect(publicView.state.effectTracking!.origins[0].announcedCard?.cardId).toBe(5318639);
    expect(publicView.state.effectTracking!.notes[0].message).toBe("Mystical Space Typhoon could not be added to hand by Terraforming");
    expect(publicView.events.at(-1)?.action.type).toBe("card.identified");
    expect(JSON.stringify(publicView)).not.toContain("Chicken Game");
  });
  it("subtracts known face-down Sets from future candidates and keeps ordinary hidden placements private", () => {
    const s=originSession(true);
    for(const ref of ["set-a","set-b"]) {
      s.act({type:"effect.activated",source:{cardId:70825459}});
      s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref,faceUp:false,slot:ref==="set-a" ? 1 : 2}});
      s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    }
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set-c",faceUp:false,slot:3}});
    expect(originOf(s).candidates!.some(c=>c.cardId===53582587)).toBe(false);
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"ordinary",faceUp:false,slot:4,cardId:37576645,name:"Reckless Greed"}});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin.find(c=>c.ref==="ordinary")?.cardId).toBeUndefined();
    expect(JSON.stringify(publicView)).not.toContain("Reckless Greed");
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([true,false])("preserves distinct same-name searched copies for depletion (publicity=%s)", show => {
    const s=deckSession("normal");
    s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:show},2000);
    s.select(s.save(originDeck.map(code=>code===67616300 ? 47355498 : code)).id); s.start();
    for(let i=0;i<2;i++) {
      s.act({type:"effect.activated",source:{cardId:73628505}});
      const origin=originOf(s); s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
      if(!show) s.act({type:"effect.announce",originId:origin.id});
    }
    expect(s.room.state.seats[0].twin.filter(c=>c.zone==="hand" && c.cardId===47355498)).toHaveLength(2);
    s.act({type:"effect.activated",source:{cardId:73628505}});
    expect(originOf(s).candidates).toEqual([]);
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([
    [70825459, [37576645, 53582587, 80101899, 10045474]],
    [23898021, [37576645, 53582587, 70825459, 80101899, 10045474]],
    [80101899, [37576645, 53582587]],
  ])("derives real Deck-to-Set filters for %s", (cardId, expected) => {
    const s = originSession(); s.act({ type: "effect.activated", source: { cardId } });
    s.act({type: "twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false,slot:1}});
    const origin = originOf(s);
    expect(origin.source.cardId).toBe(cardId);
    expect(origin.candidates!.map(c=>c.cardId).sort((a,b)=>a-b)).toEqual([...expected].sort((a,b)=>a-b));
    expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it.each([[73628505, [47355498,67616300]], [32807846, [2460565,63977008]]])("offers private search candidates for %s", (cardId, expected) => {
    const s=originSession(); s.act({type:"effect.activated",source:{cardId}});
    const origin=originOf(s); expect(origin.destination).toBe("hand"); expect(origin.announceRecommended).toBe(true);
    expect(origin.candidates!.map(c=>c.cardId).sort((a,b)=>a-b)).toEqual([...expected].sort((a,b)=>a-b));
    s.act({type:"effect.choose",originId:origin.id,cardId:expected[0]});
    expect(s.room.state.seats[0].twin.find(c=>c.ref===origin.ref)?.zone).toBe("hand");
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin.find(c=>c.ref===origin.ref)?.cardId).toBeUndefined();
    s.act({type:"effect.announce",originId:origin.id});
    expect(s.service.snapshot(s.room.slug,"g").state.effectTracking?.origins.at(-1)?.announcedCard?.cardId).toBe(expected[0]);
  });
  it("keeps decks, candidates, private picks, event effects and undo out of opponents and room broadcasts",()=>{
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    expect(s.room.state.seats[0].twin[0]).toMatchObject({cardId:53582587,faceUp:false});
    const publicView=s.service.snapshot(s.room.slug,"g");
    expect(publicView.state.seats[0].twin[0].cardId).toBeUndefined();
    expect(publicView.state.effectTracking?.origins.at(-1)).toMatchObject({source:{cardId:70825459}});
    const json=JSON.stringify(publicView);
    for(const key of ['"candidates"','"pool"','"chosenCardId"','"savedDeckId"','"facts"','"cardId":53582587']) expect(json).not.toContain(key);
    const own=s.service.snapshot(s.room.slug,"g",s.users[0]);
    expect(own.state.effectTracking?.origins.at(-1)?.candidates?.length).toBeGreaterThan(0);
    expect(s.service.list("g",s.users[0])[0].seats[0].deck?.savedDeckId).toBeUndefined();
  });
  it("reveals a private pick on flip and accepts out-of-filter recognition with a dismissible public note",()=>{
    const s=originSession(); s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
    s.act({type:"twin.flip",seat:0,cardRef:"set",faceUp:true});
    expect(s.service.snapshot(s.room.slug,"g").state.seats[0].twin[0].cardId).toBe(53582587);
    s.act({type:"card.identified",seat:0,cardRef:"set",cardId:5318639,source:"auto"});
    const note=s.room.state.effectTracking!.notes.at(-1)!;
    expect(note.message).toBe("Mystical Space Typhoon could not be Set by Trap Tracks");
    expect(s.service.snapshot(s.room.slug,"g").state.effectTracking?.notes.at(-1)?.message).toBe(note.message);
    s.act({type:"effect.note.dismiss",noteId:note.id}); expect(s.room.state.effectTracking!.notes.at(-1)?.dismissed).toBe(true);
    expect(s.room.state.ended).toBe(false); expect(s.service.replay(s.room.slug,"g",s.users[0])).toEqual(s.room.state);
  });
  it("subtracts public physical copies and expires contexts on a phase change",()=>{
    const s=originSession(); s.place("seen1","graveyard",1,53582587); s.place("seen2","spell-trap",2,53582587);
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false,slot:3}});
    expect(originOf(s).candidates!.some(c=>c.cardId===53582587)).toBe(false);
    s.act({type:"effect.activated",source:{cardId:70825459}}); s.act({type:"phase.set",phase:"main1"});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"manual",faceUp:false,slot:4}});
    expect(s.room.state.effectTracking!.origins.filter(o=>o.ref==="manual")).toEqual([]);
  });
  it("rejects another seat's private choice and resolves activate after identification",()=>{
    const s=originSession(); s.act({type:"card.identified",seat:0,cardId:70825459,source:"voice"});
    const command=ygoModule.parseCommand({text:"activate",actorSeat:0,state:s.room.state});
    expect(command).toMatchObject({type:"effect.activated",source:{cardId:70825459}});
    s.act(command!); s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
    expect(()=>s.act({type:"effect.choose",actorSeat:1,originId:originOf(s).id,cardId:53582587})).toThrow(/owner|controller/i);
  });
});

it("reuses indexed filters for add-then-Set and keeps compound races exact",async()=>{
  const {deriveRemoteEffectPlans}=await import("../../src/remote/effect-filters.js");
  const {CardTags,fillDefaults}=await import("../../src/cards/effects/tags.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:"Add 1 Level 4 or lower DARK Beast-Warrior monster from your Deck to your hand.",formats:[],views:0,url:""};
  const reading=deriveRemoteEffectPlans(source)[0];
  expect(reading.filters[0]).toMatchObject({types:["Beast-Warrior"],attributes:["DARK"],level_max:4});
  const tags=CardTags.parse(fillDefaults({summary:"Search and Set",effects:[{timing:"ignition",actions:[
    {verb:"add_to_hand",player:"you",from:["deck"],what:{kinds:["spell"],archetypes:["HERO"]}},
    {verb:"set_spell_trap",player:"you",from:["hand"],what:{}},
  ]}]}));
  const set=deriveRemoteEffectPlans({...source,text:"Add a card, then Set it."},tags).find(p=>p.destination==="set");
  expect(set?.derivedFrom).toBe("effect-index");
  expect(set?.filters[0]).toMatchObject({kinds:["spell"],archetypes:["HERO"]});
});

it("projects multiplayer history, replay, hidden placements and private choices for the exact viewer",()=>{
  const s=deckSession("normal",false); s.select(s.save(originDeck).id);
  s.service.configure(s.room.slug,"g",s.users[0],{format:"normal",showCardsSetFromDeck:false},2001);
  s.service.join(s.room.slug,"g",s.users[1],"Bob",1,2002);
  const deck=s.save(undefined,[],s.users[1]); s.service.selectDeck(s.room.slug,"g",s.users[1],{savedDeckId:deck.id},2003);
  s.service.ready(s.room.slug,"g",s.users[0],true,2004); s.service.ready(s.room.slug,"g",s.users[1],true,2004);
  let room=s.service.start(s.room.slug,"g",s.users[0],2005); let n=0;
  const act=(payload:Record<string,unknown>)=>room=s.service.act(room.slug,"g",s.users[0],{baseSeq:room.lastSeq,action:remoteActionSchema.parse({actorSeat:0,idempotencyKey:"private-"+(++n),...payload})},2100+n);
  act({type:"effect.activated",source:{cardId:70825459}});
  act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"private-set",faceUp:false,cardId:53582587,name:"Torrential Tribute"}});
  act({type:"effect.choose",originId:room.state.effectTracking!.origins[0].id,cardId:53582587});
  const opponent=s.service.get(room.slug,"g",s.users[1],0);
  expect(Object.keys(opponent.state.deckChecks.registrations)).toEqual(["1"]);
  for(const view of [opponent,s.service.replay(room.slug,"g",s.users[1]),s.service.snapshot(room.slug,"g")]) {
    const text=JSON.stringify(view); expect(text).not.toContain("Torrential Tribute"); expect(text).not.toContain('"candidates"'); expect(text).not.toContain('"pool"');
  }
  expect(()=>s.service.snapshot(room.slug,"g",s.users[2])).toThrow(/not found/i);
  act({type:"twin.flip",seat:0,cardRef:"private-set",faceUp:true});
  expect(s.service.get(room.slug,"g",s.users[1]).state.seats[0].twin[0].cardId).toBe(53582587);
});

it("never leaks a known hidden card through live deck warning proofs",()=>{
  const s=deckSession("normal"); s.start();
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"hidden-banned",cardId:55144522,faceUp:false}});
  expect(s.room.state.deckChecks.flags.length).toBeGreaterThan(0);
  const publicView=s.service.snapshot(s.room.slug,"g");
  expect(JSON.stringify(publicView)).not.toContain("Pot of Greed");
  expect(publicView.state.deckChecks.flags).toEqual([]);
});

it("supplements a broad effect index reading with printed restrictions",async()=>{
  const {deriveRemoteEffectPlans,remoteEffectMatches}=await import("../../src/remote/effect-filters.js");
  const {CardTags,fillDefaults}=await import("../../src/cards/effects/tags.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:"Add 1 Level 4 or lower DARK Beast-Warrior monster from your Deck to your hand.",formats:[],views:0,url:""};
  const tags=CardTags.parse(fillDefaults({summary:"Search",effects:[{timing:"ignition",actions:[{verb:"add_to_hand",player:"you",from:["deck"],what:{kinds:["monster"]}}]}]}));
  const plan=deriveRemoteEffectPlans(source,tags)[0];
  expect(remoteEffectMatches(plan,{...source,id:123,name:"Wrong monster",kind:"monster",level:8,attribute:"LIGHT",monsterType:"Dragon"})).toBe(false);
  expect(remoteEffectMatches(plan,{...source,id:124,name:"Right monster",kind:"monster",level:4,attribute:"DARK",monsterType:"Beast-Warrior"})).toBe(true);
});

it("keeps omitted-zone hidden recognition private even in later event history",()=>{
  const s=deckSession("normal");s.start();
  s.act({type:"twin.place",seat:0,zone:"hand",card:{ref:"private-hand",faceUp:false}});
  s.act({type:"card.identified",seat:0,cardRef:"private-hand",cardId:55144522,source:"click"});
  expect(s.room.state.identified?.name).toBe("Pot of Greed");
  expect(JSON.stringify(s.service.snapshot(s.room.slug,"g"))).not.toContain("Pot of Greed");
  s.act({type:"twin.move",seat:0,cardRef:"private-hand",zone:"spell-trap"});
  s.act({type:"twin.flip",seat:0,cardRef:"private-hand",faceUp:true});
  const history=s.service.snapshot(s.room.slug,"g").events.find(e=>e.action.type==="card.identified");
  expect(history).toBeUndefined();
});

it("links camera reads to a privately chosen Set and keeps batch notes independently dismissible",async()=>{
  const {remoteRecognitionRef}=await import("../../src/remote/effect-tracking.js");
  const s=originSession();
  for(const ref of ["a","b"]) {
    s.act({type:"effect.activated",source:{cardId:70825459}});
    s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref,faceUp:false}});
  }
  const origins=s.room.state.effectTracking!.origins;
  s.act({type:"effect.choose",originId:origins[0].id,cardId:53582587});
  expect(remoteRecognitionRef(s.room.state,0,53582587)).toBe("a");
  expect(remoteRecognitionRef(s.room.state,0,5318639)).toBeUndefined();
  expect(remoteRecognitionRef(s.room.state,0,5318639,"b")).toBe("b");
  s.act({type:"cards.identified",seat:0,source:"auto",cards:[
    {cardRef:"a",cardId:5318639,observationId:"one"}, {cardRef:"b",cardId:5318639,observationId:"two"},
  ]});
  const notes=s.room.state.effectTracking!.notes;
  expect(new Set(notes.map(n=>n.id)).size).toBe(2);
  for(const note of notes) s.act({type:"effect.note.dismiss",noteId:note.id});
  expect(s.room.state.effectTracking!.notes.every(n=>n.dismissed)).toBe(true);
});

it("does not announce a searched hand card merely because its private ref is recognized",()=>{
  const s=originSession(); s.act({type:"effect.activated",source:{cardId:73628505}});
  const origin=originOf(s);s.act({type:"effect.choose",originId:origin.id,cardId:47355498});
  s.act({type:"card.identified",seat:0,cardRef:origin.ref,cardId:47355498,source:"auto"});
  const visible=JSON.stringify(s.service.snapshot(s.room.slug,"g"));
  expect(visible).not.toContain("Necrovalley"); expect(visible).not.toContain("47355498");
});

it("uses every engine archetype membership and respects Quick-Play type restrictions",async()=>{
  const {deriveRemoteEffectPlans,remoteEffectMatches}=await import("../../src/remote/effect-filters.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:'Add 1 "HERO" Quick-Play Spell from your Deck to your hand.',formats:[],views:0,url:""};
  const plan=deriveRemoteEffectPlans(source)[0];
  const member={...source,id:123,name:"Member",archetype:"Other",archetypes:["HERO"],subtypes:["quick_play" as const]};
  expect(remoteEffectMatches(plan,member)).toBe(true);
  expect(remoteEffectMatches(plan,{...member,subtypes:["continuous"]})).toBe(false);
});

it("does not mistake words inside archetype names for type or attribute restrictions",async()=>{
  const {deriveRemoteEffectPlans}=await import("../../src/remote/effect-filters.js");
  const source={id:999,name:"Source",kind:"spell" as const,typeLine:"",subtypes:[],text:'Add 1 "Crystal Beast" monster from your Deck to your hand.',formats:[],views:0,url:""};
  expect(deriveRemoteEffectPlans(source)[0].filters[0]).toMatchObject({kinds:["monster"],types:[],archetypes:["Crystal Beast"]});
  expect(deriveRemoteEffectPlans({...source,text:'Add 1 "Dark World" card from your Deck to your hand.'})[0].filters[0].attributes).toEqual([]);
});

it("links board recognition one-to-one without spreading a selected ref across the frame",async()=>{
  const {remoteRecognitionRefs,remoteRecognitionRef}=await import("../../src/remote/effect-tracking.js");
  const s=originSession();s.act({type:"effect.activated",source:{cardId:70825459}});
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"hidden",faceUp:false}});
  s.act({type:"effect.choose",originId:originOf(s).id,cardId:53582587});
  expect(remoteRecognitionRefs(s.room.state,0,[53582587,5318639])).toEqual(["hidden",undefined]);
  expect(remoteRecognitionRefs(s.room.state,0,[53582587,53582587,5318639])).toEqual([undefined,undefined,undefined]);
  s.place("public-copy","spell-trap",2,53582587);
  expect(remoteRecognitionRef(s.room.state,0,53582587)).toBeUndefined();
  expect(remoteRecognitionRef(s.room.state,0,5318639,"hidden")).toBe("hidden");
});

it("keeps the remaining same-name Trap Trick copy after its banish cost becomes public",()=>{
  const s=originSession();s.act({type:"effect.activated",source:{cardId:80101899}});
  s.place("banished-cost","banished",1,53582587);
  s.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
  expect(originOf(s).candidates?.find(c=>c.cardId===53582587)?.copies).toBe(1);
  const alreadySeen=originSession();alreadySeen.place("already-in-gy","graveyard",1,53582587);
  alreadySeen.act({type:"effect.activated",source:{cardId:80101899}});
  alreadySeen.act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"set",faceUp:false}});
  expect(originOf(alreadySeen).candidates?.some(c=>c.cardId===53582587)).toBe(false);
});
