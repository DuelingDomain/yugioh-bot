import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, exportBridgeJudgements, importBridgeArtifact, importBridgeJudgements, importCardEffectArtifact, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { AnthropicBridgeBatchClient, FileBridgeBatchStore, emptyBridgeBatchLedger, exportBridgeBatchJudgements, runBridgeBatchJudging } from "../judge-bridges.js";
import { BRIDGE_JUDGEMENT_FILE, validateBridgeJudgementCandidate } from "../../ci/bridge-judgements.mjs";

const directories: string[] = [], databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bridge-batch-integration-")); directories.push(directory);
  const db = new Database(":memory:"); databases.push(db); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  const store = new FileBridgeBatchStore(join(directory, "ledger.json"));
  await store.compareAndSwap(undefined, emptyBridgeBatchLedger());
  const bridge = JSON.parse((db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source='Odion' AND target='Argostars' AND format='advanced'").get() as { bridge_json: string }).bridge_json) as ArchetypeBridge;
  return { directory, db, store, bridges: [bridge], now: () => new Date("2026-10-28T12:00:00Z") };
}

function endpoint(options: { uncertain?: boolean; partial?: boolean } = {}) {
  const calls: string[] = [], requests: Array<{ custom_id: string; params: Record<string, any> }> = [];
  const sdk = new Anthropic({ apiKey: "integration-fixture", maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") {
      requests.push(...JSON.parse(String(init.body)).requests);
      if (options.uncertain) throw new Error("lost submission response");
      return new Response(JSON.stringify({ id: "msgbatch_fixture", processing_status: "in_progress" }), { headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/results")) {
      const results = requests.map(request => ({ custom_id: request.custom_id, result: { type: "succeeded", message: { model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", pros: ["A named line is available.", "The enabler covers the target."], cons: ["The package uses deck slots.", "The starter can be interrupted."], lock_note: "Use the checked order.", line: [JSON.parse(request.params.messages[0].content).cards[0].name], format_ok: true }) }] } } }));
      return new Response((options.partial ? results.slice(1) : results).map(row => JSON.stringify(row)).join("\n") + "\n", { headers: { "content-type": "application/x-jsonl" } });
    }
    return new Response(JSON.stringify({ id: "msgbatch_fixture", processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_fixture/results" }), { headers: { "content-type": "application/json" } });
  } });
  return { client: new AnthropicBridgeBatchClient(sdk), calls, requests };
}

describe("offline bridge judgement batches", () => {
  it("prices a dry run without constructing a client or changing the ledger", async () => {
    const fixture = await setup(), before = readFileSync(join(fixture.directory, "ledger.json"), "utf8");
    const report = await runBridgeBatchJudging({ ...fixture, dryRun: true });
    expect(report.pairs).toBe(1); expect(report.requests).toBe(2);
    expect(report.estimatedInputTokens).toBeGreaterThan(0); expect(report.estimatedOutputTokens).toBeGreaterThan(0);
    expect(report.estimatedCostUsd).toBeCloseTo((report.estimatedInputTokens * 0.10 + report.estimatedOutputTokens * 0.50) / 1_000_000 * 0.5, 10);
    expect(readFileSync(join(fixture.directory, "ledger.json"), "utf8")).toBe(before);
  });

  it("submits two framings through the SDK, collects them and reuses their evidence hashes", async () => {
    const fixture = await setup(), mock = endpoint();
    const first = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(first.submitted).toBe(2); expect(first.pending).toBe(2);
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests.every(request => request.params.model === "claude-haiku-5-5" && request.params.output_config.format.type === "json_schema")).toBe(true);
    expect(mock.requests[0]!.params.system).not.toEqual(mock.requests[1]!.params.system);
    const second = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(second.collected).toBe(2); expect(second.submitted).toBe(0); expect(second.runSpendUsd).toBeGreaterThan(0);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM bridge_judgement").get()).toEqual({ count: 2 });
    expect(bridgeGate(fixture.db, fixture.bridges[0]!).state).toBe("shown");
    const third = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(third.requests).toBe(0); expect(mock.calls.filter(call => call.startsWith("POST"))).toHaveLength(1);
  });

  it("keeps ambiguous submission intent durable and never repeats the paid POST", async () => {
    const fixture = await setup(), mock = endpoint({ uncertain: true });
    await expect(runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false })).rejects.toThrow("uncertain");
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(report.deferred).toContain("ambiguous-submission"); expect(mock.calls.filter(call => call.startsWith("POST"))).toHaveLength(1);
    expect((await fixture.store.read())!.ledger.reservations[0]!.state).toBe("submission_started");
  });

  it("retains the reservation and commits no partial judgements for incomplete results", async () => {
    const fixture = await setup(), mock = endpoint({ partial: true });
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    await expect(runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false })).rejects.toThrow("Incomplete Batch results");
    expect((await fixture.store.read())!.ledger.reservations[0]!.state).toBe("submitted");
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM bridge_judgement").get()).toEqual({ count: 0 });
  });

  it("enforces an explicitly configured cap while leaving the default uncapped", async () => {
    const fixture = await setup(), mock = endpoint();
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false, monthlyUsd: "0" });
    expect(report.deferred).toContain("monthly-budget"); expect(mock.calls).toHaveLength(0);
    expect((await fixture.store.read())!.ledger.reservations).toHaveLength(0);
  });

  it("publishes only collected judgement rows and rejects extra paths or altered verdicts", async () => {
    const fixture = await setup(), mock = endpoint(), root = join(fixture.directory, "base"), output = join(fixture.directory, "candidate");
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    mkdirSync(join(root, "packages/shared/data/effects"), { recursive: true }); mkdirSync(join(output, "packages/shared/data/effects"), { recursive: true });
    const before = gzipSync(""); writeFileSync(join(root, BRIDGE_JUDGEMENT_FILE), before);
    exportBridgeJudgements(fixture.db, join(output, "packages/shared/data/effects"));
    writeFileSync(join(output, "bridge-judge-report.json"), JSON.stringify(report));
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const metadata = { files: [BRIDGE_JUDGEMENT_FILE], base_sha256: sha(before), sha256: sha(readFileSync(join(output, BRIDGE_JUDGEMENT_FILE))), records: 2 };
    expect(validateBridgeJudgementCandidate(root, output, metadata)).toEqual([BRIDGE_JUDGEMENT_FILE]);
    expect(() => validateBridgeJudgementCandidate(root, output, { ...metadata, files: ["other.ts"] })).toThrow("paths");
    const publisher = await import(new URL("../../ci/publish-effect-tags.mjs", import.meta.url).href);
    writeFileSync(join(root, "packages/shared/data/effects/manifest.json"), JSON.stringify({ artifactVersion: "a".repeat(64) }));
    const candidate = { version: 1, changed: true, baseSha: "b".repeat(40), baseVersion: "a".repeat(64), files: [], bridgeJudgements: metadata };
    writeFileSync(join(output, "update.json"), JSON.stringify(candidate));
    expect(publisher.validateEffectCandidate(root, output)).toEqual(candidate);
    writeFileSync(join(output, "update.json"), JSON.stringify({ ...candidate, files: ["other.ts"] }));
    expect(() => publisher.validateEffectCandidate(root, output)).toThrow("outside allowlist");
    const changed = report.acceptedRecords.map(record => ({ ...record, result: { ...record.result, verdict: "invalid" } }));
    const altered = gzipSync(changed.map(record => JSON.stringify(record)).join("\n") + "\n"); writeFileSync(join(output, BRIDGE_JUDGEMENT_FILE), altered);
    expect(() => validateBridgeJudgementCandidate(root, output, { ...metadata, sha256: sha(altered) })).toThrow("differs from collected");
  });

  it("preserves old prompt history in the artifact while runtime import skips stale identities", async () => {
    const fixture = await setup(), mock = endpoint();
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const original = report.acceptedRecords[0]!, identity = original.judge.split(":"); identity[2] = "c".repeat(64);
    const stale = { ...original, judge: identity.join(":") }, path = join(fixture.directory, "bridge-judgements.jsonl.gz");
    writeFileSync(path, gzipSync(JSON.stringify(stale) + "\n"));
    expect(importBridgeJudgements(fixture.db, fixture.directory)).toEqual({ imported: 0, skipped: 1 });
    expect(exportBridgeBatchJudgements(fixture.db, fixture.directory)).toBe(3);
    const rows = gunzipSync(readFileSync(path)).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toContainEqual(stale);
    expect(bridgeGate(fixture.db, fixture.bridges[0]!).judgements).toHaveLength(2);
    expect(exportBridgeBatchJudgements(fixture.db, fixture.directory)).toBe(3);
  });
});
