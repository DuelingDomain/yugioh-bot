import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { seedUser } from "../helpers/identity.js";
import { createRemoteDuelService } from "../../src/services/remote-duels.js";
import { ygoModule, remoteActionSchema, type GameModule } from "../../src/remote/index.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new Database(":memory:"); databases.push(db); db.pragma("foreign_keys = ON"); migrate(db);
  const users = ["a", "b", "c", "d"].map(key => seedUser(db, key).userId);
  const service = createRemoteDuelService(db);
  const table = service.create({ guildId: "g", userId: users[0], displayName: "A", gameId: "ygo", seatCount: 3 }, 1000);
  return { db, users, service, table };
}
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
