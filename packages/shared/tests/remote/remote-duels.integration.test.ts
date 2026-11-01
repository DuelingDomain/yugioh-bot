import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { seedUser } from "../helpers/identity.js";
import { createRemoteDuelService } from "../../src/services/remote-duels.js";
import { getRemoteGame, resolveAttack, ygoModule, remoteActionSchema, type GameModule, type RemoteRoom, type SeatCount } from "../../src/remote/index.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys = ON"); migrate(db);
  const users = ["a", "b", "c", "d"].map(key => seedUser(db, key).userId);
  const service = createRemoteDuelService(db);
  const table = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 3 }, 1000);
  return { db, users, service, table };
}
describe("solo remote tables", () => {
  it.each([2, 3, 4] as SeatCount[])("fills a %i-seat solo table with userless, ready bots and runs the full action loop", seatCount => {
    const { service, users, db } = setup();
    let room = service.create({ guildId: "g", userId: users[0], displayName: "Owner", gameId: "ygo", seatCount, solo: true }, 2000);
    expect(room.solo).toBe(true);
    expect(room.mySeat).toBe(0);
    expect(room.seats).toHaveLength(seatCount);
    expect(room.seats[0]).toMatchObject({ userId: users[0], bot: false });
    expect(room.seats.slice(1).every(s => s.userId === null && s.bot && s.ready && s.displayName.startsWith("Test Bot"))).toBe(true);
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
    service.join(table.slug, "g", users[2], "C", 2, 1200);
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
    const { service, table, users } = setup();
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
    const { service, table, users } = setup();
    expect(() => service.start(table.slug, "g", users[0], 1100)).toThrow(/ready/);
    service.join(table.slug, "g", users[1], "B", 1, 1100);
    expect(() => service.join(table.slug, "g", users[2], "C", 1, 1100)).toThrow(/seat/i);
    service.join(table.slug, "g", users[2], "C", 2, 1100);
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
  expect(canReadRemote(db, claims)).toBe(true);
  expect(canReadRemote(db, { ...claims, guildId: "other" })).toBe(false);
  expect(canReadRemote(db, { ...claims, seat: 2 })).toBe(false);
  service.leave(table.slug, "g", users[1], 1200);
  expect(canReadRemote(db, claims)).toBe(false);
  service.join(table.slug, "g", users[2], "C", 1, 1300);
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
    const { service, table, users } = setup();
    service.join(table.slug, "g", users[1], "Imran", 1, 1100);
    service.join(table.slug, "g", users[2], "Sara", 2, 1100);
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
