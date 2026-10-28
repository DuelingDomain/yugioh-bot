import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, judgeBridgePair, makeBridgeJudgementRecord, saveBridgeJudgement, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService, createSavedDeckService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { seedIdentity } from "./helpers/identity.js";

let db: Database.Database, bridge: ArchetypeBridge;
beforeAll(() => {
  db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  bridge = createBridgeService(db).bridgeBetween("Odion", "Argostars")!;
});
afterAll(() => db.close());

describe("authenticated bridge API and judged deep-search lifecycle", () => {
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
    const workers = {
      bridgeCandidates: vi.fn(async () => { await gate; return [bridge]; }),
      rateBridge: vi.fn(async (row: ArchetypeBridge) => { await judgeBridgePair(db, row, { client, env: {}, log: () => {} }); }),
    };
    const api = new BridgeApi(db, workers);
    const call = (bridgeRequest: unknown, identity = user, guildId = "g") => api.handle({ userId: identity.userId, bridgeRequest }, guildId, identity.playerId);
    expect(await call({ op: "from", source: "Odion" })).toMatchObject({ results: [] });
    const job = await call({ op: "start", source: "Odion", target: "Argostars" }) as { jobId: string };
    expect(await call({ op: "start", source: "Blue-Eyes" })).toMatchObject({ jobId: job.jobId });
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ state: "running", results: [] });
    complete();
    for (let i = 0; i < 30 && (await call({ op: "status", jobId: job.jobId }) as { state: string }).state !== "done"; i++) await new Promise(resolve => setImmediate(resolve));
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ state: "done", progress: 100, results: [{ target: "Argostars", judge: "accepted" }] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(await call({ op: "start", source: "Odion", target: "Argostars" }, other)).toMatchObject({ jobId: job.jobId, cached: true });
    expect(await call({ op: "between", source: "Odion", target: "Argostars" })).toMatchObject({ results: [{ judge: "accepted" }], reverse: [] });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash, reason: "Timing concern" })).toEqual({ accepted: true, hidden: false });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash })).toEqual({ accepted: true, hidden: false });
    expect(await call({ op: "feedback", evidenceHash: bridge.evidence_hash }, other)).toEqual({ accepted: true, hidden: true });
    expect(await call({ op: "status", jobId: job.jobId })).toMatchObject({ results: [], inReview: 1 });
    expect(await call({ op: "between", source: "Odion", target: "Argostars" })).toMatchObject({ results: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    await expect(call({ op: "status", jobId: job.jobId }, user, "wrong-guild")).rejects.toMatchObject({ status: 403 });
    await expect(api.handle({ userId: other.userId, bridgeRequest: { op: "from", source: "Odion" } }, "g", user.playerId)).rejects.toMatchObject({ status: 403 });
    await expect(call({ op: "review" })).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("OWNER_USER_IDS", String(user.userId));
    try { expect(await call({ op: "review" })).toMatchObject({ feedback: [{ users: 2, hidden: true }] }); }
    finally { vi.unstubAllEnvs(); }
    await api.jobs.close();
  });

  it("resolves saved decks only for their owner and rejects unknown query authority", async () => {
    const user = seedIdentity(db, { name: "Deck owner" }), other = seedIdentity(db, { name: "Not owner" });
    const api = new BridgeApi(db, { bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const sourceId = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json).groups.Odion[0];
    const saved = createSavedDeckService(db).create("g", user.userId, { name: "Bridge deck", mode: "normal", deck: { main: [sourceId], extra: [], side: [] } });
    const call = (bridgeRequest: unknown, identity = user) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    expect(await call({ op: "from", deckId: saved.id })).toHaveProperty("results");
    await expect(call({ op: "from", deckId: saved.id }, other)).rejects.toMatchObject({ status: 404 });
    for (const input of [{ op: "from", source: "Odion", guildId: "elsewhere" }, { op: "from", source: "Odion", format: "unlimited" },
      { op: "from", source: "Unknown" }, { op: "from", source: "Odion", deckId: saved.id }, { op: "from", source: "Odion", genesysRemaining: -1 }]) {
      await expect(call(input)).rejects.toMatchObject({ status: 400 });
    }
    await api.jobs.close();
  });

  it("charges only additional required copies against a saved deck's remaining Genesys points", async () => {
    const user = seedIdentity(db, { name: "Genesys deck owner" });
    const row = createBridgeService(db).bridgeBetween('"C"', "Naturia", "genesys")!;
    expect(row.genesys_points).toBe(5);
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: ["Supplied cards interact.", "The interaction is directed."],
      cons: ["Needs the supplied cards.", "Requires the printed conditions."], lock_note: "Apply the supplied restrictions.",
      line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    const deck = createSavedDeckService(db).create("g", user.userId, { name: "At the points cap", mode: "normal", genesys: { pointCap: 5 },
      deck: { main: [46502744], extra: [], side: [] } });
    const api = new BridgeApi(db, { bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = (bridgeRequest: unknown) => api.handle({ userId: user.userId, bridgeRequest }, "g", user.playerId);
    expect(await call({ op: "between", source: '"C"', target: "Naturia", format: "genesys", genesysRemaining: 0 })).toMatchObject({ results: [] });
    expect(await call({ op: "between", deckId: deck.id, target: "Naturia", format: "genesys" })).toMatchObject({ results: [{ target: "Naturia" }] });
    createSavedDeckService(db).update(deck.id, "g", user.userId, { name: "Over the points cap", mode: "normal", genesys: { pointCap: 0 },
      deck: { main: [46502744], extra: [], side: [] } });
    expect(await call({ op: "between", deckId: deck.id, target: "Naturia", format: "genesys" })).toMatchObject({ results: [] });
    saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, "skeptic", {
      verdict: "invalid", grade: "risky", pros: ["The evidence is available.", "The card identities are checked."],
      cons: ["The proposed line needs review.", "The independent verdicts disagree."], lock_note: "Review the supplied restrictions.",
      line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    vi.stubEnv("OWNER_USER_IDS", String(user.userId));
    try { expect(await call({ op: "review" })).toMatchObject({ inReview: 2 }); }
    finally { vi.unstubAllEnvs(); }
    await api.jobs.close();
  });
});
