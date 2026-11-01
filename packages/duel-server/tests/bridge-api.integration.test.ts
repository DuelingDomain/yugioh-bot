import { bridgeQueryFixture } from "./helpers/bridge-query-fixture.js";
import { bridgeProjectionRows, type BridgeProjectionInput } from "../src/bridge-projection-input.js";
import Database from "better-sqlite3";
import { APIError } from "@anthropic-ai/sdk";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, bridgePackage, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, judgeBridgePair, makeBridgeJudgementRecord, saveBridgeJudgement, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService, createDuelService, createSavedDeckService } from "@yugidraft/shared/services";
import { BridgeEngineQueries, type EngineQuery } from "../src/bridge-engine-queries.js";
import { BridgeApi } from "../src/bridge-api.js";
import { createDuelHost } from "../src/host.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";
import { signedHeaders } from "./helpers/signed-request.js";

let db: Database.Database, bridge: ArchetypeBridge;
beforeAll(() => {
  db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  bridge = createBridgeService(db).bridgeBetween("Odion", "Argostars")!;
});
afterAll(() => db.close());

const bridgeEngineShortlist = async (rows: ArchetypeBridge[], query: EngineQuery) => new BridgeEngineQueries(db).shortlist(rows, query);
const bridgeEngineProjection = async (rows: BridgeProjectionInput, query: EngineQuery) => new BridgeEngineQueries(db).project(bridgeProjectionRows(db, rows), query, 6);

describe("authenticated bridge API and judged deep-search lifecycle", () => {
  it("projects open-deck list ownership per caller without changing its selected source or cached rows", async () => {
    const user = seedIdentity(db, { name: "Open deck list" }), other = seedIdentity(db, { name: "Other open deck" });
    const pair = db.prepare(`SELECT a.bridge_json AS forward,b.bridge_json AS reverse FROM archetype_bridge a
      JOIN archetype_bridge b ON b.source=a.target AND b.target=a.source AND b.format=a.format
      WHERE a.format='advanced' AND a.source<>'Odion' AND a.target<>'Odion'
      AND coalesce(json_extract(a.bridge_json,'$.tier'),'strict')<>'niche'
      AND coalesce(json_extract(b.bridge_json,'$.tier'),'strict')<>'niche'
      ORDER BY a.score DESC,a.source,a.target LIMIT 1`).get() as { forward: string; reverse: string };
    const forward = JSON.parse(pair.forward) as ArchetypeBridge, reverse = JSON.parse(pair.reverse) as ArchetypeBridge;
    for (const row of [forward, reverse]) {
      const evidence = buildBridgeJudgeEvidence(db, row)!;
      for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
        verdict: "valid", grade: "good", pros: ["The supplied cards interact."], cons: ["Needs the supplied cards."],
        lock_note: "Apply the printed conditions.", line: evidence.cards.map(card => card.name), format_ok: true,
      }));
    }
    const workers = { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection: vi.fn(), bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(), rateBridge: vi.fn() };
    const api = new BridgeApi(db, workers);
    const call = (context: Record<string, unknown> = {}, identity = user) => api.handle({ userId: identity.userId,
      bridgeRequest: { op: "between", source: forward.source, target: forward.target, ...context } }, "g", identity.playerId);
    const copies = bridgePackage([forward, reverse]).missing;
    const deck = { main: copies.slice(0, -1), extra: copies.slice(-1) };
    try {
      expect(await call()).toMatchObject({ results: [{ source: forward.source, alreadyInDeck: false }], reverse: [{ alreadyInDeck: false }] });
      expect(await call({ deck })).toMatchObject({ results: [{ source: forward.source, missing: [], alreadyInDeck: true }], reverse: [{ missing: [], alreadyInDeck: true }] });
      expect(await call({ deck: { main: [], extra: [] } }, other)).toMatchObject({
        results: [{ missing: bridgePackage([forward]).missing, alreadyInDeck: false }],
        reverse: [{ missing: bridgePackage([reverse]).missing, alreadyInDeck: false }],
      });
      const held = bridgePackage([forward]).missing;
      expect(await call({ deck: { main: held.slice(1), extra: [], deckMaster: held[0] } })).toMatchObject({
        results: [{ missing: [held[0]], alreadyInDeck: false }],
      });
      expect(await call({ op: "from", target: undefined, deck })).toMatchObject({ results: expect.arrayContaining([
        expect.objectContaining({ target: forward.target, alreadyInDeck: true, missing: [] }),
      ]) });
      expect(await call()).toMatchObject({ results: [{ alreadyInDeck: false }] });
      for (const context of [{ deck: null }, { deck: { ...deck, side: [0] } }, { deck: { main: [0], extra: [] } },
        { deck: { main: Array(92).fill(1), extra: [] } }, { deck: { ...deck, pointCap: 1001 } },
        { deck, deckId: 1 }, { deck, genesysRemaining: -1 }, { deck, engines: [forward.source] }]) {
        await expect(call(context)).rejects.toMatchObject({ status: 400 });
      }
      expect(workers.bridgeEngines).not.toHaveBeenCalled();
      expect(workers.bridgeCandidates).not.toHaveBeenCalled();
      expect(workers.rateBridge).not.toHaveBeenCalled();
    } finally {
      await api.jobs.close();
      for (const row of [forward, reverse]) db.prepare("DELETE FROM bridge_judgement WHERE evidence_hash=?").run(row.evidence_hash);
    }
  });

  it("uses open-deck incremental Genesys points, the editor allowance and unknown-point fallback for lists", async () => {
    const user = seedIdentity(db, { name: "Open deck points" });
    const row = createBridgeService(db).bridgeBetween("Odion", "Ashtra", "genesys")!;
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: ["The supplied cards interact."], cons: ["Needs the supplied cards."],
      lock_note: "Apply the printed conditions.", line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    const api = new BridgeApi(db, { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection: vi.fn(), bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = (context: Record<string, unknown>) => api.handle({ userId: user.userId,
      bridgeRequest: { op: "between", source: "Odion", target: "Ashtra", format: "genesys", ...context } }, "g", user.playerId);
    const required = bridgePackage([row]).missing;
    const deck = { main: required.slice(0, -1), extra: required.slice(-1), pointCap: 3 };
    const paidCard = required.find(id => {
      const stored = db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string };
      return JSON.parse(stored.capabilities_json).card.genesysPoints > 0;
    })!;
    try {
      expect(await call({ genesysRemaining: 0 })).toMatchObject({ results: [] });
      expect(await call({ deck })).toMatchObject({ results: [{ missing: [], alreadyInDeck: true }] });
      expect(await call({ deck: { ...deck, pointCap: 0 } })).toMatchObject({ results: [] });
      expect(await call({ deck: { ...deck, pointCap: 0 }, genesysRemaining: 0 })).toMatchObject({ results: [{ missing: [], alreadyInDeck: true }] });
      const empty = { main: [], extra: [], pointCap: 0 };
      expect(await call({ deck: empty })).toMatchObject({ results: [] });
      expect(await call({ deck: empty, genesysRemaining: 3 })).toMatchObject({ results: [{ alreadyInDeck: false }] });
      expect(await call({ deck: { ...empty, deckMaster: paidCard, pointCap: 3 } })).toMatchObject({ results: [] });
      expect(await call({ deck: { main: [0xffffffff], extra: [], pointCap: 0 } })).toMatchObject({ results: [{ alreadyInDeck: false }] });
      expect(await call({ deck: { main: [0xffffffff], extra: [] }, genesysRemaining: 0 })).toMatchObject({ results: [] });
    } finally { await api.jobs.close(); }
  });

  it("keeps the host available when bridge startup fails and returns a retryable bridge response", async () => {
    const directory = createHostDataFixture([]);
    const fixture = new Database(":memory:"); migrate(fixture);
    // A legacy schema fault must disable bridges without disabling gameplay.
    fixture.exec("CREATE TABLE bridge_deep_job(id TEXT PRIMARY KEY)");
    const errorReport = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = seedIdentity(fixture, { name: "Available host" });
    const session = createDuelService(fixture).create({ guildId: "g", organizerPlayerId: user.playerId, name: "Available lobby", mode: "normal" });
    let host: ReturnType<typeof createDuelHost> | undefined;
    vi.stubEnv("EFFECT_SEARCH", "1"); vi.stubEnv("DECK_SUGGESTIONS", "1"); vi.stubEnv("BRIDGES_ENABLED", "1");
    try {
      host = createDuelHost({ db: fixture, dataDirectory: directory, secret: "bridge-startup-failure", searchCards: () => [], pollIntervalMs: 60_000 });
      expect(errorReport).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("query_key"),
        tags: { operation: "[duel] bridge search startup failed" },
      }));
      const url = "http://local/internal/duel";
      const post = async (op: string) => {
        const raw = JSON.stringify({ op, guildId: "g", ...user, slug: session.slug, bridgeRequest: { op: "engines", engines: ["Odion"] } });
        return host!.handle(new Request(url, { method: "POST", body: raw,
          headers: await signedHeaders(raw, "bridge-startup-failure", url, "duel-host") }));
      };
      const bridgeResponse = await post("bridges");
      expect(bridgeResponse.status).toBe(503);
      expect(bridgeResponse.headers.get("Retry-After")).toBe("1");
      expect(await bridgeResponse.json()).toMatchObject({ error: "Bridge search is unavailable. Try again shortly." });
      expect((await post("view")).status).toBe(200);
      expect(errorReport).toHaveBeenCalledTimes(1);
    } finally {
      await host?.close(); errorReport.mockRestore(); vi.unstubAllEnvs(); fixture.close(); rmSync(directory, { recursive: true, force: true });
    }
  });

  it("quietly cancels a signed bridge request disconnected while reading its body", async () => {
    const directory = createHostDataFixture([]);
    const host = createDuelHost({ db, dataDirectory: directory, secret: "bridge-disconnect", searchCards: () => [], pollIntervalMs: 60_000 });
    const user = seedIdentity(db, { name: "Disconnected editor" });
    const errorReport = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = vi.spyOn(BridgeApi.prototype, "handle");
    try {
      for (const reason of [undefined, new Error("client disconnected")]) {
        const abort = new AbortController();
        const url = "http://local/internal/duel";
        const raw = JSON.stringify({ op: "bridges", guildId: "g", ...user, bridgeRequest: { op: "engines", engines: ["Odion"] } });
        const headers = await signedHeaders(raw, "bridge-disconnect", url, "duel-host");
        const body = new ReadableStream<Uint8Array>({ pull(controller) {
          abort.abort(reason);
          controller.enqueue(new TextEncoder().encode(raw));
          controller.close();
        } }, { highWaterMark: 0 });
        const request = new Request(url, { method: "POST", headers, body, signal: abort.signal, ...{ duplex: "half" } });
        expect(request.signal.aborted).toBe(false);
        const response = await host.handle(request);
        expect(request.signal.aborted).toBe(true);
        expect(errorReport).not.toHaveBeenCalled();
        expect(response.status).toBe(499);
        expect(handle).not.toHaveBeenCalled();
      }
    } finally { handle.mockRestore(); errorReport.mockRestore(); await host.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("judges with a mocked client, reuses judgements, and hides cached results after distinct reports", async () => {
    const user = seedIdentity(db), other = seedIdentity(db, { name: "Other" });
    let complete!: () => void;
    const gate = new Promise<void>(resolve => { complete = resolve; });
    const client: BridgeJudgeClient = { messages: { create: vi.fn(async () => ({
      id: "msg_bridge_fixture", model: "claude-haiku-5-5", stop_reason: "end_turn",
      usage: { input_tokens: 2000, output_tokens: 150 }, content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good",
        pros: ["Enables early Trap activation.", "Connects the two supplied packages."], cons: ["Requires the supplied cards.", "Uses a Spell and Trap zone."],
        lock_note: "Apply the printed conditions.", line: buildBridgeJudgeEvidence(db, bridge)!.cards.map(card => card.name), format_ok: true }) }],
    })) } };
    const workers = { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection,
      bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(async () => { await gate; return [bridge]; }),
      rateBridge: vi.fn(async (row: ArchetypeBridge) => { await judgeBridgePair(db, row, { client, env: {}, log: () => {} }); }),
    };
    let now = Date.now();
    const api = new BridgeApi(db, workers, () => now);
    const call = (bridgeRequest: unknown, identity = user, guildId = "g") => api.handle({ userId: identity.userId, bridgeRequest }, guildId, identity.playerId);
    expect(await call({ op: "from", source: "Odion" })).toMatchObject({ results: [] });
    await expect(call({ op: "start", source: "Odion", join: true })).rejects.toMatchObject({ status: 404 });
    for (const join of [null, "true", 1, {}, []]) {
      await expect(call({ op: "start", source: "Odion", join })).rejects.toMatchObject({ status: 400 });
    }
    const job = await call({ op: "start", source: "Odion" }) as { jobId: string };
    expect(await call({ op: "start", source: "Odion", join: true })).toMatchObject({ jobId: job.jobId, cached: false });
    await expect(call({ op: "start", source: "Blue-Eyes" })).rejects.toMatchObject({ status: 409, message: "A deep search for Temple of the Kings is still running", retryAfter: 10 });
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ state: "running", results: [] });
    complete();
    for (let i = 0; i < 30 && (await call({ op: "status", jobId: job.jobId }) as { state: string }).state !== "done"; i++) await new Promise(resolve => setImmediate(resolve));
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ state: "done", progress: 100, results: [{ target: "Argostars", judge: "accepted" }] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(await call({ op: "start", source: "Odion", join: true }, other)).toMatchObject({ jobId: job.jobId, cached: true });
    expect(await call({ op: "between", source: "Odion", target: "Argostars" })).toMatchObject({ results: [{ judge: "accepted" }], reverse: [] });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash, reason: "Timing concern" })).toEqual({ accepted: true, hidden: false });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash })).toEqual({ accepted: true, hidden: false });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash }, other)).toEqual({ accepted: true, hidden: true });
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ results: [], inReview: 1 });
    expect(await call({ op: "between", source: "Odion", target: "Argostars" })).toMatchObject({ results: [] });
    now += 600_001;
    expect(await call({ op: "start", source: "Odion" })).toMatchObject({ jobId: job.jobId, cached: true });
    expect(workers.bridgeCandidates).toHaveBeenCalledTimes(2);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    await expect(call({ op: "status", jobId: job.jobId }, user, "wrong-guild")).rejects.toMatchObject({ status: 403 });
    await expect(api.handle({ userId: other.userId, bridgeRequest: { op: "from", source: "Odion" } }, "g", user.playerId)).rejects.toMatchObject({ status: 403 });
    await expect(call({ op: "review" })).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("OWNER_USER_IDS", String(user.userId));
    try { expect(await call({ op: "review" })).toMatchObject({ feedback: [{ users: 2, hidden: true }] }); }
    finally { vi.unstubAllEnvs(); }
    await api.jobs.close();
  });

  it("reports review service failure and permits retry instead of caching an empty success", async () => {
    const user = seedIdentity(db, { name: "Retry reviewer" });
    const row = createBridgeService(db).bridgeBetween("Branded", "Despia")!;
    db.prepare("DELETE FROM bridge_judgement WHERE evidence_hash=?").run(row.evidence_hash);
    let now = 1_000_000;
    const client: BridgeJudgeClient = { messages: { async create() {
      throw new APIError(400, { error: { message: "Unsupported schema" } }, "Unsupported schema", new Headers());
    } } };
    const workers = { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(async () => [row]), rateBridge: vi.fn(async () => {
      await judgeBridgePair(db, row, { client, env: {}, log: () => {}, onError: () => {} });
    }) };
    const api = new BridgeApi(db, workers, () => now);
    const start = () => api.handle({ userId: user.userId, bridgeRequest: { op: "start", source: row.source } }, "g", user.playerId);
    try {
      const first = await start() as { jobId: string };
      await new Promise(resolve => setImmediate(resolve));
      expect((await api.jobs.status({ userId: user.userId, guildId: "g" }, first.jobId))).toMatchObject({ state: "failed", results: [], error: "Review service unavailable, try later." });
      const evidence = buildBridgeJudgeEvidence(db, row)!;
      saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, "mechanic", {
        verdict: "valid", grade: "good", pros: ["Branded Opening searches Despian Tragedy."],
        cons: ["Branded Opening needs a card to discard during resolution."], lock_note: "The search does not Summon.",
        line: ["Branded Opening", "Despian Tragedy"], format_ok: true,
      }));
      const retry = await start() as { jobId: string; cached: boolean };
      expect(retry.jobId).not.toBe(first.jobId);
      expect(retry.cached).toBe(false);
      await api.jobs.close();
      expect((await api.jobs.status({ userId: user.userId, guildId: "g" }, retry.jobId))).toMatchObject({ state: "failed", error: "Review service unavailable, try later." });
      expect(workers.rateBridge).toHaveBeenCalledTimes(2);
    } finally { await api.jobs.close(); }
  });

  it("shows two-way only while the reverse bridge also passes both reviews", async () => {
    const user = seedIdentity(db, { name: "Two-way reviewer" });
    const pair = db.prepare(`SELECT a.bridge_json AS forward,b.bridge_json AS reverse FROM archetype_bridge a
      JOIN archetype_bridge b ON b.source=a.target AND b.target=a.source AND b.format=a.format
      WHERE a.format='advanced' AND a.source<>'Odion' AND a.target<>'Odion'
      AND coalesce(json_extract(a.bridge_json,'$.tier'),'strict')<>'niche'
      AND coalesce(json_extract(b.bridge_json,'$.tier'),'strict')<>'niche'
      ORDER BY a.score DESC,a.source,a.target LIMIT 1`).get() as { forward: string; reverse: string };
    const forward = JSON.parse(pair.forward) as ArchetypeBridge, reverse = JSON.parse(pair.reverse) as ArchetypeBridge;
    const approve = (row: ArchetypeBridge) => {
      const evidence = buildBridgeJudgeEvidence(db, row)!;
      for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
        verdict: "valid", grade: "good", pros: ["The supplied cards interact.", "Enables the proposed line."],
        cons: ["Needs the supplied cards.", "Requires the printed conditions."], lock_note: "Apply the supplied restrictions.",
        line: evidence.cards.map(card => card.name), format_ok: true,
      }));
    };
    approve(forward);
    const api = new BridgeApi(db, { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = () => api.handle({ userId: user.userId, bridgeRequest: { op: "between", source: forward.source, target: forward.target } }, "g", user.playerId);
    try {
      expect(await call()).toMatchObject({ results: [{ two_way: false }] });
      approve(reverse);
      expect(await call()).toMatchObject({ results: [{ two_way: true }], reverse: [{ two_way: true }] });
      for (const actor of ["two-way-one", "two-way-two"]) db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(reverse.evidence_hash, actor);
      expect(await call()).toMatchObject({ results: [{ two_way: false }], reverse: [] });
    } finally { await api.jobs.close(); }
  });

  it("rejects removed saved-deck and pair search selectors and unknown query authority", async () => {
    const user = seedIdentity(db, { name: "Deck owner" }), other = seedIdentity(db, { name: "Not owner" });
    const api = new BridgeApi(db, { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const sourceId = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json).groups.Odion[0];
    const saved = createSavedDeckService(db).create("g", user.userId, { name: "Bridge deck", mode: "normal", deck: { main: [sourceId], extra: [], side: [] } });
    const call = (bridgeRequest: unknown, identity = user) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    await expect(call({ op: "from", deckId: saved.id })).rejects.toMatchObject({ status: 400 });
    await expect(call({ op: "from", deckId: saved.id }, other)).rejects.toMatchObject({ status: 400 });
    await expect(call({ op: "start", source: "Odion", target: "Argostars" })).rejects.toMatchObject({ status: 400 });
    await expect(call({ op: "start", deckId: saved.id })).rejects.toMatchObject({ status: 400 });
    for (const input of [{ op: "from", source: "Odion", guildId: "elsewhere" }, { op: "from", source: "Odion", format: "unlimited" },
      { op: "from", source: "Unknown" }, { op: "from", source: "Odion", deckId: saved.id }, { op: "from", source: "Odion", genesysRemaining: -1 }]) {
      await expect(call(input)).rejects.toMatchObject({ status: 400 });
    }
    await api.jobs.close();
  });

  it("charges only additional required copies against the open deck's remaining Genesys points", async () => {
    const user = seedIdentity(db, { name: "Genesys deck owner" });
    const row = createBridgeService(db).bridgeBetween("Odion", "Ashtra", "genesys")!;
    expect(row.genesys_points).toBe(3);
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: ["Supplied cards interact.", "The interaction is directed."],
      cons: ["Needs the supplied cards.", "Requires the printed conditions."], lock_note: "Apply the supplied restrictions.",
      line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    const deck = { main: [29762407, 97522863, 1710647], extra: [], pointCap: 3 };
    const bridgeCandidates = vi.fn(async () => [row]);
    const api = new BridgeApi(db, { ...bridgeQueryFixture(db), bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines: vi.fn(), bridgeCandidates, rateBridge: vi.fn() });
    const call = (bridgeRequest: unknown) => api.handle({ userId: user.userId, bridgeRequest }, "g", user.playerId);
    expect(await call({ op: "between", source: "Odion", target: "Ashtra", format: "genesys", genesysRemaining: 0 })).toMatchObject({ results: [] });
    expect(await call({ op: "between", source: "Odion", deck, target: "Ashtra", format: "genesys" })).toMatchObject({ results: [{ target: "Ashtra" }] });
    deck.pointCap = 0;
    expect(await call({ op: "between", source: "Odion", deck, target: "Ashtra", format: "genesys" })).toMatchObject({ results: [] });
    const started = await call({ op: "start", engines: ["Odion"], deck, format: "genesys", genesysRemaining: 0 }) as { jobId: string };
    await api.jobs.close();
    expect(await call({ op: "status", jobId: started.jobId })).toMatchObject({ state: "done", results: [{ target: "Ashtra" }] });
    expect(bridgeCandidates).toHaveBeenCalledTimes(2);
    vi.stubEnv("OWNER_USER_IDS", String(user.userId));
    const beforeReview = (await call({ op: "review" }) as { inReview: number }).inReview;
    saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, "skeptic", {
      verdict: "invalid", grade: "risky", pros: ["The evidence is available.", "The card identities are checked."],
      cons: ["The proposed line needs review.", "The independent verdicts disagree."], lock_note: "Review the supplied restrictions.",
      line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    try { expect(await call({ op: "review" })).toMatchObject({ inReview: beforeReview + 1 }); }
    finally { vi.unstubAllEnvs(); }
    await api.jobs.close();
  });
});
