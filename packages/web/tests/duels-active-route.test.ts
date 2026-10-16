import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createDuelSeriesService, createPlayerService } from "@yugidraft/shared/services";
import type { DuelFormat } from "@yugidraft/shared/duels";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), membership: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: state.membership }));
vi.mock("@/lib/env", () => ({ env: { get discordGuildId() { return process.env.DISCORD_GUILD_ID ?? ""; } } }));

let duels: ReturnType<typeof createDuelService>;
let host: number;
let guest: number;
const userId = "196382527131222016";
const guestUserId = "196382527131222017";
const deck = { main: new Array(40).fill(1), extra: [], side: [] };

beforeEach(() => {
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  state.db = new Database(":memory:");
  migrate(state.db);
  // Numeric player IDs deliberately differ from the string Discord session IDs.
  state.db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(51,'g',?,'Host')").run(userId);
  host = 51;
  guest = createPlayerService(state.db).findOrCreate("g", guestUserId, "Guest").id;
  duels = createDuelService(state.db);
  state.auth.mockReset().mockResolvedValue({ user: { id: userId, name: "Host" } });
  state.membership.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No engine or Discord I/O expected"); }));
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function get(query = "") {
  const { GET } = await import("../app/api/duels/active/route");
  return GET(new NextRequest(`http://localhost/api/duels/active${query}`));
}

function room(format: DuelFormat = "1v1", vsBot = false) {
  const duel = duels.create({ guildId: "g", organizerPlayerId: host, name: "Table", mode: "normal", format });
  if (vsBot) duels.addPracticeBot(duel.slug, "g", host, deck);
  else duels.takeSeat(duel.slug, "g", guest, format === "1v1" ? 1 : 2);
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  while (duels.get(duel.slug, "g").seats.length < count) duels.addPracticeBot(duel.slug, "g", host, deck);
  for (const seat of duels.get(duel.slug, "g").seats) if (seat.playerId !== null) duels.setDeck(duel.slug, "g", seat.playerId, deck);
  return duel;
}

describe("GET /api/duels/active", () => {
  it("returns exactly null for a Discord member with no seat", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetch).not.toHaveBeenCalled();
    expect(state.membership).toHaveBeenCalledWith(expect.objectContaining({ guildId: "g", userId }));
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("returns the exact %s lobby and playing shapes through real actor resolution", async format => {
    const duel = room(format);
    expect(await (await get()).json()).toEqual({ active: { slug: duel.slug, state: "lobby", role: "host", format } });
    duels.activate(duel.slug, "g", host, ["s"], "v", null);
    expect(await (await get()).json()).toEqual({ active: { slug: duel.slug, state: "playing", role: "host", format } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a guest role without trusting client actor or guild parameters", async () => {
    const duel = room();
    state.auth.mockResolvedValue({ user: { id: guestUserId, name: "Guest" } });
    expect(await (await get(`?playerId=${host}&guildId=other`)).json())
      .toEqual({ active: { slug: duel.slug, state: "lobby", role: "guest", format: "1v1" } });
  });

  it("includes a playing practice bot game", async () => {
    const duel = room("1v1", true);
    duels.activate(duel.slug, "g", host, ["s"], "v", null);
    expect(await (await get()).json()).toEqual({ active: { slug: duel.slug, state: "playing", role: "host", format: "1v1" } });
  });

  it("leaves a sandbox owner free to navigate before and after start", async () => {
    const duel = duels.create({ guildId: "g", organizerPlayerId: host, name: "Sandbox", mode: "normal", sandbox: true });
    expect(await (await get()).json()).toEqual({ active: null });
    duels.setDeck(duel.slug, "g", host, deck);
    duels.addPracticeBot(duel.slug, "g", host, deck, 1);
    duels.activate(duel.slug, "g", host, ["s"], "v", null);
    expect(await (await get()).json()).toEqual({ active: null });
  });

  it("returns the playing game even if a newer lobby exists", async () => {
    const duel = room();
    duels.activate(duel.slug, "g", host, ["s"], "v", null);
    room();
    expect(await (await get()).json()).toEqual({ active: { slug: duel.slug, state: "playing", role: "host", format: "1v1" } });
  });

  it("does not claim a spectator seat, including on repeated reads", async () => {
    const duel = duels.create({ guildId: "g", organizerPlayerId: guest, name: "Watching", mode: "normal" });
    for (let i = 0; i < 2; i++) expect(await (await get()).json()).toEqual({ active: null });
    expect(duels.get(duel.slug, "g").seats).toHaveLength(1);
  });

  it.each(["completed", "interrupted", "cancelled"] as const)("ignores %s standalone games", async status => {
    const duel = room("ffa3");
    if (status === "cancelled") duels.cancel(duel.slug, "g", host);
    else {
      duels.activate(duel.slug, "g", host, ["s"], "v", null);
      if (status === "completed") duels.complete(duel.slug, "g", 0, "done");
      else duels.interrupt(duel.slug, "g", "stopped");
    }
    expect(await (await get()).json()).toEqual({ active: null });
  });

  it("keeps a best-of-3 active between games and after the next lobby is created", async () => {
    const series = createDuelSeriesService(state.db!);
    const match = series.createChallenge({ guildId: "g", challengerPlayerId: host, opponentPlayerId: guest, bestOf: 3, ranked: false, mode: "normal" });
    duels.setDeck(match.duel.slug, "g", host, deck);
    duels.setDeck(match.duel.slug, "g", guest, deck);
    duels.activate(match.duel.slug, "g", null, ["s"], "v", null);
    duels.complete(match.duel.slug, "g", match.duel.seats.find(s => s.playerId === host)!.seat, "done");
    expect(await (await get()).json()).toEqual({ active: { slug: match.duel.slug, state: "playing", role: "host", format: "1v1" } });
    const next = series.createNextGame(match.series.id, "g");
    expect(await (await get()).json()).toEqual({ active: { slug: next.slug, state: "playing", role: "host", format: "1v1" } });
  });

  it("does not expose a seat in another guild", async () => {
    const other = createPlayerService(state.db!).findOrCreate("other", userId, "Host");
    duels.create({ guildId: "other", organizerPlayerId: other.id, name: "Other guild", mode: "normal" });
    expect(await (await get()).json()).toEqual({ active: null });
  });

  it("rejects a signed-out request before checking Discord membership", async () => {
    state.auth.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(state.membership).not.toHaveBeenCalled();
  });

  it.each([403, 503] as const)("preserves Discord membership error %s", async status => {
    room();
    state.membership.mockResolvedValue({ ok: false, status });
    const response = await get();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: status === 403 ? "Forbidden" : "Guild membership is unavailable" });
  });

  it("rejects missing guild configuration", async () => {
    vi.stubEnv("DISCORD_GUILD_ID", "");
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Guild is not configured" });
  });
});
