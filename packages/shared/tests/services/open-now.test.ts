import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createOpenNowService } from "../../src/services/open-now.js";
import { seedIdentity } from "../helpers/identity.js";

let db: Database.Database;
let host: ReturnType<typeof seedIdentity>;
let viewer: ReturnType<typeof seedIdentity>;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  host = seedIdentity(db, { guildId: "g", name: "Host" });
  viewer = seedIdentity(db, { guildId: "g", name: "Viewer" });
});
afterEach(() => db.close());

function tournament(slug: string, status = "pending", guild = "g", created = "2026-01-01 00:00:00") {
  return Number(db.prepare(`insert into tournaments
    (guild_id, name, format, status, created_by_user_id, web_slug, created_at, visibility)
    values (?, ?, 'round_robin', ?, ?, ?, ?, 'open')`).run(guild, slug, status, host.userId, slug, created).lastInsertRowid);
}

function draft(slug: string, config: object = {}, status = "pending", guild = "g", created = "2026-01-01 00:00:00") {
  return Number(db.prepare(`insert into drafts
    (guild_id, name, status, created_by_user_id, config_json, web_slug, created_at, visibility)
    values (?, ?, ?, ?, ?, ?, ?, 'open')`).run(guild, slug, status, host.userId, JSON.stringify(config), slug, created).lastInsertRowid);
}

function cube(guild = "g") {
  return Number(db.prepare("insert into cubes(guild_id, name, created_by_user_id) values (?, 'Theme ' || (select count(*) from cubes), ?)")
    .run(guild, host.userId).lastInsertRowid);
}

function duel(slug: string, options: { guild?: string; status?: string; private?: boolean; archived?: boolean; idle?: boolean } = {}) {
  return Number(db.prepare(`insert into duels
    (guild_id, web_slug, name, organizer_player_id, mode, status, settings_json, archived_at, last_activity_at)
    values (?, ?, ?, ?, 'normal', ?, ?, ?, datetime('now', ?))`)
    .run(options.guild ?? "g", slug, slug, host.playerId, options.status ?? "active",
      JSON.stringify({ visibility: options.private ? "private" : "public" }),
      options.archived ? "2026-01-01" : null, options.idle ? "-2 hours" : "-1 minute").lastInsertRowid);
}

describe("open now", () => {
  it("returns an empty result for an empty guild", () => {
    expect(createOpenNowService(db).forPlayer("g", null)).toEqual({ tournaments: [], drafts: [], duelsInProgress: 0 });
  });

  it("excludes private drafts before applying the newest-five limit, even for their host or grant holder", () => {
    const open = draft("open");
    for (let i=0;i<6;i++) {
      const id = draft(`private-${i}`,{},"pending","g","2026-01-09 00:00:00");
      db.prepare("update drafts set visibility='private' where id=?").run(id);
      db.prepare("insert into draft_invite_grants(draft_id,user_id) values(?,?)").run(id,viewer.userId);
    }
    for (const user of [null,host.playerId,viewer.playerId]) {
      expect(createOpenNowService(db).forPlayer("g",user).drafts.map(d => d.slug)).toEqual(["open"]);
    }
  });

  it("includes only pending, linked tournaments and drafts from this guild", () => {
    tournament("open-cup");
    draft("open-draft");
    tournament("other-cup", "pending", "other");
    draft("other-draft", {}, "pending", "other");
    for (const status of ["active", "completed", "cancelled"]) {
      tournament(`${status}-cup`, status);
      draft(`${status}-draft`, {}, status);
    }
    const unlinked = draft("unlinked");
    db.prepare("update drafts set web_slug = null where id = ?").run(unlinked);
    const unlinkedCup = tournament("unlinked-cup");
    db.prepare("update tournaments set web_slug = null where id = ?").run(unlinkedCup);
    expect(createOpenNowService(db).forPlayer("g", viewer.playerId)).toEqual({
      tournaments: [{ slug: "open-cup", name: "open-cup", format: "round_robin", joinedCount: 0, viewerJoined: false }],
      drafts: [{ slug: "open-draft", name: "open-draft", mode: "booster", seatsTaken: 0, seatCount: null, viewerJoined: false }],
      duelsInProgress: 0,
    });
  });

  it.each(["host", "viewer", "none"] as const)("counts participants and resolves membership for %s", (who) => {
    const cupId = tournament("cup");
    const draftId = draft("draft");
    db.prepare("insert into tournament_participants(tournament_id, player_id) values (?, ?)").run(cupId, host.playerId);
    db.prepare("insert into draft_players(draft_id, player_id) values (?, ?)").run(draftId, host.playerId);
    const viewerId = who === "host" ? host.playerId : who === "viewer" ? viewer.playerId : null;
    const result = createOpenNowService(db).forPlayer("g", viewerId);
    expect(result.tournaments[0]).toMatchObject({ joinedCount: 1, viewerJoined: who === "host" });
    expect(result.drafts[0]).toMatchObject({ seatsTaken: 1, viewerJoined: who === "host" });
  });

  it("excludes full unique-theme drafts but keeps unlimited booster and repeating-theme drafts", () => {
    const themes = [cube(), cube()];
    const full = draft("full", { mode: "theme", allowedCubeIds: themes });
    const overfull = draft("overfull", { mode: "theme", allowedCubeIds: [themes[0]] });
    const open = draft("open", { mode: "theme", allowedCubeIds: themes, uniqueThemes: true });
    const repeating = draft("repeating", { mode: "theme", allowedCubeIds: [themes[0]], uniqueThemes: false });
    const booster = draft("booster", { mode: "booster", allowedCubeIds: themes });
    const join = db.prepare("insert into draft_players(draft_id, player_id) values (?, ?)");
    for (const id of [full, overfull, repeating, booster]) {
      join.run(id, host.playerId);
      join.run(id, viewer.playerId);
    }
    join.run(open, host.playerId);
    expect(createOpenNowService(db).forPlayer("g", null).drafts).toEqual([
      { slug: "booster", name: "booster", mode: "booster", seatsTaken: 2, seatCount: null, viewerJoined: false },
      { slug: "repeating", name: "repeating", mode: "theme", seatsTaken: 2, seatCount: null, viewerJoined: false },
      { slug: "open", name: "open", mode: "theme", seatsTaken: 1, seatCount: 2, viewerJoined: false },
    ]);
    expect(createOpenNowService(db).forPlayer("g", host.playerId).drafts.map((row) => row.slug))
      .toEqual(["booster", "repeating", "open"]);
  });

  it("does not count duplicate, deleted, or other-guild themes as available seats", () => {
    const theme = cube();
    const full = draft("unavailable", { mode: "theme", allowedCubeIds: [theme, theme, cube("other"), 99999] });
    db.prepare("insert into draft_players(draft_id, player_id) values (?, ?)").run(full, host.playerId);
    draft("no-themes", { mode: "theme" });
    expect(createOpenNowService(db).forPlayer("g", null).drafts).toEqual([]);
  });

  it("limits each list to five newest by creation time, breaking ties by id", () => {
    for (const [name, date] of [
      ["newest", "2026-01-08 00:00:00"], ["old", "2026-01-01 00:00:00"],
      ["two", "2026-01-02 00:00:00"], ["three", "2026-01-03 00:00:00"],
      ["four", "2026-01-04 00:00:00"], ["tie-first", "2026-01-05 00:00:00"],
      ["tie-last", "2026-01-05 00:00:00"],
    ]) {
      tournament(name, "pending", "g", date);
      draft(name, {}, "pending", "g", date);
    }
    // Filtering must happen before the limit.
    for (let i = 0; i < 6; i++) draft(`full-${i}`, { mode: "theme", allowedCubeIds: [] }, "pending", "g", "2026-01-09 00:00:00");
    const result = createOpenNowService(db).forPlayer("g", null);
    expect(result.tournaments.map((row) => row.slug)).toEqual(["newest", "tie-last", "tie-first", "four", "three"]);
    expect(result.drafts.map((row) => row.slug)).toEqual(["newest", "tie-last", "tie-first", "four", "three"]);
  });

  it.each([0, 1])("excludes the viewer's active duel when seated in seat %s", (seat) => {
    const ownId = duel("own");
    db.prepare("insert into duel_seats(duel_id, seat, player_id) values (?, ?, ?)")
      .run(ownId, seat, viewer.playerId);
    duel("other-visible");
    const service = createOpenNowService(db);
    expect(service.forPlayer("g", viewer.playerId).duelsInProgress).toBe(1);
    expect(service.forPlayer("g", null).duelsInProgress).toBe(2);
  });

  it("counts only visible active, unarchived duels under the lobby's idle rules", () => {
    duel("public");
    const privateId = duel("private", { private: true });
    const idleId = duel("idle", { idle: true });
    duel("other", { guild: "other" });
    duel("archived", { archived: true });
    for (const status of ["lobby", "completed", "cancelled"]) duel(status, { status });
    const service = createOpenNowService(db);
    expect(service.forPlayer("g", null).duelsInProgress).toBe(1);
    expect(service.forPlayer("g", viewer.playerId).duelsInProgress).toBe(1);
    db.prepare("insert into duel_invite_grants(duel_id, player_id) values (?, ?)")
      .run(privateId, viewer.playerId);
    expect(service.forPlayer("g", viewer.playerId).duelsInProgress).toBe(2);
    db.prepare("insert into duel_seats(duel_id, seat, player_id) values (?, 0, ?)").run(idleId, viewer.playerId);
    expect(service.forPlayer("g", viewer.playerId).duelsInProgress).toBe(2);
    expect(service.forPlayer("g", host.playerId).duelsInProgress).toBe(3);
    expect(service.forPlayer("empty", null).duelsInProgress).toBe(0);
  });

  it("orders timestamps chronologically even within one second and across timestamp formats", () => {
    for (const [name, date] of [
      ["latest", "2026-01-01T12:00:00.900Z"],
      ["earlier", "2026-01-01T12:00:00.100Z"],
      ["sqlite-time", "2026-01-01 12:00:00"],
    ]) {
      tournament(name, "pending", "g", date);
      draft(name, {}, "pending", "g", date);
    }
    const result = createOpenNowService(db).forPlayer("g", null);
    expect(result.tournaments.map((row) => row.slug)).toEqual(["latest", "earlier", "sqlite-time"]);
    expect(result.drafts.map((row) => row.slug)).toEqual(["latest", "earlier", "sqlite-time"]);
  });

  it("works with a database connection that rejects every write", () => {
    tournament("cup");
    draft("draft");
    db.pragma("query_only = ON");
    expect(createOpenNowService(db).forPlayer("g", null)).toMatchObject({
      tournaments: [{ slug: "cup" }], drafts: [{ slug: "draft" }], duelsInProgress: 0,
    });
  });
});

it("excludes private tournaments before limiting open-now, including their hosts and grant holders", () => {
  tournament("open");
  for (let i=0;i<6;i++) {
    const id = tournament(`private-${i}`, "pending", "g", "2026-01-09 00:00:00");
    db.prepare("update tournaments set visibility='private' where id=?").run(id);
    db.prepare("insert into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(id,viewer.userId);
  }
  for (const user of [null,host.playerId,viewer.playerId]) expect(createOpenNowService(db).forPlayer("g",user).tournaments.map(t=>t.slug)).toEqual(["open"]);
});
