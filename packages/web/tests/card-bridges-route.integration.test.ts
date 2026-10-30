import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeDeepSearchRequest } from "../src/lib/bridges-api";

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
  validation: "deterministic", judge: "accepted", engine_status: "unverified", evidence_hash: hash,
  review: { grade: "good", pros: ["Turns on the Traps.", "Shares its starter."], cons: ["Needs Temple.", "Uses deck space."], lock_note: "No summon lock.", line: ["Temple of the Kings"] } });

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
    links: [{ from: "Odion", to: "Argostars", bridge: shown() }], cards: [123], missing: [123], genesysPoints: null, pros: [], cons: [] };
  reply = { engines: ["Odion"], between: [], next: [next], inReview: 0 };
  expect((await engines({ engines: ["Odion"], format: "advanced" })).status).toBe(200);
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
      lock_note: "x".repeat(4001), line: Array(3).fill("x".repeat(200)) } };
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

it("preserves valid retry hints for busy bridge status, starts and fast operations", async () => {
  replyStatus = 503;
  for (const [request, error, retryAfter] of [
    [() => poll(), "Bridge status is busy", 1],
    [() => start({ source: "Odion" }), "Bridge search queue is busy", 10],
    [() => engines({ engines: ["Odion"], format: "advanced" }), "Bridge engines are busy", 2],
  ] as const) {
    reply = { error, retryAfter };
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe(String(retryAfter));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error, retryAfter });
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

it("bounds stalled signed host calls without holding a poll open", async () => {
  const { GET } = await import("../app/api/cards/bridges/route");
  vi.useFakeTimers();
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  try {
    const pending = GET(new Request("http://web.test/api/cards/bridges?source=Odion"));
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("timed out");
  } finally { vi.useRealTimers(); }
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
