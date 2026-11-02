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
  catalog.exec("create table datas(id integer primary key,ot integer,alias integer,setcode integer,type integer,race integer,attribute integer); create table texts(id integer primary key,name text,desc text)");
  const add = (id: number, name: string, type = 0x11, alias = 0) => {
    catalog.prepare("insert into datas values(?,3,?,0,?,1,1)").run(id, alias, type);
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
    s.act({ type: "twin.remove", seat: 0, cardRef: "one" });
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
    const field = deckSession(); field.start(); field.place("field-a","field",1);
    field.act({ type: "cards.identified", seat: 0, source: "auto", cards: [
      { cardId: 14558127, zone: "field", slot: 1, observationId: "field-a" },
      { cardId: 14558127, zone: "field", slot: 2, observationId: "field-b" },
    ] });
    expect(field.room.state.deckChecks.flags).toEqual([]);
  });
  it("does not count a repeated same-slot batch ref as separate physical detections", () => {
    const s = deckSession(); s.start(); s.place("a");
    s.act({ type:"cards.identified",seat:0,source:"auto",cards:[
      {cardId:14558127,cardRef:"a",observationId:"a"}, {cardId:14558127,cardRef:"a",observationId:"b"},
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
describe("B3 physical field slot guard", () => {
  const slots = [
    ...["monster", "spell-trap"].flatMap(zone => [1, 2, 3, 4, 5].map(slot => ({ zone, slot }))),
    ...["extra-monster", "pendulum"].flatMap(zone => [1, 2].map(slot => ({ zone, slot }))),
    { zone: "field", slot: 1 },
  ];
  it.each(slots)("rejects a second placement or incoming move into $zone $slot without changing state", ({ zone, slot }) => {
    const s = deckSession(); s.start(); s.place("occupant", zone, slot, 1);
    s.place("incoming", "graveyard", 1, 2);
    const before = structuredClone(s.room);
    for (const action of [
      { type: "twin.place", seat: 0, zone, card: { ref: "duplicate", slot, faceUp: false } },
      { type: "twin.move", seat: 0, zone, slot, cardRef: "incoming", position: "defense" },
    ]) {
      expect(() => s.act(action)).toThrow(/occupied/i);
      expect(s.service.get(s.room.slug, "g", s.users[0])).toEqual(before);
    }
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(before.state);
  });
  it.each([undefined, 1, 5])("treats the field zone as one physical slot even with slot %s", slot => {
    const s = deckSession(); s.start();
    s.act({ type: "twin.place", seat: 0, zone: "field", card: { ref: "field-a" } });
    s.place("incoming", "graveyard");
    expect(() => s.act({ type: "twin.place", seat: 0, zone: "field", card: { ref: "field-b", slot } })).toThrow(/occupied/i);
    expect(() => s.act({ type: "twin.move", seat: 0, zone: "field", slot, cardRef: "incoming" })).toThrow(/occupied/i);
    s.act({ type: "twin.move", seat: 0, zone: "field", slot, cardRef: "field-a", position: "defense" });
    expect(s.room.state.seats[0].twin[0]).toMatchObject({ ref: "field-a", position: "defense" });
  });
  it.each([
    ["twin.place", "twin.place"], ["twin.place", "twin.move"],
    ["twin.move", "twin.place"], ["twin.move", "twin.move"],
  ])("rejects stale %s intent after %s fills its destination, even with the latest sequence", (staleType, firstType) => {
    const s = deckSession(); s.start(); s.place("first", "graveyard", 1, 1); s.place("second", "graveyard", 1, 2);
    const staleIntent = staleType === "twin.place"
      ? { type: staleType, seat: 0, zone: "monster", card: { ref: "stale", slot: 2 } }
      : { type: staleType, seat: 0, zone: "monster", cardRef: "second", slot: 2 };
    s.act(firstType === "twin.place"
      ? { type: firstType, seat: 0, zone: "monster", card: { ref: "manual", slot: 2 } }
      : { type: firstType, seat: 0, zone: "monster", cardRef: "first", slot: 2 });
    const before = structuredClone(s.room);
    expect(() => s.act(staleIntent)).toThrow(/occupied/i);
    expect(s.service.get(s.room.slug, "g", s.users[0])).toEqual(before);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(before.state);
  });
  it.each(["monster", "spell-trap", "extra-monster", "pendulum"])("allows self moves, free slots and separate owners in %s, preserving Undo and replay", zone => {
    const s = deckSession(); s.start(); s.place("moving", zone, 1);
    s.act({ type: "twin.place", actorSeat: 1, seat: 1, zone, card: { ref: "other-owner", slot: 1 } });
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone, slot: 1, position: "defense" });
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone });
    expect(s.room.state.seats[0].twin[0]).toMatchObject({ ref: "moving", zone, slot: 1, position: "defense" });
    const before = structuredClone(s.room.state.seats[0].twin);
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone, slot: 2 });
    expect(s.room.state.seats[0].twin[0].slot).toBe(2);
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats[0].twin).toEqual(before);
    s.act({ type: "twin.move", seat: 0, cardRef: "moving", zone: "graveyard" });
    s.place("new-occupant", zone, 1);
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["graveyard", "banished", "hand", "deck", "extra", "hand-reveal"])("allows several placements and incoming moves with the same optional slot in the %s pile", zone => {
    const s = deckSession(); s.start(); s.place("a", zone, 1, 1); s.place("b", zone, 1, 2); s.place("c", "monster", 1, 3);
    s.act({ type: "twin.move", seat: 0, cardRef: "c", zone, slot: 1 });
    expect(s.room.state.seats[0].twin.filter(card => card.zone === zone)).toHaveLength(3);
    s.act({ type: "undo", targetActionId: s.room.state.undo!.actionId });
    expect(s.room.state.seats[0].twin.find(card => card.ref === "c")?.zone).toBe("monster");
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["monster", "spell-trap", "extra-monster", "pendulum"])("preserves unlocated legacy %s twins without guessing their physical slot", zone => {
    const s = deckSession(); s.start();
    for (const ref of ["unlocated-a", "unlocated-b"]) s.act({ type: "twin.place", seat: 0, zone, card: { ref } });
    s.place("located", zone, 1, 1); s.place("incoming", "graveyard", 1, 2);
    s.act({ type: "twin.move", seat: 0, cardRef: "incoming", zone });
    s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, position: "defense" });
    expect(s.room.state.seats[0].twin.filter(card => card.slot === undefined)).toHaveLength(3);
    expect(() => s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, slot: 1 })).toThrow(/occupied/i);
    s.act({ type: "twin.move", seat: 0, cardRef: "unlocated-a", zone, slot: 2 });
    expect(s.service.replay(s.room.slug, "g", s.users[0])).toEqual(s.room.state);
  });
  it.each(["extra-monster", "pendulum"])("rejects explicit slots outside the two physical %s positions", zone => {
    const s = deckSession(); s.start(); s.place("incoming", "graveyard");
    for (const slot of [3, 4, 5]) {
      expect(() => s.act({ type: "twin.place", seat: 0, zone, card: { ref: "out-of-range", slot } })).toThrow(/slot/i);
      expect(() => s.act({ type: "twin.move", seat: 0, cardRef: "incoming", zone, slot })).toThrow(/slot/i);
    }
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
    expect(service.replay(table.slug, "g", users[0])).toEqual(room.state);
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
    if (slot === 3) b.state.seats[1].twin[0].slot = 4;
    b.place(1, { ref: `slot-${slot}`, slot });
    const state = structuredClone(b.state);
    state.seats[1].twin.reverse();
    const result = resolve(state, `my dragon attacks zone ${slot}`);
    expect(result.candidates.some(c => c.proposal.targetCardRef === `slot-${slot}`)).toBe(true);
    expect(result.status).toBe("unique");
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

it('moves a physical twin to defense under the same ref, with Undo and owner checks',()=>{
  const s=deckSession();s.start();s.place('rotation');
  s.act({type:'twin.move',seat:0,cardRef:'rotation',zone:'monster',slot:1,position:'defense'});
  expect(s.room.state.seats[0].twin[0]).toMatchObject({ref:'rotation',position:'defense'});
  const event=s.room.state.undo!.actionId;
  s.act({type:'undo',targetActionId:event});expect(s.room.state.seats[0].twin[0].position).toBe('attack');
  expect(()=>s.act({type:'twin.move',actorSeat:1,seat:0,cardRef:'rotation',zone:'monster',position:'defense'})).toThrow(/owner/);
});

it('persists one named automatic departure with destination correction and normal owner/Undo rules',()=>{
  const s=deckSession();s.start();s.place('leaving');const before=s.room.state.seats[0].twin[0];
  const departure={type:'twin.move',seat:0,cardRef:'leaving',zone:'graveyard',source:'auto',name:'Varudras'} as const;
  s.act(departure);expect(s.room.state.seats[0].twin).toEqual([{...before,zone:'graveyard',slot:undefined}]);
  expect(s.room.events.at(-1)?.action).toMatchObject(departure);expect(s.service.replay(s.room.slug,'g',s.users[0])).toEqual(s.room.state);
  const left=s.room.state.undo!.actionId;s.act({type:'undo',targetActionId:left});expect(s.room.state.seats[0].twin[0]).toEqual(before);
  s.act(departure);s.act({...departure,zone:'banished'});const corrected=s.room.state.undo!.actionId;
  s.act({type:'undo',targetActionId:corrected});expect(s.room.state.seats[0].twin[0].zone).toBe('graveyard');
  expect(()=>s.act({...departure,actorSeat:1})).toThrow(/owner/);
  expect(remoteActionSchema.safeParse({...departure,idempotencyKey:'bounded',actorSeat:0,name:'x'.repeat(201)}).success).toBe(false);
});
