import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as access from "../../src/services/index.js";
import { forkEventFixture } from "../helpers/replay-fork-events.js";

let app: ReturnType<typeof forkEventFixture>;
beforeEach(() => { app = forkEventFixture(); vi.stubEnv("OWNER_USER_IDS", "101,102"); });
afterEach(() => { app.db.close(); vi.unstubAllEnvs(); });
const claims = (slug: string, actor = app.owner, seat: number | null = 0) => ({ slug, guildId: actor.guildId, playerId: actor.playerId, seat });

it("does not give an owner spectator or seat access to another player's finished sandbox", () => {
  app.db.prepare("update duels set sandbox=1,status='completed' where id=?").run(app.source.id);
  for (const seat of [null, 0, 1]) {
    expect(access.canReadDuel(app.db, claims(app.source.slug, app.owner, seat))).toBe(false);
  }
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.sourcePlayer, 0))).toBe(true);
});

it("allows only the current fork creator at identity seat 0", () => {
  expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(true);
  for (const actor of [app.dev, app.alpha, app.sourcePlayer]) expect(access.canReadDuel(app.db, claims(app.forkSlug, actor))).toBe(false);
  for (const seat of [null, 1, 2, 3]) expect(access.canReadDuel(app.db, claims(app.forkSlug, app.owner, seat))).toBe(false);
  vi.stubEnv("OWNER_USER_IDS", "102");
  expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(false);
});
it("checks the guild, player mapping and immutable kind/setup pair", () => {
  expect(access.canReadDuel(app.db, { ...claims(app.forkSlug), guildId: "other" })).toBe(false);
  expect(access.canReadDuel(app.db, { ...claims(app.forkSlug), playerId: 999 })).toBe(false);
  app.db.prepare("update duels set setup_json = '{}' where id = ?").run(app.forkId);
  expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(false);
  expect(access.findDuelEventTarget(app.db, app.forkSlug, app.guildId)).toBeNull();
});
it("keeps ordinary public and private duel access and validates current seats", () => {
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.alpha, null))).toBe(true);
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.sourcePlayer))).toBe(true);
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.alpha))).toBe(false);
  const privateDuel = app.duels.create({ guildId: app.guildId, organizerPlayerId: app.sourcePlayer.playerId,
    name: "Private", mode: "normal", settings: { visibility: "private" } });
  expect(access.canReadDuel(app.db, claims(privateDuel.slug, app.alpha, null))).toBe(false);
  const code = app.duels.room(privateDuel.slug, app.guildId, app.sourcePlayer.playerId).inviteCode!;
  app.duels.admit(privateDuel.slug, app.guildId, app.alpha.playerId, code);
  expect(access.canReadDuel(app.db, claims(privateDuel.slug, app.alpha, null))).toBe(true);
});
it.each(["completed", "interrupted", "cancelled"])("lets current owners read private %s play replays and saved public boards without grants", status => {
  const session = app.duels.create({ guildId: app.guildId, organizerPlayerId: app.sourcePlayer.playerId,
    name: "Private replay", mode: "normal", settings: { visibility: "private" } });
  const publicBoard = { revision: 1, turn: 0, turnSeat: 0, phase: "end", seats: [], chain: [], events: [], log: [], result: null };
  app.db.prepare("update duels set status=?, snapshot_public_json=? where id=?").run(status, JSON.stringify(publicBoard), session.id);
  expect(access.canReadDuel(app.db, claims(session.slug, app.owner, null))).toBe(true);
  expect(app.duels.room(session.slug, app.guildId, app.owner.playerId)).toMatchObject({ role: "spectator", myDeck: null, engine: publicBoard });
  expect(access.canReadDuel(app.db, claims(session.slug, app.owner, 1))).toBe(false);
  expect(access.canReadDuel(app.db, claims(session.slug, app.alpha, null))).toBe(false);
  expect(() => app.duels.room(session.slug, app.guildId, app.alpha.playerId)).toThrow(/invite-only/);
  expect(app.db.prepare("select * from duel_invite_grants").all()).toEqual([]);
  expect(() => app.duels.takeSeat(session.slug, app.guildId, app.owner.playerId)).toThrow();
  vi.stubEnv("OWNER_USER_IDS", "102");
  expect(access.canReadDuel(app.db, claims(session.slug, app.owner, null))).toBe(false);
  expect(() => app.duels.room(session.slug, app.guildId, app.owner.playerId)).toThrow(/invite-only/);
});
it.each(["lobby", "active"])("does not turn private %s tables into owner spectator rooms", status => {
  const session = app.duels.create({ guildId: app.guildId, organizerPlayerId: app.sourcePlayer.playerId,
    name: "Private live table", mode: "normal", settings: { visibility: "private" } });
  app.db.prepare("update duels set status=? where id=?").run(status, session.id);
  expect(access.canReadDuel(app.db, claims(session.slug, app.owner, null))).toBe(false);
  expect(() => app.duels.room(session.slug, app.guildId, app.owner.playerId)).toThrow(/invite-only/);
});
it("binds an invite to its stored id, guild, slug and URL", () => {
  const invite = { duelId: app.source.id, slug: app.source.slug, guildId: app.guildId, url: `https://duel.example/duels/${app.source.slug}` };
  expect(access.assertDuelInviteTarget(app.db, invite).kind).toBe("play");
  for (const change of [{ duelId: app.forkId, slug: app.forkSlug, url: `https://duel.example/duels/${app.forkSlug}` },
    { url: `https://duel.example/duels/${app.forkSlug}` }, { duelId: app.forkId }, { guildId: "other" }, { duelId: undefined }]) {
    expect(() => access.assertDuelInviteTarget(app.db, { ...invite, ...change })).toThrow();
  }
});

it("uses a readonly reader and rechecks owner access without changing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "duel-access-test-"));
  const stored = forkEventFixture(join(directory, "test.sqlite"));
  const reader = access.createDuelAccessReader(join(directory, "test.sqlite"));
  try {
    const before = stored.db.serialize();
    const identity = { ...claims(stored.forkSlug), expiresAt: Date.now() + 60_000 };
    expect(reader.canReadDuel(identity)).toBe(true);
    expect(reader.findDuelEventTarget(stored.forkSlug, stored.guildId)).toMatchObject({ kind: "replay-fork", ownerUserId: "101" });
    vi.stubEnv("OWNER_USER_IDS", "102");
    expect(reader.canReadDuel(identity)).toBe(false);
    expect(stored.db.serialize()).toEqual(before);
    reader.close();
    expect(reader.canReadDuel(identity)).toBe(false);
  } finally { reader.close(); stored.db.close(); rmSync(directory, { recursive: true, force: true }); }
});
it("fails closed when the database is missing", () => {
  const reader = access.createDuelAccessReader("/missing-fork-test/test.sqlite");
  try {
    expect(reader.canReadDuel({ ...claims(app.forkSlug), expiresAt: Date.now() + 60_000 })).toBe(false);
    expect(() => reader.findDuelEventTarget(app.forkSlug, app.guildId))
      .toThrowError(expect.objectContaining({ status: 503, code: "ACCESS_UNAVAILABLE" }));
  } finally { reader.close(); }
});

it("keeps public socket access for legacy play rows with null settings", () => {
  app.db.prepare("update duels set settings_json=null where id=?").run(app.source.id);
  expect(app.duels.room(app.source.slug, app.guildId, app.sourcePlayer.playerId).session.settings.visibility).toBe("public");
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.sourcePlayer))).toBe(true);
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.alpha, null))).toBe(true);
});

it("accepts an invite link under the web base path", () => {
  const invite = { duelId: app.source.id, slug: app.source.slug, guildId: app.guildId,
    url: `https://duel.example/app/duels/${app.source.slug}` };
  expect(access.assertDuelInviteTarget(app.db, invite).kind).toBe("play");
  for (const path of [`/app/not-duels/${app.source.slug}`, `/app/duels/${app.source.slug}/extra`,
    `/app/duels/${app.forkSlug}`, `/app/duels/${app.source.slug}?fork=1`]) {
    expect(() => access.assertDuelInviteTarget(app.db, { ...invite, url: `https://duel.example${path}` })).toThrow();
  }
});
it("reports a fork invite refusal as a typed conflict", () => {
  expect(() => access.assertDuelInviteTarget(app.db, { duelId: app.forkId, slug: app.forkSlug,
    guildId: app.guildId, url: `https://duel.example/duels/${app.forkSlug}` }))
    .toThrowError(expect.objectContaining({ name: "DuelInviteRefusalError", code: "DUEL_INVITE_REFUSED", status: 409 }));
});

it("keeps an ordinary seated player's old token after a seat move", () => {
  app.db.prepare("update duel_seats set seat=1 where duel_id=? and player_id=?").run(app.source.id, app.sourcePlayer.playerId);
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.sourcePlayer, 0))).toBe(true);
  app.db.prepare("delete from duel_seats where duel_id=? and player_id=?").run(app.source.id, app.sourcePlayer.playerId);
  expect(access.canReadDuel(app.db, claims(app.source.slug, app.sourcePlayer, 0))).toBe(false);
});

it("distinguishes a missing target from a DB read outage", () => {
  expect(access.findDuelEventTarget(app.db, "missing", app.guildId)).toBeNull();
  app.db.close();
  expect(() => access.findDuelEventTarget(app.db, app.source.slug, app.guildId))
    .toThrowError(expect.objectContaining({ status: 503, code: "ACCESS_UNAVAILABLE" }));
  expect(access.canReadDuel(app.db, claims(app.source.slug))).toBe(false);
});
it("prepares access queries once per connection while rechecking stored rows", () => {
  const prepare = vi.spyOn(app.db, "prepare");
  try {
    expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(true);
    const count = prepare.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(true);
      expect(access.findDuelEventTarget(app.db, app.source.slug, app.guildId)?.kind).toBe("play");
    }
    expect(prepare).toHaveBeenCalledTimes(count);
    const other = forkEventFixture();
    try {
      other.db.prepare("delete from duel_seats where duel_id=?").run(other.forkId);
      expect(access.canReadDuel(other.db, claims(other.forkSlug))).toBe(false);
      expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(true);
    } finally { other.db.close(); }
    vi.stubEnv("OWNER_USER_IDS", "102");
    expect(access.canReadDuel(app.db, claims(app.forkSlug))).toBe(false);
  } finally { prepare.mockRestore(); }
});
it("treats corrupt setup JSON as an invalid target", () => {
  app.db.prepare("update duels set setup_json='not JSON' where id=?").run(app.source.id);
  expect(access.findDuelEventTarget(app.db, app.source.slug, app.guildId)).toBeNull();
});
