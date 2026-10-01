import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createTournamentService } from "@yugidraft/shared/services";

const auth = vi.fn();
const announcer = { announce: vi.fn(async (..._args: unknown[]) => ({ ok: true as const })) };
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer, broadcaster }));
const notifyDuelChange = vi.fn(async (_slug: string, _guildId: string) => {});
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));
const tempDirs: string[] = [];

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "tduel-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  process.env.DISCORD_TOKEN = "bot-token";
  process.env.NEXTAUTH_URL = "https://duel.example.com/";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const organizer = Number(insert.run("u-org", "Organizer").lastInsertRowid);
  const a = Number(insert.run("u-a", "Alice").lastInsertRowid);
  const b = Number(insert.run("u-b", "Bob").lastInsertRowid);
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Online Cup", "round_robin", "u-org");
  db.prepare("update tournaments set web_slug = 'cup' where id = ?").run(tour.id);
  tournaments.join(tour.id, a);
  tournaments.join(tour.id, b);
  tournaments.start(tour.id);
  // Both players registered a deck, so a series can start.
  const deckJson = JSON.stringify({ main: [], extra: [], side: [] });
  db.prepare("update tournament_participants set deck_json = ? where tournament_id = ?").run(deckJson, tour.id);
  const slot = db.prepare("select id from tournament_matches where tournament_id = ? order by id limit 1").get(tour.id) as { id: number };
  return { db, organizer, a, b, tournamentId: tour.id, tmId: slot.id };
}

const ctx = (tmId: number) => ({ params: Promise.resolve({ slug: "cup", tmId: String(tmId) }) });
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

describe("tournament match duel and result routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    announcer.announce.mockClear();
    broadcaster.tournament.mockClear();
    notifyDuelChange.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });
  afterEach(() => {
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "DISCORD_TOKEN", "NEXTAUTH_URL"]) delete process.env[key];
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("result: rejects an unauthenticated caller and a bad body", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue(null);
    expect((await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId))).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "u-org", name: "Organizer" } });
    expect((await POST(post({}), ctx(s.tmId))).status).toBe(400);
    expect((await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId + 999))).status).toBe(404);
  });

  it("result: only the organizer can set it", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue({ user: { id: "u-a", name: "Alice" } });
    const res = await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId));
    expect(res.status).toBe(403);
    expect(broadcaster.tournament).not.toHaveBeenCalled();
  });

  it("result: the organizer sets a winner and the web is told", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/result/route");
    auth.mockResolvedValue({ user: { id: "u-org", name: "Organizer" } });
    const res = await POST(post({ winnerPlayerId: s.a }), ctx(s.tmId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "match-updated", slug: "cup" });
    const slot = s.db.prepare("select status from tournament_matches where id = ?").get(s.tmId) as { status: string };
    expect(slot.status).toBe("completed");
    const match = s.db
      .prepare("select m.winner_id from matches m join tournament_matches t on t.match_id = m.id where t.id = ?")
      .get(s.tmId) as { winner_id: number };
    expect(match.winner_id).toBe(s.a);
  });

  it("duel: starts a series, DMs the other player once and returns the existing one after", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: "u-a", name: "Alice" } });
    const first = await POST(post({}), ctx(s.tmId));
    expect(first.status).toBe(201);
    const body = (await first.json()) as { series: { bestOf: number }; duel: { slug: string }; created: boolean };
    expect(body.created).toBe(true);
    await vi.waitFor(() => expect(announcer.announce).toHaveBeenCalledTimes(1));
    expect(announcer.announce.mock.calls[0][0]).toMatchObject({
      kind: "duel-invite",
      guildId: "g1",
      opponentDiscordUserId: "u-b",
      challengerName: "Alice",
      tournamentName: "Online Cup",
      url: `https://duel.example.com/duels/${body.duel.slug}`,
    });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "match-updated", slug: "cup" });

    const second = await POST(post({}), ctx(s.tmId));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { created: boolean }).created).toBe(false);
    expect(announcer.announce).toHaveBeenCalledTimes(1);
  });

  it("duel: an outsider cannot start the series", async () => {
    const s = seed();
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: "u-x", name: "Outsider" } });
    const res = await POST(post({}), ctx(s.tmId));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(announcer.announce).not.toHaveBeenCalled();
  });
  async function startSeries(s: ReturnType<typeof seed>) {
    const { POST } = await import("../app/api/tournaments/[slug]/matches/[tmId]/duel/route");
    auth.mockResolvedValue({ user: { id: "u-a", name: "Alice" } });
    const res = await POST(post({}), ctx(s.tmId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { series: { id: number }; duel: { slug: string } };
    notifyDuelChange.mockClear();
    broadcaster.tournament.mockClear();
    return body;
  }

  const seriesStatus = (s: ReturnType<typeof seed>, id: number) =>
    (s.db.prepare("select status from duel_series where id = ?").get(id) as { status: string }).status;

  it("DELETE: cancels the tournament, closes the open series and notifies each game", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { DELETE } = await import("../app/api/tournaments/[slug]/route");
    auth.mockResolvedValue({ user: { id: "u-org", name: "Organizer" } });
    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ slug: "cup" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("cancelled");
    expect(seriesStatus(s, started.series.id)).toBe("cancelled");
    expect(
      (s.db.prepare("select status, ended_at from tournaments where id = ?").get(s.tournamentId) as { status: string; ended_at: string | null }),
    ).toMatchObject({ status: "cancelled", ended_at: expect.any(String) });
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "cancelled", slug: "cup" });
    expect(notifyDuelChange.mock.calls).toEqual([[started.duel.slug, "g1"]]);
  });

  it("DELETE: a non-creator and a closed tournament change nothing", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { DELETE } = await import("../app/api/tournaments/[slug]/route");
    const del = () => DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ slug: "cup" }) });
    auth.mockResolvedValue({ user: { id: "u-a", name: "Alice" } });
    expect((await del()).status).toBe(403);
    expect(seriesStatus(s, started.series.id)).not.toBe("cancelled");
    auth.mockResolvedValue({ user: { id: "u-org", name: "Organizer" } });
    expect((await del()).status).toBe(200);
    notifyDuelChange.mockClear();
    expect((await del()).status).toBe(400);
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("complete: ends the tournament, closes the open series and notifies each game", async () => {
    const s = seed();
    const started = await startSeries(s);
    const { POST } = await import("../app/api/tournaments/[slug]/complete/route");
    auth.mockResolvedValue({ user: { id: "u-org", name: "Organizer" } });
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ slug: "cup" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("completed");
    expect(seriesStatus(s, started.series.id)).toBe("cancelled");
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "completed", slug: "cup" });
    expect(notifyDuelChange.mock.calls).toEqual([[started.duel.slug, "g1"]]);
  });

  it("GET: rulesLocked turns true once a series exists", async () => {
    const s = seed();
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const get = async () =>
      ((await (await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "cup" }) })).json()) as { rulesLocked: boolean }).rulesLocked;
    expect(await get()).toBe(false);
    await startSeries(s);
    expect(await get()).toBe(true);
  });
});
