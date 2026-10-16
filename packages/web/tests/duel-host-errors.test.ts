import { useRecordingObservability } from "../../shared/tests/helpers/recording-observability.mjs";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture((() => ({ auth: vi.fn() }))().auth);
});

const call = { op: "validate-deck" as const, slug: "abc", guildId: "guild-1", playerId: 1 };

async function loadHost() {
  // env binds process.env at module load.
  return import("../src/lib/duel-host");
}

describe("callDuelHost error messages", () => {
  beforeEach(async () => {
    vi.resetModules(); await recording.install();
    recording.report.mockClear().mockImplementation(() => {});
    process.env.DUEL_INTERNAL_URL = "http://duel.test:4003";
    process.env.DUEL_INTERNAL_SECRET = "s3cret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DUEL_INTERNAL_URL;
    delete process.env.DUEL_INTERNAL_SECRET;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["normalize-codes", "validate-deck-master"] as const)("times out stalled %s calls after twenty seconds", async op => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: unknown, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const { callDuelHost } = await loadHost();
    let settled = false;
    const pending = callDuelHost({ ...call, op, codes: [123], lookupLimit: 50 });
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    if (!settled) return;
    const result = await pending;
    if (result.ok) throw new Error("expected timeout");
    expect(result.response.status).toBe(503);
    expect((await result.response.json()).error).toContain("timed out");
    expect(fetchMock.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a stalled normalize-codes response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) })));
    const { callDuelHost } = await loadHost();
    const pending = callDuelHost({ ...call, op: "normalize-codes", codes: [123], lookupLimit: 50 });
    await vi.advanceTimersByTimeAsync(20000);
    const result = await pending;
    if (result.ok) throw new Error("expected timeout");
    expect(result.response.status).toBe(503);
    expect((await result.response.json()).error).toContain("timed out");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names the missing secret instead of 'not configured'", async () => {
    process.env.DUEL_INTERNAL_SECRET = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toContain("DUEL_INTERNAL_SECRET is missing");
    expect(body.error).not.toBe("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the engine did not answer when the host is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: /private/engine/path")));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toBe("The duel engine did not answer. It may be restarting. Try again in a moment.");
  });

  it("explains a secret mismatch instead of passing the host's 401 through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 })));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toContain("do not match");
  });

  it("returns a generic 500 for a non-JSON host error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fixture upstream detail", { status: 400 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(500);
    expect(await result.response.json()).toEqual({ error: "Something went wrong" });
  });

  it("keeps the host's own error text for rule errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Decks are locked after the duel starts" }, { status: 409 })));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({ error: "Decks are locked after the duel starts" });
  });

  it.each(["deck", "ready"] as const)("preserves the neutral start block in the %s route response", async op => {
    const payload = { session: { status: "lobby" }, startBlocked: "Start blocked: another player's deck needs attention." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    const host = await loadHost();
    vi.spyOn(host, "requireDuelActor").mockResolvedValue({
      ok: true, guildId: call.guildId, playerId: call.playerId, userId: call.playerId,
      duels: { touchWaiting: vi.fn(), room: () => ({ session: { status: "lobby" } }) } as never,
    });
    const { NextRequest } = await import("next/server");
    const request = new NextRequest("http://web.test/api/duels/abc", { method: "POST", body: "{}" });
    const { POST } = op === "deck" ? await import("../app/api/duels/[slug]/deck/route") : await import("../app/api/duels/[slug]/ready/route");
    const response = await POST(request, { params: Promise.resolve({ slug: call.slug }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it.each(["lobby", "between_games"] as const)("gets the owner's blocked-start notice from the host in %s room reads", async state => {
    const payload = { session: { status: state === "lobby" ? "lobby" : "completed" },
      startBlocked: { reason: "Move Fixture Spell to Main.", cardNames: ["Fixture Spell"] } };
    const fetch = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetch);
    const host = await loadHost();
    vi.spyOn(host, "requireDuelActor").mockResolvedValue({
      ok: true, guildId: call.guildId, playerId: call.playerId, userId: call.playerId,
      duels: { touchWaiting: vi.fn(), room: () => ({ session: payload.session, mySeat: 0,
        series: state === "between_games" ? { status: "between_games" } : null }) } as never,
    });
    const { GET } = await import("../app/api/duels/[slug]/route");
    const response = await GET(new Request("http://web.test/api/duels/abc"), { params: Promise.resolve({ slug: call.slug }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ op: "view", playerId: call.playerId });
  });

  it("preserves the neutral flag on the next lobby read after series advancement", async () => {
    const payload = { session: { status: "lobby", slug: "next-game" }, role: "player", mySeat: 1,
      startBlockedByOther: true };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    const host = await loadHost();
    vi.spyOn(host, "requireDuelActor").mockResolvedValue({
      ok: true, guildId: call.guildId, playerId: call.playerId, userId: call.playerId,
      duels: { touchWaiting: vi.fn(), room: () => ({ session: payload.session, mySeat: 1 }) } as never,
    });
    const { GET } = await import("../app/api/duels/[slug]/route");
    const response = await GET(new Request("http://web.test/api/duels/next-game"), { params: Promise.resolve({ slug: "next-game" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it.each(["lobby", "between_games"] as const)("returns the local %s room when the host is unavailable", async state => {
    const local = { session: { status: state === "lobby" ? "lobby" : "completed" }, mySeat: 0,
      role: "player", myDeck: { main: [901], extra: [], side: [] },
      series: state === "between_games" ? { status: "between_games" } : null };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const host = await loadHost();
    vi.spyOn(host, "requireDuelActor").mockResolvedValue({
      ok: true, guildId: call.guildId, playerId: call.playerId, userId: call.playerId,
      duels: { touchWaiting: vi.fn(), room: () => local } as never,
    });
    const { GET } = await import("../app/api/duels/[slug]/route");
    const response = await GET(new Request("http://web.test/api/duels/abc"), { params: Promise.resolve({ slug: call.slug }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(local);
  });

  it("keeps the seat-left code and text for duel answers", async () => {
    const body = { code: "seat_left", error: "That player has left. Pick again." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 400 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "respond" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual(body);
  });

  it("keeps the old response for a normal invalid answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Invalid answer" }, { status: 400 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "respond" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ error: "Invalid answer" });
  });

  it.each([
    ...["ENGINE_UNAVAILABLE_FOR_SOURCE", "REPLAY_MISMATCH", "NOT_PLAYABLE"].map(code => ({ status: 409, code })),
    { status: 413, code: "REPLAY_TOO_LARGE" },
  ].flatMap(error => ["available", "none"].map(finalBoard => ({ ...error, finalBoard }))))
  ("keeps finalBoard for a permitted $status: $code/$finalBoard", async ({ status, ...body }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Cannot replay", ...body }, { status })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "owner-replay" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual({ error: "Cannot replay", ...body });
  });

  it.each([
    { status: 403, code: "ACCESS_DENIED" }, { status: 404, code: "ACCESS_DENIED" },
    { status: 409, code: "ACCESS_DENIED" }, { status: 400, code: "INVALID_CURSOR" },
    { status: 503, code: "ENGINE_BUSY" }, { status: 409, code: "ENGINE_BUSY" },
    { status: 403, code: "NOT_PLAYABLE" }, { status: 500, code: "REPLAY_MISMATCH" },
    { status: 409, code: undefined },
    { status: 409, code: "REPLAY_TOO_LARGE" }, { status: 413, code: "ACCESS_DENIED" },
    { status: 413, code: "NOT_PLAYABLE" },
  ])("drops finalBoard on $status/$code", async ({ status, code }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Cannot replay", code, finalBoard: "available" }, { status })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "owner-replay" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).not.toHaveProperty("finalBoard");
  });

  it.each(["replay-fork", "fork-restart"] as const)("preserves only the recovery contract for a %s fork-limit error", async op => {
    const body = { error: "Replay fork limit reached. Cancel a fork and try again.", code: "FORK_LIMIT",
      limit: 4, forksUrl: "/api/admin/duels/forks" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...body, forks: [{ private: "fixture" }] }, { status: 429 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(429); expect(await result.response.json()).toEqual(body);
    expect(result.response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([0, -1, 4.5, "4"])("ignores an invalid fork quota %s", async limit => {
    const body = { error: "Fork limit", code: "FORK_LIMIT" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...body, limit, forksUrl: "/api/admin/duels/forks" }, { status: 429 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "replay-fork" });
    if (result.ok) throw new Error("expected failure");
    expect(await result.response.json()).toEqual(body);
  });

  it.each(["https://example.test/forks", "/api/other", null])("ignores an unexpected fork list URL %s", async forksUrl => {
    const body = { error: "Fork limit", code: "FORK_LIMIT" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...body, limit: 4, forksUrl }, { status: 429 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "replay-fork" });
    if (result.ok) throw new Error("expected failure");
    expect(await result.response.json()).toEqual(body);
  });

  it("does not attach fork recovery data to an engine-busy error", async () => {
    const body = { error: "A replay fork is still launching", code: "ENGINE_BUSY" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...body, limit: 4, forksUrl: "/api/admin/duels/forks" }, { status: 503 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "replay-fork" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503); expect(await result.response.json()).toEqual(body);
  });

  it("preserves a restart as a retryable 503 for duel answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "restarting" }, { status: 503 })));
    const { callDuelHost } = await loadHost();
    const result = await callDuelHost({ ...call, op: "respond" });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toEqual({ error: "restarting" });
  });

  it.each([
    { expected: true, message: "Practice bot failed to make progress" },
    { expected: false, message: "Something went wrong" },
  ])("classifies host 500s across the web boundary (expected=$expected)", async ({ expected, message }) => {
    const errors: unknown[] = [];
    recording.report.mockImplementation(error => { errors.push(error); });
    const { ExpectedError } = await import("@yugidraft/shared/observability");
    const { migrate } = await import("@yugidraft/shared/db");
    const { createDuelHost } = await import("../../duel-server/src/host");
    const directory = mkdtempSync(join(tmpdir(), "duel-host-errors-"));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "test", sources: {} }));
    const cards = new Database(join(directory, "cards.cdb"));
    cards.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text)");
    cards.close();
    const db = new Database(":memory:");
    migrate(db);
    const host = createDuelHost({ db, dataDirectory: directory, secret: "s3cret", searchCards: () => {
      throw expected ? new ExpectedError("Practice bot failed to make progress", 500) : new Error("fixture host detail");
    } });
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => host.handle(new Request("http://duel.test:4003/internal/duel", init)));
    try {
      const { callDuelHost } = await loadHost();
      const result = await callDuelHost({ op: "cards", guildId: call.guildId, playerId: call.playerId, query: "fixture" });
      if (result.ok) throw new Error("expected failure");
      expect(result.response.status).toBe(500);
      expect(await result.response.json()).toEqual({ error: message });
      expect(errors.length > 0).toBe(!expected);
    } finally {
      await host.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["view", "respond"] as const)("the room %s route surfaces a restart as 503", async op => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "restarting" }, { status: 503 })));
    const host = await loadHost();
    vi.spyOn(host, "requireDuelActor").mockResolvedValue({
      ok: true, guildId: call.guildId, playerId: call.playerId, userId: 7,
      duels: { touchWaiting: vi.fn(), room: () => ({ session: { status: "active" } }) } as never,
    });
    const context = { params: Promise.resolve({ slug: call.slug }) };
    let response: Response;
    if (op === "view") {
      const { GET } = await import("../app/api/duels/[slug]/route");
      response = await GET(new Request("http://web.test/api/duels/abc"), context);
    } else {
      const { NextRequest } = await import("next/server");
      const { POST } = await import("../app/api/duels/[slug]/actions/route");
      response = await POST(new NextRequest("http://web.test/api/duels/abc/actions", { method: "POST", body: "{}" }), context);
    }
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "restarting" });
  });

  it("transports the spectator view flag to the authenticated host", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ role: "spectator", mySeat: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { callDuelHost } = await loadHost();
    await callDuelHost({ ...call, op: "view", spectate: true });
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ op: "view", spectate: true });
    await callDuelHost({ ...call, op: "view" });
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).not.toHaveProperty("spectate");
  });

  it("carries the application user ID for the host mapping check", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { callDuelHost } = await loadHost();
    await callDuelHost({ ...call, userId: 7 });
    const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(payload).toMatchObject({ guildId: call.guildId, playerId: call.playerId, userId: 7 });
    expect(payload).not.toHaveProperty("isOwner");
  });
});

it("transports draft pool context and artwork-preserving normalization", async () => {
  process.env.DUEL_INTERNAL_URL = "http://duel.test";
  process.env.DUEL_INTERNAL_SECRET = "secret";
  vi.resetModules(); await recording.install();
  const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json({ codes: {} }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { callDuelHost } = await loadHost();
    await callDuelHost({ ...call, op: "check-deck", draftId: 7, format: "tag", settings: { genesys: { pointCap: 101 } } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({ draftId: 7, format: "tag", settings: { genesys: { pointCap: 101 } } });
    await callDuelHost({ ...call, op: "normalize-codes", codes: [10], preserveArtwork: true, lookupLimit: 50, includeCanonical: true });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toMatchObject({ preserveArtwork: true, codes: [10], lookupLimit: 50, includeCanonical: true });
    await callDuelHost({ ...call, op: "normalize-codes", codes: [10], lookupLimit: 0, cacheOnly: true });
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string)).toMatchObject({ lookupLimit: 0, cacheOnly: true });
  } finally { vi.unstubAllGlobals(); delete process.env.DUEL_INTERNAL_URL; delete process.env.DUEL_INTERNAL_SECRET; }
});

const recording = useRecordingObservability();
