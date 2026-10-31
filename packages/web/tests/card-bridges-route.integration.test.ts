import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeDeepSearchRequest } from "../src/lib/bridges-api";
import type { DeckCardInfo } from "@yugidraft/shared/duels";

const state = vi.hoisted(() => ({ auth: vi.fn(), db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});

const secret = "bridge-route-fixture-secret";
let calls: Record<string, unknown>[];
let reply: unknown;
let replyStatus: number;
const hash = "a".repeat(64);
const shown = () => ({ source: "Odion", target: "Argostars", format: "advanced", score: 70, raw_score: 72,
  target_mean: 2, two_way: false, grade: "Good", reasons: [], cards: [123], warnings: [], genesys_points: null,
  validation: "deterministic", judge: "accepted", engine_status: "unverified", evidence_hash: hash, missing: [123], alreadyInDeck: false,
  review: { grade: "good", pros: ["Turns on the Traps.", "Shares its starter."], cons: ["Needs Temple.", "Uses deck space."], lock_note: "No summon lock.", line: ["Temple of the Kings"], steps: [{ card: "Temple of the Kings", text: "" }] } });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  vi.stubEnv("OWNER_USER_IDS", "1");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.internal:4003");
  vi.stubEnv("DUEL_INTERNAL_SECRET", secret);
  state.auth.mockReset().mockResolvedValue({ user: { id: "1", name: "Yugi", discordUserId: null } });
  state.db = new Database(":memory:"); migrate(state.db);
  state.db.exec(`INSERT INTO users(id,username,display_name) VALUES(1,'yugi','Yugi'),(2,'kaiba','Kaiba');
    INSERT INTO players(id,guild_id,discord_user_id,display_name,user_id) VALUES(11,'guild-1','d1','Yugi',1),(12,'other','d2','Kaiba',2)`);
  calls = []; reply = { results: [shown()], inReview: 0 }; replyStatus = 200;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const signed = await readSignedRequest(new Request(url, init), { secret, purpose: "duel-host" });
    expect(signed.ok).toBe(true);
    if (signed.ok) calls.push(signed.body as Record<string, unknown>);
    return Response.json(reply, { status: replyStatus });
  });
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function lookup(query = "source=Odion") {
  const { GET } = await import("../app/api/cards/bridges/route");
  return GET(new Request(`http://web.test/api/cards/bridges?${query}`));
}
async function list(value: unknown) {
  const { POST } = await import("../app/api/cards/bridges/route");
  return POST(new Request("http://web.test/api/cards/bridges", { method: "POST", body: JSON.stringify(value) }));
}
async function start(value: unknown) {
  const { POST } = await import("../app/api/cards/bridges/deep-search/route");
  return POST(new Request("http://web.test/api/cards/bridges/deep-search", { method: "POST", body: JSON.stringify(value) }));
}
async function poll(jobId = "bridge-job-1", query = "") {
  const { GET } = await import("../app/api/cards/bridges/deep-search/[jobId]/route");
  return GET(new Request(`http://web.test/api/cards/bridges/deep-search/${jobId}${query}`), { params: Promise.resolve({ jobId }) });
}
async function feedback(value: unknown) {
  const { POST } = await import("../app/api/cards/bridges/feedback/route");
  return POST(new Request("http://web.test/api/cards/bridges/feedback", { method: "POST", body: JSON.stringify(value) }));
}

async function engines(value: unknown) {
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  return POST(new Request("http://web.test/api/cards/bridges/engines", { method: "POST", body: JSON.stringify(value) }));
}

it("runs the browser list helper with open deck context through the signed-host route", async () => {
  const { fetchBridges } = await import("../src/lib/bridges-api");
  const { POST } = await import("../app/api/cards/bridges/route");
  const hostFetch = globalThis.fetch;
  let browserSignal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url !== "/api/cards/bridges") return hostFetch(url, init);
    browserSignal = init.signal;
    return POST(new Request(`http://web.test${url}`, init));
  });
  const request = { source: "Odion", target: "Argostars", format: "genesys" as const,
    deck: { main: [123], extra: [], deckMaster: 1710647, pointCap: 250 }, genesysRemaining: 0 };
  reply = { results: [{ ...shown(), format: "genesys", missing: [], alreadyInDeck: true }], reverse: [], inReview: 0 };
  const controller = new AbortController();
  expect(await fetchBridges(request, controller.signal)).toEqual(reply);
  expect(browserSignal).toBe(controller.signal);
  expect(calls[0]).toEqual({ op: "bridges", guildId: "guild-1", userId: 1, playerId: 11,
    bridgeRequest: { ...request, op: "between" } });
  replyStatus = 503; reply = { error: "Bridge list is busy", retryAfter: 1 };
  await expect(fetchBridges(request)).rejects.toMatchObject({ message: "Bridge list is busy", status: 503, retryAfter: 1 });
});

it("accepts bounded list context, preserves legacy GET and rejects malformed POST controls", async () => {
  const deck = { main: [123], extra: [], pointCap: 250 };
  const response = await list({ source: " Odion ", deck });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(calls[0].bridgeRequest).toEqual({ op: "from", source: "Odion", deck, format: "advanced" });
  expect((await list({ deckId: 23 })).status).toBe(200);
  expect(calls[1].bridgeRequest).toEqual({ op: "from", deckId: 23, format: "advanced" });
  for (const genesysRemaining of [0, 1000]) {
    expect((await list({ source: "Odion", deck, genesysRemaining })).status).toBe(200);
    expect(calls.at(-1)!.bridgeRequest).toMatchObject({ deck, genesysRemaining });
  }
  expect((await lookup()).status).toBe(200);
  expect(calls.at(-1)!.bridgeRequest).toEqual({ op: "from", source: "Odion", format: "advanced" });
  const forwarded = calls.length;
  for (const value of [{}, { deck }, { source: "Odion", deckId: 23 }, { deckId: 23, deck },
    { source: "Odion", deck: null }, { source: "Odion", deck: { ...deck, side: [] } },
    { source: "Odion", deck: { main: Array(92).fill(1), extra: [] } },
    ...[0, -1, 0.5, 0x100000000, "123"].map(id => ({ source: "Odion", deck: { main: [id], extra: [] } })),
    ...[-1, 1001, 0.5, "100", null].map(pointCap => ({ source: "Odion", deck: { ...deck, pointCap } })),
    ...[-1, 1001, 0.5, "0", null].map(genesysRemaining => ({ source: "Odion", deck, genesysRemaining })),
    { source: "Odion", userId: 2 }, { source: "Odion", op: "start" }, { source: "Odion", engines: ["Ashtra"] },
    { source: "Odion", format: "normal" }, { source: "x".repeat(121) }]) {
    expect((await list(value)).status, JSON.stringify(value)).toBe(400);
  }
  const { POST } = await import("../app/api/cards/bridges/route");
  for (const body of ["{", "null", "[]"]) {
    expect((await POST(new Request("http://web.test/api/cards/bridges", { method: "POST", body }))).status).toBe(400);
  }
  expect((await POST(new Request("http://web.test/api/cards/bridges?source=Odion", { method: "POST", body: JSON.stringify({ source: "Odion", deck }) }))).status).toBe(400);
  expect((await POST(new Request("http://web.test/api/cards/bridges", { method: "POST", body: JSON.stringify({ source: "Odion", padding: "x".repeat(4096) }) }))).status).toBe(413);
  expect((await lookup(`source=Odion&deck=${encodeURIComponent(JSON.stringify(deck))}`)).status).toBe(400);
  expect(calls).toHaveLength(forwarded);
  state.auth.mockResolvedValue(null);
  expect((await list({ source: "Odion", deck })).status).toBe(401);
  expect(calls).toHaveLength(forwarded);
});

it("forwards bounded open decks and corrected engines without exposing pending rows", async () => {
  const deck = { main: [29762407, 97522863], extra: [], deckMaster: 1710647, pointCap: 250 };
  reply = { engines: ["Ashtra", "Odion"], detected: [], between: [], next: [], inReview: 3 };
  expect((await engines({ deck, engines: ["Odion", "Ashtra"], format: "advanced" })).status).toBe(200);
  expect(calls[0].bridgeRequest).toEqual({ op: "engines", deck, engines: ["Odion", "Ashtra"], format: "advanced" });
  for (const genesysRemaining of [0, 1000]) {
    const request = { deck, engines: ["Odion"], format: "genesys", genesysRemaining };
    expect((await engines(request)).status).toBe(200);
    expect(calls.at(-1)!.bridgeRequest).toEqual({ ...request, op: "engines" });
  }
  const forwarded = calls.length;
  for (const genesysRemaining of [-1, 1001, 0.5, "100", null, true, {}, Number.MAX_SAFE_INTEGER]) {
    expect((await engines({ deck, engines: ["Odion"], format: "genesys", genesysRemaining })).status).toBe(400);
  }
  expect(calls).toHaveLength(forwarded);
  for (const value of [{}, { format: "advanced" }, { engines: [], format: "advanced" }, { engines: Array(5).fill("Odion"), format: "advanced" },
    { engines: ["Odion"], format: "advanced", userId: 2 }, { deck: { ...deck, side: [] }, format: "advanced" },
    { deck: { main: Array(92).fill(1), extra: [] }, format: "advanced" }, { deck: { main: [-1], extra: [] }, format: "advanced" }]) {
    expect((await engines(value)).status).toBe(400);
  }
  for (const pointCap of [-1, 1001, 0.5, "100"]) expect((await engines({ deck: { ...deck, pointCap }, format: "advanced" })).status).toBe(400);
  const next = { engine: "Argostars", score: 8, grade: "Good", tier: "strict", covered: 1, of: 1, twoWay: [],
    links: [{ from: "Odion", to: "Argostars", bridge: shown() }], cards: [123], missing: [123], alreadyInDeck: false, genesysPoints: null, pros: [], cons: [] };
  reply = { engines: ["Odion"], between: [], next: [next], inReview: 0 };
  expect((await engines({ engines: ["Odion"], format: "advanced" })).status).toBe(200);
  for (const owned of [true, false]) {
    reply = { engines: ["Odion"], between: [], next: [{ ...next, missing: owned ? [] : [123], alreadyInDeck: owned,
      links: [{ ...next.links[0], bridge: { ...shown(), missing: owned ? [] : [123], alreadyInDeck: owned } }] }], inReview: 0 };
    expect((await engines({ engines: ["Odion"], format: "advanced" })).status).toBe(200);
  }
  for (const invalid of [{ missing: [123], alreadyInDeck: true }, { missing: [], alreadyInDeck: false },
    { missing: [999], alreadyInDeck: false }, { missing: [], alreadyInDeck: "true" }]) {
    reply = { engines: ["Odion"], between: [], next: [{ ...next, ...invalid }], inReview: 0 };
    expect((await engines({ engines: ["Odion"], format: "advanced" })).status).toBe(502);
    reply = { results: [{ ...shown(), ...invalid }], inReview: 0 };
    expect((await lookup()).status).toBe(502);
  }
  reply = { ...reply as object, next: [{ ...next, links: [{ ...next.links[0], bridge: { ...shown(), judge: "pending" } }] }] };
  expect((await engines({ engines: ["Odion"], format: "advanced" })).status).toBe(502);
});

it("runs the browser engines helper through the authenticated signed-host route", async () => {
  const { fetchBridgeEngines } = await import("../src/lib/bridges-api");
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  const signedHostFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => url === "/api/cards/bridges/engines"
    ? POST(new Request(`http://web.test${url}`, init)) : signedHostFetch(url, init));
  const request = { engines: ["Odion"], deck: { main: [29762407], extra: [], pointCap: 250 }, format: "genesys" as const, genesysRemaining: 0 };
  reply = { engines: ["Odion"], detected: [], between: [], next: [], inReview: 1 };
  expect(await fetchBridgeEngines(request)).toEqual(reply);
  expect(calls[0].bridgeRequest).toEqual({ ...request, op: "engines" });
  reply = { results: [], inReview: 0 };
  await expect(fetchBridgeEngines({ engines: ["Odion"], format: "advanced" })).rejects.toMatchObject({ status: 502 });
});

it("keeps first engines and list requests loading past the old five-second timeout", async () => {
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  const { GET } = await import("../app/api/cards/bridges/route");
  const hostFetch = globalThis.fetch;
  let started!: () => void;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    started();
    await new Promise(resolve => setTimeout(resolve, 6000));
    return hostFetch(url, init);
  });
  vi.useFakeTimers();
  try {
    for (const op of ["engines", "from", "between"]) {
      reply = op === "engines" ? { engines: ["Odion"], between: [], next: [], inReview: 0 } : { results: [], inReview: 0 };
      const ready = new Promise<void>(resolve => { started = resolve; });
      const pending = op === "engines"
        ? POST(new Request("http://web.test/api/cards/bridges/engines", { method: "POST", body: JSON.stringify({ engines: ["Odion"], format: "advanced" }) }))
        : GET(new Request(`http://web.test/api/cards/bridges?source=Odion${op === "between" ? "&target=Argostars" : ""}`));
      let settled = false;
      void pending.then(() => { settled = true; });
      await ready;
      await vi.advanceTimersByTimeAsync(5000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(reply);
    }
  } finally { vi.useRealTimers(); }
});

it("keeps the browser engines promise loading through retryable host responses", async () => {
  const { fetchBridgeEngines } = await import("../src/lib/bridges-api");
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  const hostFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => url === "/api/cards/bridges/engines"
    ? POST(new Request(`http://web.test${url}`, init)) : hostFetch(url, init));
  replyStatus = 503; reply = { error: "Bridge query timed out. Try again shortly.", retryAfter: 1 };
  const query = { engines: ["Odion"], format: "advanced" as const };
  const loading = await engines(query);
  expect(loading.status).toBe(202);
  expect(loading.headers.get("retry-after")).toBe("1");
  expect(await loading.json()).toEqual({ state: "loading", retryAfter: 1 });
  replyStatus = 200; reply = { state: "loading", retryAfter: 2 };
  const forwarded = await engines(query);
  expect(forwarded.status).toBe(202);
  expect(forwarded.headers.get("retry-after")).toBe("2");
  expect(await forwarded.json()).toEqual(reply);
  replyStatus = 503; reply = { error: "Bridge query timed out. Try again shortly.", retryAfter: 1 };
  vi.useFakeTimers();
  try {
    let settled = false;
    const pending = fetchBridgeEngines(query);
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    replyStatus = 200; reply = { engines: ["Odion"], between: [], next: [], inReview: 0 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(reply);

    replyStatus = 503; reply = { error: "Bridge scanner queue is busy", retryAfter: 1 };
    const controller = new AbortController();
    const cancelled = fetchBridgeEngines(query, controller.signal);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    const count = calls.length;
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(count);
  } finally { vi.useRealTimers(); }
});

it("rejects malformed loading responses and preserves permanent engines failures", async () => {
  const { fetchBridgeEngines } = await import("../src/lib/bridges-api");
  const query = { engines: ["Odion"], format: "advanced" as const };
  replyStatus = 503; reply = { error: "Bridge data is unavailable" };
  expect((await engines(query)).status).toBe(503);
  for (const retryAfter of [0, -1, 11, 1.5, "1", null, undefined]) {
    vi.stubGlobal("fetch", async () => Response.json({ state: "loading", retryAfter }, { status: 202 }));
    await expect(fetchBridgeEngines(query)).rejects.toMatchObject({ status: 502 });
  }
});

it("cancels signed-host engine work when the browser request is aborted", async () => {
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let hostSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect((await readSignedRequest(new Request(url, init), { secret, purpose: "duel-host" })).ok).toBe(true);
    hostSignal = init.signal as AbortSignal;
    return new Promise<Response>((_, reject) => {
      hostSignal!.addEventListener("abort", () => reject(hostSignal!.reason), { once: true });
      started();
    });
  });
  const controller = new AbortController();
  const pending = POST(new Request("http://web.test/api/cards/bridges/engines", { method: "POST",
    body: JSON.stringify({ engines: ["Odion"], format: "advanced" }), signal: controller.signal }));
  await ready;
  controller.abort();
  expect((await pending).status).toBe(503);
  expect(hostSignal?.aborted).toBe(true);
});

it("quietly cancels a live host request with Next's empty ResponseAborted reason", async () => {
  const { createServer } = await import("node:http");
  const { ResponseAborted } = await import("next/dist/server/web/spec-extension/adapters/next-request");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const host = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const signed = await readSignedRequest(new Request("http://host.test/internal/duel", {
      method: "POST", headers: request.headers as Record<string, string>, body: Buffer.concat(chunks),
    }), { secret, purpose: "duel-host" });
    expect(signed.ok).toBe(true);
    started();
    response.once("close", () => response.end());
  });
  await new Promise<void>(resolve => host.listen(0, "127.0.0.1", resolve));
  const address = host.address() as { port: number };
  vi.stubEnv("DUEL_INTERNAL_URL", `http://127.0.0.1:${address.port}`);
  vi.unstubAllGlobals();
  try {
    const { POST } = await import("../app/api/cards/bridges/engines/route");
    const controller = new AbortController();
    const pending = POST(new Request("http://web.test/api/cards/bridges/engines", { method: "POST",
      body: JSON.stringify({ engines: ["Sinful Spoils"], format: "advanced" }), signal: controller.signal }));
    await ready;
    expect(new ResponseAborted().message).toBe("");
    controller.abort(new ResponseAborted());
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("cancelled") });
    expect(errors).not.toHaveBeenCalled();
  } finally {
    host.closeAllConnections();
    await new Promise<void>(resolve => host.close(() => resolve()));
    errors.mockRestore(); warnings.mockRestore();
  }
});

it("reports empty host failure bodies with the operation, host status and body", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const [status, body] of [[0, ""], [499, ""], [500, ""], [502, ""], [502, "upstream rejected request"]] as const) {
      vi.stubGlobal("fetch", async () => { if (status === 0) throw new Error(""); return new Response(body, { status }); });
      await engines({ engines: ["Sinful Spoils"], format: "advanced" });
      expect(errors).toHaveBeenLastCalledWith(expect.objectContaining({
        message: expect.stringContaining(`HTTP ${status}`),
        tags: { operation: "bridges" }, extra: { hostStatus: status, hostBody: body },
      }));
    }
    vi.stubGlobal("fetch", async () => Response.json({ error: "   " }, { status: 503 }));
    const response = await engines({ engines: ["Sinful Spoils"], format: "advanced" });
    expect((await response.json()).error.trim().length).toBeGreaterThan(0);
  } finally { errors.mockRestore(); }
});

it("authenticates all operations and requires a player in the configured guild", async () => {
  state.auth.mockResolvedValue(null);
  for (const request of [() => lookup(), () => start({ source: "Odion" }), () => poll(), () => feedback({ evidenceHash: hash })]) {
    const response = await request(); expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  state.auth.mockResolvedValue({ user: { id: "2", name: "Kaiba" } });
  expect((await lookup()).status).toBe(403);
  expect(calls).toHaveLength(0);
  state.auth.mockResolvedValue({ user: { id: "1", name: "Yugi" } });
  vi.stubEnv("DISCORD_GUILD_ID", ""); vi.resetModules();
  expect((await lookup()).status).toBe(503);
});

it("forwards only the server identity and bounded query over signed HTTP", async () => {
  reply = { results: [{ ...shown(), format: "genesys" }], inReview: 0 };
  const response = await lookup("source=Odion&target=Argostars&format=genesys&genesysRemaining=100");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(calls).toEqual([{ op: "bridges", guildId: "guild-1", userId: 1, playerId: 11,
    bridgeRequest: { op: "between", source: "Odion", target: "Argostars", format: "genesys", genesysRemaining: 100 } }]);
  expect(await response.json()).toEqual(reply);
});

it("passes grounded reviews with one pro and no cons through lookup and deep-search routes", async () => {
  const bridge = shown();
  bridge.review.pros = [bridge.review.pros[0]];
  bridge.review.cons = [];
  reply = { results: [bridge], reverse: [{ ...bridge, source: bridge.target, target: bridge.source }], inReview: 0 };
  const response = await lookup("source=Odion&target=Argostars");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(reply);

  const niche = { ...bridge, tier: "niche", grade: "Niche", score: 0,
    target: "x".repeat(160), review: { ...bridge.review, grade: "niche", pros: [],
      // The host may fall back to joined printed locks rather than a judge note.
      lock_note: "x".repeat(4001), line: Array(3).fill("x".repeat(200)),
      steps: Array.from({ length: 3 }, () => ({ card: "x".repeat(200), text: "" })) } };
  reply = { jobId: "bridge-job-1", state: "done", step: "done", progress: 100,
    results: [bridge, ...Array.from({ length: 9 }, (_, i) => ({ ...niche, target: `${i}${niche.target.slice(1)}` }))], inReview: 0 };
  const status = await poll();
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual(reply);
});

it("supports owner-scoped deck IDs without accepting client deck cards", async () => {
  expect((await lookup("deckId=23")).status).toBe(200);
  expect(calls[0].bridgeRequest).toEqual({ op: "from", deckId: 23, format: "advanced" });
  reply = { jobId: "bridge-job-1", state: "queued", cached: false };
  expect((await start({ deckId: 23, format: "genesys" })).status).toBe(202);
  expect(calls[1].bridgeRequest).toEqual({ op: "start", deckId: 23, format: "genesys" });
});

it("rejects duplicate, unknown and malformed query controls", async () => {
  for (const query of ["", "source=", "source=Odion&source=Argostars", "source=Odion&guildId=other", "source=Odion&userId=2", "source=Odion&format=normal",
    "source=Odion&deckId=1", "deckId=0", "deckId=1.2", "source=Odion&genesysRemaining=-1", "source=Odion&genesysRemaining=1e2", "source=Odion&target=", `source=${"x".repeat(121)}`]) {
    expect((await lookup(query)).status, query).toBe(400);
  }
  expect(calls).toHaveLength(0);
});

it("starts, resumes and polls a host job without exposing actor overrides", async () => {
  reply = { jobId: "bridge-job-1", state: "running", cached: false };
  const response = await start({ source: "Odion", target: "Argostars" });
  expect(response.status).toBe(202); expect(await response.json()).toEqual(reply);
  expect(calls[0].bridgeRequest).toEqual({ op: "start", source: "Odion", target: "Argostars", format: "advanced" });
  reply = { jobId: "bridge-job-1", state: "running", step: "rating", progress: 70, results: [], inReview: 2 };
  const status = await poll(); expect(status.status).toBe(200); expect(await status.json()).toEqual(reply);
  expect(calls[1].bridgeRequest).toEqual({ op: "status", jobId: "bridge-job-1" });
  reply = { jobId: "bridge-job-1", state: "done", cached: true };
  expect((await start({ source: "Odion" })).status).toBe(200);
  for (const body of [{ source: "Odion", userId: 2 }, { source: "Odion", playerId: 12 }, { source: "Odion", op: "review" }, { source: "Odion", format: "other" }, { source: "Odion", deck: { main: [] } }, { source: "Odion", genesysRemaining: "100" }]) {
    expect((await start(body)).status).toBe(400);
  }
  expect((await poll("bridge-job-1", "?userId=2")).status).toBe(400);
  expect((await poll("x".repeat(129))).status).toBe(400);
});

it("accepts deep-search engine sets with optional deck context and preserves legacy selectors", async () => {
  reply = { jobId: "bridge-job-1", state: "queued", cached: false };
  const deck = { main: [29762407, 97522863], extra: [] };
  expect((await start({ engines: ["Odion", "Ashtra"] })).status).toBe(202);
  expect(calls[0].bridgeRequest).toEqual({ op: "start", engines: ["Odion", "Ashtra"], format: "advanced" });
  expect((await start({ deck, format: "genesys" })).status).toBe(202);
  expect(calls[1].bridgeRequest).toEqual({ op: "start", deck, format: "genesys" });
  for (const selected of [["Odion"], ["Odion", "Ashtra"]]) {
    const request: BridgeDeepSearchRequest = { deck, engines: selected, format: "genesys", genesysRemaining: 0 };
    expect((await start(request)).status).toBe(202);
    expect(calls.at(-1)!.bridgeRequest).toEqual({ ...request, op: "start" });
  }
  expect((await start({ deck, engines: ["Odion"], genesysRemaining: 1000 })).status).toBe(202);
  expect(calls.at(-1)!.bridgeRequest).toEqual({ op: "start", deck, engines: ["Odion"], genesysRemaining: 1000, format: "advanced" });
  const forwarded = calls.length;
  for (const genesysRemaining of [-1, 1001, 0.5, "100", null, true, {}, Number.MAX_SAFE_INTEGER]) {
    for (const selector of [{ deck, engines: ["Odion"] }, { deck }, { engines: ["Odion"] }, { source: "Odion" }, { deckId: 1 }]) {
      expect((await start({ ...selector, format: "genesys", genesysRemaining })).status).toBe(400);
    }
  }
  for (const value of [{ source: "Odion", engines: ["Ashtra"] }, { deckId: 1, deck }, { source: "Odion", deck },
    { engines: Array(5).fill("Odion") }, { engines: [] }, { engines: ["Odion"], target: "Ashtra" }, { deck: { ...deck, userId: 2 } },
    { engines: ["Odion"], deck: null }, { engines: ["Odion"], deck: { main: "cards", extra: [] } },
    { engines: ["Odion"], deck: { main: [0], extra: [] } }, { engines: ["Odion"], deck: { main: Array(92).fill(1), extra: [] } }]) {
    expect((await start(value)).status).toBe(400);
  }
  expect(calls).toHaveLength(forwarded);
  reply = { jobId: "bridge-job-1", state: "done", step: "done", progress: 100, engines: ["Ashtra", "Odion"], next: [], results: [], inReview: 0 };
  expect((await poll()).status).toBe(200);
  reply = { ...reply as object, next: [{ engine: "Argostars", links: [{ bridge: { ...shown(), judge: "pending" } }] }] };
  expect((await poll()).status).toBe(502);
});

it("preserves the hourly-limit response and countdown header", async () => {
  reply = { error: "Deep search hourly limit reached", retryAfter: 48 }; replyStatus = 429;
  const response = await start({ source: "Odion" });
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("48");
  expect(await response.json()).toEqual(reply);
});

it("preserves valid retry hints for busy bridge status and starts, and keeps engines loading", async () => {
  replyStatus = 503;
  for (const [request, error, retryAfter, status] of [
    [() => poll(), "Bridge status is busy", 1, 503],
    [() => start({ source: "Odion" }), "Bridge search queue is busy", 10, 503],
    [() => engines({ engines: ["Odion"], format: "advanced" }), "Bridge engines are busy", 2, 202],
  ] as const) {
    reply = { error, retryAfter };
    const response = await request();
    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe(String(retryAfter));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject(status === 202 ? { state: "loading", retryAfter } : { error, retryAfter });
  }
  for (const retryAfter of [undefined, null, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    reply = { error: "Bridge status is busy", retryAfter };
    const response = await poll();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).not.toHaveProperty("retryAfter");
  }
});

it("validates and forwards join-only requests for every deep-search selector", async () => {
  reply = { jobId: "bridge-job-1", state: "running", cached: false };
  const deck = { main: [29762407], extra: [] };
  for (const selector of [{ engines: ["Odion", "Ashtra"], deck }, { deck }, { engines: ["Odion"] }, { source: "Odion" }, { deckId: 23 }]) {
    for (const join of [true, false]) {
      const request: BridgeDeepSearchRequest = { ...selector, join, format: "genesys", genesysRemaining: 0 };
      expect((await start(request)).status).toBe(202);
      expect(calls.at(-1)!.bridgeRequest).toEqual({ ...request, op: "start" });
    }
    const forwarded = calls.length;
    for (const join of [null, "true", 1, {}, []]) expect((await start({ ...selector, join })).status).toBe(400);
    expect(calls).toHaveLength(forwarded);
  }
  replyStatus = 404; reply = { error: "No existing bridge search" };
  expect((await start({ engines: ["Odion"], join: true })).status).toBe(404);
});

it("sends bounded feedback and returns the hidden decision", async () => {
  reply = { accepted: true, hidden: true };
  const response = await feedback({ evidenceHash: hash, reason: "The lock prevents the summon." });
  expect(response.status).toBe(200); expect(await response.json()).toEqual(reply);
  expect(calls[0].bridgeRequest).toEqual({ op: "feedback", evidenceHash: hash, reason: "The lock prevents the summon." });
  for (const body of [{ evidenceHash: "bad" }, { evidenceHash: hash, reason: "x".repeat(513) }, { evidenceHash: hash, actor: 2 }]) {
    expect((await feedback(body)).status).toBe(400);
  }
});

it("does not present pending or malformed host bridges", async () => {
  for (const result of [{ results: [{ ...shown(), judge: "pending" }], inReview: 0 }, { results: [{ ...shown(), format: "genesys" }], inReview: 0 }, { results: [shown()], inReview: -1 }, { results: [shown()], inReview: 0, reverse: [null] }]) {
    reply = result; expect((await lookup()).status).toBe(502);
  }
  reply = { jobId: "bridge-job-1", state: "running", step: "rating", progress: 101, results: [], inReview: 0 };
  expect((await poll()).status).toBe(502);
});

it("bounds stalled list reads with a still-loading response after twenty-five seconds", async () => {
  const { GET } = await import("../app/api/cards/bridges/route");
  vi.useFakeTimers();
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  try {
    const pending = GET(new Request("http://web.test/api/cards/bridges?source=Odion"));
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect((await response.json()).error).toContain("still loading");
  } finally { vi.useRealTimers(); }
});

it("keeps engines loading after the web's own timeout and keeps status polls bounded to five seconds", async () => {
  const { POST } = await import("../app/api/cards/bridges/engines/route");
  const { GET } = await import("../app/api/cards/bridges/deep-search/[jobId]/route");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("")), { once: true });
  }));
  try {
    const pending = POST(new Request("http://web.test/api/cards/bridges/engines", { method: "POST", body: JSON.stringify({ engines: ["Odion"], format: "advanced" }) }));
    await vi.advanceTimersByTimeAsync(25_000);
    const response = await pending;
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: "loading", retryAfter: 1 });
    expect(errors).not.toHaveBeenCalled();

    const status = GET(new Request("http://web.test/api/cards/bridges/deep-search/bridge-job-1"), { params: Promise.resolve({ jobId: "bridge-job-1" }) });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await status).status).toBe(503);
  } finally { vi.useRealTimers(); errors.mockRestore(); }
});

it("lists bridge feedback only for owners and binds their identity to host review", async () => {
  const { GET } = await import("../app/api/admin/console/bridges/route");
  state.auth.mockResolvedValue({ user: { id: "2", name: "Kaiba" } });
  expect((await GET()).status).toBe(404); expect(calls).toHaveLength(0);
  state.auth.mockResolvedValue({ user: { id: "1", name: "Yugi" } });
  reply = { feedback: [{ evidenceHash: hash, source: "Odion", target: "Argostars", format: "advanced", users: 2,
    reasons: ["Lock conflict", ""], createdAt: "2026-10-28 10:00:00", hidden: true }], inReview: 1 };
  const response = await GET(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "ok", data: reply });
  expect(calls[0]).toEqual({ op: "bridges", guildId: "guild-1", userId: 1, playerId: 11, bridgeRequest: { op: "review" } });
});

it("caps streamed bodies before forwarding deep searches", async () => {
  const { POST } = await import("../app/api/cards/bridges/deep-search/route");
  expect((await POST(new Request("http://web.test/api/cards/bridges/deep-search", { method: "POST", body: JSON.stringify({ source: "x".repeat(5000) }) }))).status).toBe(413);
  expect((await POST(new Request("http://web.test/api/cards/bridges/deep-search", { method: "POST", body: "{bad" }))).status).toBe(400);
  expect(calls).toHaveLength(0);
});

it("lists the archetype names that have bridge data, for signed-in players only", async () => {
  const { GET } = await import("../app/api/cards/bridges/archetypes/route");
  state.db!.exec(`INSERT INTO archetype_bridge(source,target,format,score,grade,bridge_json,evidence_hash,source_version)
    VALUES('Odion','Argostars','advanced',70,'Good','{}','${hash}','v1'),('Argostars','Odion','genesys',60,'Good','{}','${"b".repeat(64)}','v1')`);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ archetypes: ["Argostars", "Odion"] });
  expect(calls).toHaveLength(0);
  state.auth.mockResolvedValue({ user: { id: "2", name: "Kaiba" } });
  expect((await GET()).status).toBe(403);
});

it("passes real host step projections through lookup, engines and deep routes", async () => {
  const { importBridgeArtifact, buildBridgeJudgeEvidence, BRIDGE_JUDGE_FRAMINGS, makeBridgeJudgementRecord,
    saveBridgeJudgement, shownBridge, ShownBridgeReviewSchema } = await import("@yugidraft/shared/cards/effects");
  const { createBridgeService } = await import("@yugidraft/shared/services");
  const { pathSteps, PathSteps } = await import("../src/components/bridges/bridge-path");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const db = state.db!;
  importBridgeArtifact(db);
  const service = createBridgeService(db);
  for (const [source, target, line] of [
    ["Odion", "Ashtra", ["Temple of the Kings", "Yoa the Plague Deity Ashtra", "Ashtra Divine Domain"]],
    ["Sinful Spoils", "Regenesis", ["Sinful Spoils Subdual", "Regenesis Lord", "Regenesis Birth"]],
  ] as const) {
    const row = service.bridgeBetween(source, target)!;
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: [...line], format_ok: true,
    }));
    const bridge = shownBridge(db, row)!;
    expect(bridge.review.steps.map(step => step.card)).toEqual(line);
    expect(bridge.review.steps.every(step => step.text.length > 0)).toBe(true);
    expect(ShownBridgeReviewSchema.safeParse(bridge.review).success).toBe(true);
    // Captions survive the API-to-path boundary even before artwork details arrive.
    const steps = pathSteps(bridge, new Map());
    expect(steps.map(step => ({ card: step.name, text: step.text }))).toEqual(bridge.review.steps);
    const props = { steps, cardProps: () => ({}), deckCount: () => 0, held: () => 0, limit: () => 3 as const };
    const markup = renderToStaticMarkup(createElement(PathSteps, props));
    expect(markup.match(/data-testid="bridge-step-text"/g)).toHaveLength(line.length);
    const cards = new Map(evidence.cards.map(card => [card.id, { code: card.id, name: card.name } as DeckCardInfo]));
    const blank = { ...bridge, review: { ...bridge.review, steps: bridge.review.steps.map(step => ({ ...step, text: "" })) } };
    expect(pathSteps(blank, cards).map(step => step.text)).toEqual(line.map(() => ""));
    reply = { results: [bridge], inReview: 0 };
    const fast = await lookup(`source=${encodeURIComponent(source)}`);
    expect(fast.status).toBe(200); expect(await fast.json()).toEqual(reply);
    const next = { engine: target, score: 8, grade: "Good", tier: "strict", covered: 1, of: 1, twoWay: [],
      links: [{ from: source, to: target, bridge }], cards: bridge.cards, missing: bridge.missing, alreadyInDeck: false,
      genesysPoints: null, pros: [], cons: [] };
    reply = { engines: [source], between: [], next: [next], inReview: 0 };
    const engineResult = await engines({ engines: [source], format: "advanced" });
    expect(engineResult.status).toBe(200); expect(await engineResult.json()).toEqual(reply);
    reply = { engines: [source, target], between: [bridge], next: [], inReview: 0 };
    const between = await engines({ engines: [source, target], format: "advanced" });
    expect(between.status).toBe(200); expect(await between.json()).toEqual(reply);
    reply = { jobId: "bridge-job-1", state: "done", step: "done", progress: 100, results: [bridge], next: [next], inReview: 0 };
    const deep = await poll();
    expect(deep.status).toBe(200); expect(await deep.json()).toEqual(reply);
    for (const steps of [null, [], [...bridge.review.steps].reverse(),
      [{ card: line[0], text: 42 }, ...bridge.review.steps.slice(1)],
      [{ card: line[0], text: "x".repeat(501) }, ...bridge.review.steps.slice(1)]]) {
      const review = { ...bridge.review, steps };
      expect(ShownBridgeReviewSchema.safeParse(review).success).toBe(false);
      reply = { results: [{ ...bridge, review }], inReview: 0 };
      expect((await lookup(`source=${encodeURIComponent(source)}`)).status).toBe(502);
      reply = { engines: [source], between: [], next: [{ ...next, links: [{ from: source, to: target, bridge: { ...bridge, review } }] }], inReview: 0 };
      expect((await engines({ engines: [source], format: "advanced" })).status).toBe(502);
      reply = { jobId: "bridge-job-1", state: "done", step: "done", progress: 100, results: [{ ...bridge, review }], inReview: 0 };
      expect((await poll()).status).toBe(502);
    }
  }
});
