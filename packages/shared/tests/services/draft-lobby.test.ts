import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as draftServices from "../../src/services/drafts.js";
import { migrate } from "../../src/db/schema.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createDraftLobbyService, DraftLobbyServiceError } from "../../src/services/draft-lobby.js";
import { TEST_BOT_DISCORD_PREFIX } from "../../src/services/draft-decks.js";
import type { DraftConfig } from "../../src/types/index.js";

const now = new Date("2026-10-07T12:00:00.000Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const connections: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of connections.splice(0)) db.close(); });

function setup(config: DraftConfig = {}, identities = ["host", "guest"]) {
  const db = new Database(":memory:");
  connections.push(db);
  migrate(db);
  const ids = identities.map((user, index) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
  ).run(user, index === 1 ? "Bot Guest" : user).lastInsertRowid));
  for (let id = 1; id <= 24; id++) db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')`).run(id, `Card ${id}`);
  const drafts = createDraftService(db);
  const draft = drafts.create("g", "channel", "Lobby", {
    packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, lobbySeats: 4,
    cubeCardIds: Array.from({ length: 24 }, (_, i) => i + 1), ...config,
  }, "host", ids[0]);
  for (const id of ids.slice(1)) drafts.join(draft.id, id);
  const lobby = createDraftLobbyService(db);
  const read = (viewer = "host", time = now) => lobby.read(draft.id, viewer, time);
  const ready = () => { for (const user of identities) lobby.setReady(draft.id, user, true, now); };
  return { db, drafts, draft, ids, lobby, read, ready };
}

function themeSetup(selection: "player_pick" | "random" | "host_assigned" = "player_pick", identities = ["host", "guest"]) {
  const app = setup({ mode: "theme", themeSelection: selection, cardsPerPlayer: 4,
    themePackSize: 3, extraDeckEnabled: true, extraDeckSize: 15, uniqueThemes: false }, identities);
  const cubeId = Number(app.db.prepare(
    "insert into cubes (guild_id,name,created_by_user_id) values ('g','Theme','host')",
  ).run().lastInsertRowid);
  for (let id = 1; id <= 8; id++) app.db.prepare(
    "insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (?,?,'main',1)",
  ).run(cubeId, id);
  const config = { ...app.drafts.findById(app.draft.id).config, allowedCubeIds: [cubeId],
    themeAssignments: Object.fromEntries(app.ids.map((id) => [id, cubeId])) };
  app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
  const claim = (playerId: number) => app.db.prepare(
    "insert into draft_player_cube (draft_id,player_id,cube_id) values (?,?,?)",
  ).run(app.draft.id, playerId, cubeId);
  return { ...app, cubeId, claim };
}

describe("draft lobby projection and acknowledgement", () => {
  it("projects identity flags without exposing Discord IDs, and preserves legacy targets", () => {
    const app = setup({ lobbySeats: undefined });
    const state = app.read("guest");
    expect(state.lobby).toMatchObject({ serverNow: now.toISOString(), targetSeats: null,
      joined: 2, ready: 0, allReady: false, autoStart: { eligible: false } });
    expect(state.players[0]).toMatchObject({ isHost: true, isYou: false, isBot: false, readyAt: null });
    expect(state.players[1]).toMatchObject({ isHost: false, isYou: true, isBot: false });
    expect(JSON.stringify(state)).not.toContain("discord_user_id");
    expect(JSON.stringify(state)).not.toContain("ready_setup_hash");
  });

  it("sets readiness idempotently, requires the joined actor, and invalidates schedules", () => {
    const app = setup();
    const first = app.lobby.setReady(app.draft.id, "host", true, now);
    expect(first.players[0].readyAt).toBe(now.toISOString());
    expect(app.lobby.setReady(app.draft.id, "host", true, later(1000))).toEqual({
      ...first, lobby: { ...first.lobby, serverNow: later(1000).toISOString() },
    });
    expect(() => app.lobby.setReady(app.draft.id, "outsider", true, now)).toThrowError(
      expect.objectContaining({ code: "NOT_JOINED", status: 403 }),
    );
    app.ready();
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    expect(app.lobby.setReady(app.draft.id, "guest", false, now).lobby.start).toBeNull();
  });

  it("treats test bots as ready and ignores their acknowledgement clicks", () => {
    const user = `${TEST_BOT_DISCORD_PREFIX}1`;
    const app = setup({}, ["host", user]);
    const initial = app.read(user);
    expect(initial.players[1]).toMatchObject({ ready: true, isBot: true, readyAt: null });
    expect(app.lobby.setReady(app.draft.id, user, false, now)).toEqual(initial);
  });

  it("keeps readiness across cosmetic edits and invalidates it after source edits", () => {
    const app = themeSetup();
    app.ids.forEach(app.claim);
    app.ready();
    app.db.prepare("update drafts set name = 'Renamed', channel_id = 'new' where id = ?").run(app.draft.id);
    app.db.prepare("update cubes set name = 'Cosmetic' where id = ?").run(app.cubeId);
    expect(app.read().lobby.allReady).toBe(true);
    app.db.prepare("update cube_cards set max_copies = 2 where cube_id = ? and catalog_card_id = 1").run(app.cubeId);
    expect(app.read().lobby.ready).toBe(0);
  });

  it.each(["add", "remove"] as const)("keeps Ready and auto countdowns when catalog syncs %s set cards", (change) => {
    const app = setup({ cubeCardIds: undefined, setNames: ["Lobby Set"], lobbySeats: 2 });
    const sets = JSON.stringify([{ set_name: "Lobby Set", set_code: "LS" }]);
    app.db.prepare("update card_catalog set card_sets_json = ? where ygoprodeck_id <= 18").run(sets);
    app.ready();
    const scheduled = app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    const previousPool = app.drafts.resolveCubeCardIds(app.drafts.findById(app.draft.id).config);
    app.db.prepare("update card_catalog set card_sets_json = ? where ygoprodeck_id = ?")
      .run(change === "add" ? sets : "[]", change === "add" ? 19 : 18);
    expect(app.drafts.resolveCubeCardIds(app.drafts.findById(app.draft.id).config)).not.toEqual(previousPool);
    const current = app.read();
    expect(current.lobby).toMatchObject({ allReady: true, revision: scheduled.lobby.revision, start: scheduled.lobby.start });
    expect(current.players.map((player) => player.readyAt)).toEqual([now.toISOString(), now.toISOString()]);
    expect(app.lobby.tick(later(10000)).started).toHaveLength(1);
  });

  it("keeps Ready when catalog refresh changes Extra card eligibility", () => {
    const app = setup({ extraDeckEnabled: true, extraDeckSize: 1, customExtraCardIds: [23, 24] });
    app.db.prepare("update card_catalog set type = 'Fusion Monster', frame_type = 'fusion' where ygoprodeck_id >= 23").run();
    app.ready();
    app.db.prepare("update card_catalog set type = 'Normal Monster', frame_type = 'normal' where ygoprodeck_id = 24").run();
    expect(app.drafts.resolveExtraCardIds(app.drafts.findById(app.draft.id).config, "g")).toEqual([23]);
    expect(app.read().lobby.allReady).toBe(true);
  });

  it("holds a catalog-thinned start with a visible preflight error while preserving Ready", () => {
    const app = setup({ cubeCardIds: undefined, setNames: ["Lobby Set"], lobbySeats: 2 });
    app.db.prepare("update card_catalog set card_sets_json = ?").run(JSON.stringify([{ set_name: "Lobby Set" }]));
    app.ready();
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    app.db.prepare("update card_catalog set card_sets_json = '[]'").run();
    const state = app.read();
    expect(state.lobby.allReady).toBe(true);
    expect(state.lobby.errors.length).toBeGreaterThan(0);
    expect(app.lobby.tick(later(10000))).toEqual({ started: [], changedSlugs: [app.draft.webSlug] });
    expect(app.read().lobby).toMatchObject({ allReady: true, start: null, autoStart: { held: true },
      lastStartError: state.lobby.errors.join(" ") });
    expect(app.db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
  });

  it("invalidates Ready when configured set selections change", () => {
    const app = setup({ cubeCardIds: undefined, setNames: ["Original"] });
    app.db.prepare("update card_catalog set card_sets_json = ?")
      .run(JSON.stringify([{ set_name: "Original" }, { set_name: "Replacement" }]));
    app.ready();
    const config = { ...app.drafts.findById(app.draft.id).config, setNames: ["Replacement"] };
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    expect(app.read().lobby.ready).toBe(0);
  });

  it("invalidates booster Ready when a referenced source cube changes", () => {
    const app = setup();
    const cubeId = Number(app.db.prepare("insert into cubes (guild_id,name,created_by_user_id) values ('g','Source','host')")
      .run().lastInsertRowid);
    app.db.prepare("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (?,1,'main',1)").run(cubeId);
    const config = { ...app.drafts.findById(app.draft.id).config, poolSource: { cubeId } };
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    app.ready();
    app.db.prepare("update cube_cards set max_copies = 2 where cube_id = ?").run(cubeId);
    expect(app.read().lobby.ready).toBe(0);
  });

  it("shares pending player claims, hides other assignment modes, and requires a claim for Ready", () => {
    const app = themeSetup();
    expect(() => app.lobby.setReady(app.draft.id, "guest", true, now)).toThrowError(
      expect.objectContaining({ code: "CLAIM_REQUIRED" }),
    );
    app.claim(app.ids[0]);
    expect(app.read("guest").players[0].cubeId).toBe(app.cubeId);
    for (const selection of ["host_assigned", "random"] as const) {
      const other = themeSetup(selection);
      expect(other.read("guest").players.every((p) => p.cubeId === null)).toBe(true);
      expect(other.read().players[0].cubeId).toBe(selection === "host_assigned" ? other.cubeId : null);
    }
  });

  it("clears just the affected acknowledgement and supports revision CAS for route transactions", () => {
    const app = setup();
    app.ready();
    const revision = app.read().lobby.revision;
    app.lobby.invalidate(app.draft.id, { playerIds: [app.ids[1]], expectedRevision: revision });
    expect(app.read().players.map((p) => p.ready)).toEqual([true, false]);
    expect(() => app.lobby.invalidate(app.draft.id, { expectedRevision: revision })).toThrowError(
      expect.objectContaining({ code: "STALE_LOBBY" }),
    );
    app.lobby.invalidate(app.draft.id, { clearReady: true });
    expect(app.read().lobby.ready).toBe(0);
  });

  it("acknowledges deterministic pools regardless of config key or allowed-cube ordering", () => {
    const app = themeSetup("random");
    const second = Number(app.db.prepare("insert into cubes (guild_id,name,created_by_user_id) values ('g','Second','host')").run().lastInsertRowid);
    app.db.prepare("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) select ?,catalog_card_id,pool,max_copies from cube_cards where cube_id = ?")
      .run(second, app.cubeId);
    const config = { ...app.drafts.findById(app.draft.id).config, allowedCubeIds: [app.cubeId, second] };
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    app.ready();
    const reordered = Object.fromEntries(Object.entries({ ...config, allowedCubeIds: [second, app.cubeId] }).reverse());
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(reordered), app.draft.id);
    expect(app.read().lobby.allReady).toBe(true);
  });

  it("invalidates only a changed host assignment even when a route did not clear Ready", () => {
    const app = themeSetup("host_assigned");
    const second = Number(app.db.prepare("insert into cubes (guild_id,name,created_by_user_id) values ('g','Second','host')").run().lastInsertRowid);
    app.db.prepare("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) select ?,catalog_card_id,pool,max_copies from cube_cards where cube_id = ?")
      .run(second, app.cubeId);
    const config = { ...app.drafts.findById(app.draft.id).config, allowedCubeIds: [app.cubeId, second] };
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    app.ready();
    config.themeAssignments![String(app.ids[1])] = second;
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    expect(app.read().players.map((p) => p.ready)).toEqual([true, false]);
  });
});

describe("departure and capacity", () => {
  it("allows host Leave/rejoin, cleans claims/maps, and keeps other humans ready", () => {
    const app = themeSetup("host_assigned");
    app.ids.forEach(app.claim);
    app.ready();
    const state = app.lobby.leave(app.draft.id, "host", now);
    expect(state.players.map((p) => p.ready)).toEqual([true]);
    expect(app.drafts.findById(app.draft.id).createdByUserId).toBe("host");
    expect(app.db.prepare("select * from draft_player_cube where player_id = ?").get(app.ids[0])).toBeUndefined();
    expect(app.drafts.findById(app.draft.id).config.themeAssignments).not.toHaveProperty(String(app.ids[0]));
    expect(app.lobby.leave(app.draft.id, "host", now)).toEqual(state);
    app.drafts.join(app.draft.id, app.ids[0]);
    expect(app.read().players.find((p) => p.isHost)).toMatchObject({ ready: false, cubeId: null });
  });

  it("checks host removal permission, rejects self removal and out-of-draft seat IDs", () => {
    const app = setup();
    expect(() => app.lobby.removePlayer(app.draft.id, "guest", app.ids[0], now)).toThrowError(
      expect.objectContaining({ code: "HOST_REQUIRED" }),
    );
    expect(() => app.lobby.removePlayer(app.draft.id, "host", app.ids[0], now)).toThrowError(
      expect.objectContaining({ code: "SELF_REMOVAL" }),
    );
    expect(() => app.lobby.removePlayer(app.draft.id, "host", 999, now)).toThrowError(
      expect.objectContaining({ code: "PLAYER_NOT_FOUND" }),
    );
    expect(app.lobby.removePlayer(app.draft.id, "host", app.ids[1], now).lobby.joined).toBe(1);
  });

  it("enforces capacity and supplied target validity in the shared kernel", () => {
    const app = setup({ lobbySeats: 2 });
    const id = Number(app.db.prepare("insert into players (guild_id,discord_user_id,display_name) values ('g','third','Third')").run().lastInsertRowid);
    expect(() => app.drafts.join(app.draft.id, id)).toThrowError(expect.objectContaining({ code: "LOBBY_FULL" }));
    expect(() => app.drafts.create("g", "c", "Bad", { lobbySeats: 1 }, "host", app.ids[0])).toThrowError(
      expect.objectContaining({ code: "INVALID_LOBBY_SEATS" }),
    );
  });

  it("rejects a reduced target and rolls back the caller's surrounding config transaction", () => {
    const app = setup({}, ["host", "guest", "third"]);
    const original = app.drafts.findById(app.draft.id).config;
    const revision = app.read().lobby.revision;
    expect(() => app.db.transaction(() => {
      app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify({ ...original, lobbySeats: 2 }), app.draft.id);
      app.lobby.invalidate(app.draft.id, { clearReady: true, expectedRevision: revision });
    }).immediate()).toThrowError(expect.objectContaining({ code: "SEAT_TARGET_TOO_SMALL" }));
    expect(app.drafts.findById(app.draft.id).config).toEqual(original);
    expect(app.read().lobby.revision).toBe(revision);
  });

  it("has no phantom host acknowledgement after Leave and still lets the host schedule", () => {
    const app = setup({}, ["host", "guest", "third"]);
    app.ready();
    const state = app.lobby.leave(app.draft.id, "host", now);
    expect(state.lobby.allReady).toBe(true);
    expect(app.lobby.scheduleStart(app.draft.id, "host", { revision: state.lobby.revision }, now).lobby.start).not.toBeNull();
  });
});

describe("manual and automatic deadlines", () => {
  it.each([
    { auto: 0, held: 0, scoped: false }, { auto: 0, held: 0, scoped: true },
    { auto: 0, held: 1, scoped: false }, { auto: 0, held: 1, scoped: true },
    { auto: 1, held: 1, scoped: false }, { auto: 1, held: 1, scoped: true },
  ])("skips idle or held lobbies without a write transaction or preflight: %j", ({ auto, held, scoped }) => {
    const app = setup();
    app.db.prepare("update drafts set lobby_auto_start = ?, lobby_auto_held = ? where id = ?")
      .run(auto, held, app.draft.id);
    const preflight = vi.fn(app.drafts.analyzeBoosterDraft);
    vi.spyOn(draftServices, "createDraftService").mockReturnValue({ ...app.drafts, analyzeBoosterDraft: preflight });
    const sweep = createDraftLobbyService(app.db);
    const transaction = vi.spyOn(app.db, "transaction");
    expect(sweep.tick(now, scoped ? app.draft.id : undefined)).toEqual({ started: [], changedSlugs: [] });
    expect(preflight).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { lobbySeats: 2, ready: false }, { lobbySeats: 4, ready: true }, { lobbySeats: undefined, ready: true },
  ])("skips preflight when auto-start cannot arm: %j", ({ lobbySeats, ready }) => {
    const app = setup({ lobbySeats });
    if (ready) app.ready();
    app.db.prepare("update drafts set lobby_auto_start = 1 where id = ?").run(app.draft.id);
    const preflight = vi.fn(app.drafts.analyzeBoosterDraft);
    vi.spyOn(draftServices, "createDraftService").mockReturnValue({ ...app.drafts, analyzeBoosterDraft: preflight });
    expect(createDraftLobbyService(app.db).tick(now)).toEqual({ started: [], changedSlugs: [] });
    expect(preflight).not.toHaveBeenCalled();
  });

  it.each(["manual", "auto"] as const)("defers %s countdown preflight until the start deadline", (kind) => {
    const app = setup({ lobbySeats: 2 });
    app.ready();
    const revision = app.read().lobby.revision;
    const scheduled = kind === "manual"
      ? app.lobby.scheduleStart(app.draft.id, "host", { revision }, now)
      : app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision }, now);
    const preflight = vi.fn(app.drafts.analyzeBoosterDraft);
    vi.spyOn(draftServices, "createDraftService").mockReturnValue({ ...app.drafts, analyzeBoosterDraft: preflight });
    const sweep = createDraftLobbyService(app.db);
    const deadline = new Date(scheduled.lobby.start!.startsAt);
    const transaction = vi.spyOn(app.db, "transaction");
    expect(sweep.tick(new Date(deadline.getTime() - 1))).toEqual({ started: [], changedSlugs: [] });
    expect(preflight).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(sweep.tick(deadline).started).toHaveLength(1);
    expect(preflight).toHaveBeenCalled();
  });

  it("schedules 5 seconds, starts early with two seats, and retries without extending", () => {
    const app = setup();
    app.ready();
    const revision = app.read().lobby.revision;
    const scheduled = app.lobby.scheduleStart(app.draft.id, "host", { revision }, now);
    expect(scheduled.lobby.start).toMatchObject({ kind: "manual", startsAt: later(5000).toISOString() });
    expect(app.lobby.scheduleStart(app.draft.id, "host", { revision }, later(1000)).lobby.start).toEqual(scheduled.lobby.start);
    expect(app.db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
    expect(app.lobby.tick(later(4999)).started).toEqual([]);
    expect(app.lobby.tick(later(5000))).toMatchObject({ started: [{ id: app.draft.id, status: "active" }], changedSlugs: [app.draft.webSlug] });
    expect(app.lobby.tick(later(6000)).started).toEqual([]);
    expect(() => app.lobby.read(app.draft.id, "host", now)).toThrowError(expect.objectContaining({ code: "DRAFT_NOT_PENDING" }));
  });

  it.each(["booster", "theme"] as const)("treats manual Start as the host's acknowledgement in %s", (mode) => {
    const theme = mode === "theme" ? themeSetup() : null;
    const app = theme ?? setup();
    if (theme) theme.ids.forEach(theme.claim);
    app.lobby.setReady(app.draft.id, "guest", true, now);
    const revision = app.read().lobby.revision;
    const scheduled = app.lobby.scheduleStart(app.draft.id, "host", { revision }, now);
    expect(scheduled.players[0]).toMatchObject({ isHost: true, ready: false, readyAt: null });
    expect(scheduled.lobby).toMatchObject({ allReady: false, start: { kind: "manual", startsAt: later(5000).toISOString() } });
    expect(app.lobby.scheduleStart(app.draft.id, "host", { revision }, later(1000)).lobby.start).toEqual(scheduled.lobby.start);
    expect(app.lobby.tick(later(4999)).started).toEqual([]);
    expect(app.lobby.tick(later(5000)).started).toMatchObject([{ id: app.draft.id, status: "active" }]);
    expect(app.lobby.tick(later(6000)).started).toEqual([]);
  });

  it("rechecks guest acknowledgements at the manual deadline", () => {
    const app = setup();
    app.lobby.setReady(app.draft.id, "guest", true, now);
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    // Simulate a lost acknowledgement without the normal mutation's schedule cancellation.
    app.db.prepare("update draft_players set ready_at = null where player_id = ?").run(app.ids[1]);
    expect(app.lobby.tick(later(5000)).started).toEqual([]);
    expect(app.read().lobby).toMatchObject({ start: null, lastStartError: "Players are no longer Ready for this setup" });
  });

  it("requires the host's Ready mark to arm and finish an auto countdown", () => {
    const app = setup({ lobbySeats: 2 });
    app.lobby.setReady(app.draft.id, "guest", true, now);
    const enabled = app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    expect(enabled.lobby).toMatchObject({ start: null, allReady: false, autoStart: { eligible: false } });
    expect(app.lobby.tick(now).changedSlugs).toEqual([]);
    app.lobby.setReady(app.draft.id, "host", true, now);
    app.lobby.tick(now);
    expect(app.read().lobby.start).toMatchObject({ kind: "auto", startsAt: later(10000).toISOString() });
    app.db.prepare("update draft_players set ready_at = null where player_id = ?").run(app.ids[0]);
    expect(app.lobby.tick(later(10000)).started).toEqual([]);
    expect(app.read().lobby).toMatchObject({ start: null, autoStart: { held: true }, lastStartError: "Players are no longer Ready for this setup" });
  });

  it("rejects stale revisions and unready players with typed details; force bypasses only Ready", () => {
    const app = setup();
    expect(() => app.lobby.scheduleStart(app.draft.id, "guest", { revision: 0 }, now)).toThrowError(expect.objectContaining({ code: "HOST_REQUIRED" }));
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: -1 }, now)).toThrowError(DraftLobbyServiceError);
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: 0 }, now)).toThrowError(expect.objectContaining({ code: "STALE_LOBBY" }));
    const revision = app.read().lobby.revision;
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision }, now)).toThrowError(
      expect.objectContaining({ code: "NOT_READY", notReadyPlayerIds: [app.ids[1]] }),
    );
    expect(app.lobby.scheduleStart(app.draft.id, "host", { revision, force: true }, now).lobby.start).not.toBeNull();
    app.lobby.leave(app.draft.id, "guest", now);
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision, force: true }, now)).toThrowError(
      expect.objectContaining({ code: "TOO_FEW_PLAYERS" }),
    );
  });

  it("uses random fallback for forced unclaimed theme seats and preserves Extra warnings", () => {
    const app = themeSetup();
    expect(app.read().lobby.warnings.join(" ")).toContain("Extra");
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now)).toThrowError(
      expect.objectContaining({ unclaimedPlayerIds: app.ids }),
    );
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision, force: true }, now);
    expect(app.lobby.tick(later(5000)).started).toHaveLength(1);
  });

  it.each(["manual", "auto-enable", "auto-tick"] as const)("gives an unclaimed test bot a random theme at %s start without confirmation", (kind) => {
    const bot = `${TEST_BOT_DISCORD_PREFIX}1`;
    const app = themeSetup("player_pick", ["host", bot]);
    const config = { ...app.drafts.findById(app.draft.id).config, lobbySeats: 2 };
    app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
    app.claim(app.ids[0]);
    if (kind === "auto-tick") {
      app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
      expect(app.read().lobby.start).toBeNull();
    }
    app.lobby.setReady(app.draft.id, "host", true, now);
    expect(app.read().players[1]).toMatchObject({ isBot: true, ready: true, cubeId: null });
    expect(app.read().lobby).toMatchObject({ allReady: true, autoStart: { eligible: true } });
    const revision = app.read().lobby.revision;
    if (kind === "manual") app.lobby.scheduleStart(app.draft.id, "host", { revision }, now);
    else if (kind === "auto-enable") app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision }, now);
    else app.lobby.tick(now);
    const deadline = kind === "manual" ? 5000 : 10000;
    expect(app.read().lobby.start).toMatchObject({ kind: kind === "manual" ? "manual" : "auto", startsAt: later(deadline).toISOString() });
    expect(app.lobby.tick(later(deadline - 1)).started).toEqual([]);
    expect(app.lobby.tick(later(deadline)).started).toHaveLength(1);
    expect(app.db.prepare("select cube_id from draft_player_cube where draft_id = ? and player_id = ?")
      .get(app.draft.id, app.ids[1])).toEqual({ cube_id: app.cubeId });
    expect(app.lobby.tick(later(deadline + 1)).started).toEqual([]);
  });

  it("keeps unclaimed humans in confirmation details while skipping test bots", () => {
    const app = themeSetup("player_pick", ["host", "guest", `${TEST_BOT_DISCORD_PREFIX}1`]);
    app.claim(app.ids[0]);
    app.lobby.setReady(app.draft.id, "host", true, now);
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now)).toThrowError(
      expect.objectContaining({ code: "NOT_READY", notReadyPlayerIds: [app.ids[1]], unclaimedPlayerIds: [app.ids[1]] }),
    );
  });

  it.each(["player_pick", "random", "host_assigned"] as const)(
    "preserves deleted unused cubes and dormant assignment compatibility in %s", (selection) => {
      const app = themeSetup(selection);
      const missing = app.cubeId + 100;
      const config = { ...app.drafts.findById(app.draft.id).config,
        allowedCubeIds: [app.cubeId, missing], themeAssignments: { ...app.draft.config.themeAssignments,
          ...Object.fromEntries(app.ids.map((id) => [id, app.cubeId])), 999: missing } };
      app.db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(config), app.draft.id);
      app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision, force: true }, now);
      expect(app.lobby.tick(later(5000)).started).toHaveLength(1);
    },
  );

  it("never bypasses guild, pool or seat validation with force", () => {
    const app = themeSetup();
    app.db.prepare("update cubes set guild_id = 'foreign' where id = ?").run(app.cubeId);
    expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision, force: true }, now)).toThrowError(
      expect.objectContaining({ code: "PREFLIGHT_FAILED" }),
    );
    const thin = setup({ cubeCardIds: [1] });
    expect(() => thin.lobby.scheduleStart(thin.draft.id, "host", { revision: thin.read().lobby.revision, force: true }, now)).toThrowError(
      expect.objectContaining({ code: "PREFLIGHT_FAILED" }),
    );
  });

  it.each([{ packSize: 0 }, { packsPerPlayer: 0 }, { cardsPerPlayer: 0 }, { packSize: 2.5 }])(
    "blocks invalid booster numbers %j even with force", (config) => {
      const app = setup(config);
      expect(() => app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision, force: true }, now))
        .toThrowError(expect.objectContaining({ code: "PREFLIGHT_FAILED" }));
    },
  );

  it("requires full target for one 10 second auto countdown, holds persistently and resumes fresh", () => {
    const app = setup({ lobbySeats: 2 });
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    expect(app.read().lobby.start).toBeNull();
    app.ready();
    app.lobby.tick(now);
    const scheduled = app.read();
    expect(scheduled.lobby.start).toMatchObject({ kind: "auto", startsAt: later(10000).toISOString() });
    app.lobby.tick(later(2000));
    expect(app.read().lobby.start).toEqual(scheduled.lobby.start);
    app.lobby.stopStart(app.draft.id, "host", scheduled.lobby.start!.token, later(3000));
    const restarted = createDraftLobbyService(app.db);
    restarted.tick(later(11000));
    expect(app.read().lobby).toMatchObject({ start: null, autoStart: { held: true } });
    const resumed = restarted.setAutoStart(app.draft.id, "host", { enabled: true, held: false, revision: app.read().lobby.revision }, later(11000));
    expect(resumed.lobby.start!.startsAt).toBe(later(21000).toISOString());
    expect(restarted.tick(later(21000)).started).toHaveLength(1);
    expect(app.db.prepare("select lobby_auto_start, lobby_auto_held, lobby_start_token from drafts where id = ?").get(app.draft.id))
      .toEqual({ lobby_auto_start: 0, lobby_auto_held: 0, lobby_start_token: null });
  });

  it("does not auto-start underfilled or legacy lobbies and disables auto countdowns", () => {
    for (const lobbySeats of [4, undefined]) {
      const app = setup({ lobbySeats });
      app.ready();
      const state = app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
      expect(state.lobby.allReady).toBe(true);
      expect(state.lobby.autoStart.eligible).toBe(false);
      expect(app.lobby.tick(later(60000)).started).toEqual([]);
    }
    const app = setup({ lobbySeats: 2 });
    app.ready();
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    expect(app.lobby.setAutoStart(app.draft.id, "host", { enabled: false, revision: app.read().lobby.revision }, now).lobby.start).toBeNull();
  });

  it("holds through refetch and all Ready mutations until an explicit Resume", () => {
    const app = setup({ lobbySeats: 2 });
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, held: true, revision: app.read().lobby.revision }, now);
    app.ready();
    expect(app.lobby.tick(later(30000)).changedSlugs).toEqual([]);
    expect(app.read().lobby).toMatchObject({ start: null, autoStart: { eligible: true, held: true } });
    const resumed = app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, held: false, revision: app.read().lobby.revision }, later(30000));
    expect(resumed.lobby.start?.startsAt).toBe(later(40000).toISOString());
  });

  it("guards scheduled kernel starts and rejects wrong or superseded Stop tokens", () => {
    const app = setup();
    app.ready();
    const state = app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    expect(() => app.drafts.start(app.draft.id, later(5000))).toThrowError(expect.objectContaining({ code: "START_TOKEN_MISMATCH" }));
    expect(() => app.lobby.stopStart(app.draft.id, "host", "wrong", now)).toThrowError(expect.objectContaining({ code: "START_TOKEN_MISMATCH" }));
    app.lobby.stopStart(app.draft.id, "host", state.lobby.start!.token, now);
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    expect(() => app.lobby.stopStart(app.draft.id, "host", state.lobby.start!.token, now)).toThrowError(expect.objectContaining({ code: "START_TOKEN_MISMATCH" }));
  });

  it.each([false, true])("retries Stop without changing the revision or held state (auto=%s)", (auto) => {
    const app = setup({ lobbySeats: 2 });
    app.ready();
    const revision = app.read().lobby.revision;
    const scheduled = auto
      ? app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision }, now)
      : app.lobby.scheduleStart(app.draft.id, "host", { revision }, now);
    const token = scheduled.lobby.start!.token;
    const stopped = app.lobby.stopStart(app.draft.id, "host", token, later(1000));
    expect(stopped.lobby).toMatchObject({ start: null, autoStart: { enabled: auto, held: auto } });
    expect(app.lobby.stopStart(app.draft.id, "host", token, later(2000))).toEqual({
      ...stopped, lobby: { ...stopped.lobby, serverNow: later(2000).toISOString() },
    });
    expect(app.lobby.tick(later(20000))).toEqual({ started: [], changedSlugs: [] });
    expect(app.read().lobby.revision).toBe(stopped.lobby.revision);
    expect(() => app.lobby.stopStart(app.draft.id, "guest", token, now))
      .toThrowError(expect.objectContaining({ code: "HOST_REQUIRED" }));
  });

  it("holds a failed preflight after external edits and rolls back any partial deal", () => {
    const app = themeSetup();
    app.ids.forEach(app.claim);
    app.ready();
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    app.db.prepare("delete from cube_cards where cube_id = ?").run(app.cubeId);
    expect(app.lobby.tick(later(5000)).started).toEqual([]);
    expect(app.read().lobby).toMatchObject({ start: null, autoStart: { held: true }, lastStartError: expect.any(String) });
    expect(app.db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
    expect(app.lobby.tick(later(60000)).changedSlugs).toEqual([]);
  });

  it("rolls back a deal failure inside the kernel and persists the error without rearming", () => {
    const app = setup({ lobbySeats: 2 });
    app.ready();
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    app.db.exec("create trigger reject_second_pack before insert on draft_packs when new.origin_seat_index = 1 begin select raise(abort, 'Injected deal failure'); end");
    expect(app.lobby.tick(later(10000)).started).toEqual([]);
    expect(app.drafts.findById(app.draft.id).status).toBe("pending");
    expect(app.db.prepare("select count(*) as n from draft_deal").get()).toEqual({ n: 0 });
    expect(app.db.prepare("select count(*) as n from draft_packs").get()).toEqual({ n: 0 });
    expect(app.read().lobby).toMatchObject({ start: null, lastStartError: "Injected deal failure", autoStart: { held: true } });
  });

  it("returns only the requested slug from a GET fallback sweep", () => {
    const app = setup();
    app.ready();
    app.lobby.scheduleStart(app.draft.id, "host", { revision: app.read().lobby.revision }, now);
    const other = app.drafts.create("g", "c", "Other", app.draft.config, "host", app.ids[0]);
    app.drafts.join(other.id, app.ids[1]);
    app.lobby.scheduleStart(other.id, "host", { revision: app.lobby.read(other.id, "host", now).lobby.revision, force: true }, now);
    expect(app.lobby.tick(later(5000), app.draft.id).started.map((d) => d.id)).toEqual([app.draft.id]);
    expect(app.drafts.findById(other.id).status).toBe("pending");
  });

  it("cancels deadlines and auto flags on cancellation and rejects all pending mutations after start", () => {
    const app = setup({ lobbySeats: 2 });
    app.ready();
    app.lobby.setAutoStart(app.draft.id, "host", { enabled: true, revision: app.read().lobby.revision }, now);
    app.drafts.cancel(app.draft.id);
    expect(app.lobby.tick(later(60000)).started).toEqual([]);
    expect(app.db.prepare("select lobby_start_token,lobby_auto_start from drafts where id = ?").get(app.draft.id))
      .toEqual({ lobby_start_token: null, lobby_auto_start: 0 });
    expect(() => app.lobby.leave(app.draft.id, "guest", now)).toThrowError(expect.objectContaining({ code: "DRAFT_NOT_PENDING" }));
  });
});
