import Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import type { OpenNow } from "../src/lib/open-now";
import { fixtureUserId, seedFixtureUsers } from "./fixtures/identity";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), denied: null as NextResponse | null }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/web-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/web-access")>();
  return { requireWebAccess: () => state.denied
    ? Promise.resolve({ ok: false, response: state.denied }) : original.requireWebAccess() };
});

beforeEach(() => {
  vi.resetModules();
  state.auth.mockReset();
  state.denied = null;
  state.db = new Database(":memory:");
  migrate(state.db);
  seedFixtureUsers(state.db, ["host", "viewer"]);
  state.auth.mockResolvedValue({ user: { id: String(fixtureUserId("viewer")), name: "Viewer" } });
  vi.stubEnv("DISCORD_GUILD_ID", "g");
});
afterEach(() => {
  state.db?.close();
  vi.unstubAllEnvs();
});

function seedOpen() {
  const db = state.db!;
  const host = Number(db.prepare("insert into players(guild_id, user_id, display_name) values ('g', ?, 'Host')")
    .run(fixtureUserId("host")).lastInsertRowid);
  const cup = Number(db.prepare(`insert into tournaments(guild_id, name, format, status, created_by_user_id, web_slug)
    values ('g', 'Cup', 'single_elimination', 'pending', ?, 'cup')`).run(fixtureUserId("host")).lastInsertRowid);
  const draft = Number(db.prepare(`insert into drafts(guild_id, name, status, created_by_user_id, web_slug, visibility)
    values ('g', 'Draft', 'pending', ?, 'draft', 'open')`).run(fixtureUserId("host")).lastInsertRowid);
  db.prepare("insert into tournament_participants(tournament_id, player_id) values (?, ?)").run(cup, host);
  db.prepare("insert into draft_players(draft_id, player_id) values (?, ?)").run(draft, host);
  db.prepare(`insert into duels(guild_id, web_slug, name, organizer_player_id, mode, status)
    values ('g', 'duel', 'Duel', ?, 'normal', 'active')`).run(host);
  db.prepare(`insert into tournaments(guild_id, name, format, status, created_by_user_id, web_slug)
    values ('other', 'Other cup', 'single_elimination', 'pending', ?, 'other-cup')`).run(fixtureUserId("host"));
  db.prepare(`insert into drafts(guild_id, name, status, created_by_user_id, web_slug, visibility)
    values ('other', 'Other draft', 'pending', ?, 'other-draft', 'open')`).run(fixtureUserId("host"));
  return { host, cup, draft };
}

describe("GET /api/lobby/open", () => {
  it("returns 401 without a session", async () => {
    state.auth.mockResolvedValue(null);
    const { GET } = await import("../app/api/lobby/open/route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(state.db!.prepare("select count(*) as n from players").get()).toEqual({ n: 0 });
  });

  it("passes a denied 403 response through unchanged", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    state.denied = denied;
    const { GET } = await import("../app/api/lobby/open/route");
    const response = await GET();
    expect(response).toBe(denied);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "denied" });
    expect(state.db!.prepare("select count(*) as n from players").get()).toEqual({ n: 0 });
  });

  it("returns 503 when session resolution is unavailable", async () => {
    state.auth.mockRejectedValue(new Error("Session unavailable"));
    const { GET } = await import("../app/api/lobby/open/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "session_unavailable" });
  });

  it.each([false, true])("returns OpenNow without creating a viewer's player (other-guild player: %s)", async (hasOtherPlayer) => {
    seedOpen();
    // This user has a player elsewhere; it must not resolve as this guild's viewer.
    if (hasOtherPlayer) {
      state.db!.prepare("insert into players(guild_id, user_id, display_name) values ('other', ?, 'Viewer')")
        .run(fixtureUserId("viewer"));
    }
    state.db!.pragma("query_only = ON");
    const { GET } = await import("../app/api/lobby/open/route");
    const response = await GET();
    const expected: OpenNow = {
      tournaments: [{ slug: "cup", name: "Cup", format: "single_elimination", joinedCount: 1, viewerJoined: false }],
      drafts: [{ slug: "draft", name: "Draft", mode: "booster", seatsTaken: 1, seatCount: null, viewerJoined: false }],
      duelsInProgress: 1,
    };
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(expected);
    expect(state.db!.prepare("select guild_id from players where user_id = ?").all(fixtureUserId("viewer")))
      .toEqual(hasOtherPlayer ? [{ guild_id: "other" }] : []);
    expect(state.db!.prepare("select count(*) as n from players").get()).toEqual({ n: hasOtherPlayer ? 2 : 1 });
  });

  it("resolves membership by application user ID and this guild's player ID", async () => {
    const { host } = seedOpen();
    state.auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), name: "Host" } });
    expect(host).not.toBe(fixtureUserId("host"));
    const { GET } = await import("../app/api/lobby/open/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tournaments: [{ viewerJoined: true }], drafts: [{ viewerJoined: true }],
    });
  });
});
