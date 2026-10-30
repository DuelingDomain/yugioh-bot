import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, shownBridge, exportBridgeJudgements, importBridgeArtifact, importBridgeJudgements, importCardEffectArtifact, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { AnthropicBridgeBatchClient, FileBridgeBatchStore, emptyBridgeBatchLedger, exportBridgeBatchJudgements, runBridgeBatchJudging, type BridgeBatchClient } from "../judge-bridges.js";
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

function endpoint(options: { uncertain?: boolean; partial?: boolean; model?: string; lockNote?: string; malformed?: boolean } = {}) {
  const calls: string[] = [], requests: Array<{ custom_id: string; params: Record<string, any> }> = [];
  const sdk = new Anthropic({ apiKey: "integration-fixture", maxRetries: 0, fetch: async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") {
      requests.push(...JSON.parse(String(init.body)).requests);
      if (options.uncertain) throw new Error("lost submission response");
      return new Response(JSON.stringify({ id: "msgbatch_fixture", processing_status: "in_progress" }), { headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/results")) {
      const results = requests.map(request => ({ custom_id: request.custom_id, result: { type: "succeeded", message: { model: options.model ?? "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", pros: ["A named line is available.", "The enabler covers the target."], cons: ["The package uses deck slots.", "The starter can be interrupted."], lock_note: options.lockNote ?? "Use the checked order.", line: [JSON.parse(request.params.messages[0].content).cards[0].name], format_ok: true }) }] } } }));
      if (options.malformed) for (const row of results) row.result.message.content[0]!.text = "not JSON";
      return new Response((options.partial ? results.slice(1) : results).map(row => JSON.stringify(row)).join("\n") + "\n", { headers: { "content-type": "application/x-jsonl" } });
    }
    return new Response(JSON.stringify({ id: "msgbatch_fixture", processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_fixture/results" }), { headers: { "content-type": "application/json" } });
  } });
  return { client: new AnthropicBridgeBatchClient(sdk), calls, requests };
}

describe("offline bridge judgement batches", () => {
  it("durably reserves and settles a second text batch before publishing grounded notes", async () => {
    const fixture = await setup();
    const batches = new Map<string, Parameters<BridgeBatchClient["create"]>[0]>();
    const supported = "Temple of the Kings allows Trap activation on the turn Set.";
    const unsupported = "Temple of the Kings allows Trap activation from the hand.";
    const client: BridgeBatchClient = {
      async create(requests) { const id = `msgbatch_grounded_${batches.size}`; batches.set(id, requests); return { id }; },
      async retrieve() { return { processing_status: "ended" }; },
      async results(id) { return batches.get(id)!.map(request => {
        const input = JSON.parse(request.params.messages[0]!.content as string);
        const value = input.sentences ? { checks: input.sentences.map((item: { id: number; sentence: string }) => ({ id: item.id, supported: item.sentence === supported ? "yes" : "no" })) }
          : { verdict: "valid", grade: "good", format_ok: true, pros: [], cons: [supported, unsupported], lock_note: "", line: ["Temple of the Kings"],
            grounding: [supported, unsupported].map(sentence => ({ field: "cons", sentence, citations: [{ card: "Temple of the Kings", quote: "You can activate 1 Trap Card the turn it was Set." }] })) };
        return { custom_id: request.custom_id, result: { type: "succeeded", message: { model: "claude-haiku-5-5", stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(value) }] } } };
      }); },
    };
    await runBridgeBatchJudging({ ...fixture, client, dryRun: false });
    const primary = await runBridgeBatchJudging({ ...fixture, client, dryRun: false });
    expect(primary).toMatchObject({ collected: 2, submitted: 2, pending: 2 });
    expect(shownBridge(fixture.db, fixture.bridges[0]!)?.review.cons).toEqual([]);
    const durable = (await fixture.store.read())!.ledger.reservations[1]!;
    expect(durable.requests.every(request => request.textReview)).toBe(true);
    expect(durable.reservedMicros).toBeGreaterThan(0);
    const checked = await runBridgeBatchJudging({ ...fixture, client, dryRun: false });
    expect(checked).toMatchObject({ collected: 2, submitted: 0, pending: 0, monthlySpendUsd: 0.000032 });
    expect(shownBridge(fixture.db, fixture.bridges[0]!)?.review.cons).toEqual([supported]);
    expect(JSON.stringify(shownBridge(fixture.db, fixture.bridges[0]!))).not.toContain("text_audit");
    const settled = (await fixture.store.read())!.ledger.reservations;
    expect(settled.every(entry => entry.state === "settled")).toBe(true);
    expect(checked.acceptedRecords).toHaveLength(2);
    expect(checked.acceptedRecords.every(row => row.result.verdict === "valid" && row.result.cons.length === 1)).toBe(true);
    const root = join(fixture.directory, "base"), output = join(fixture.directory, "candidate");
    for (const path of [root, output]) mkdirSync(join(path, "packages/shared/data/effects"), { recursive: true });
    const before = gzipSync(""); writeFileSync(join(root, BRIDGE_JUDGEMENT_FILE), before);
    exportBridgeJudgements(fixture.db, join(output, "packages/shared/data/effects"));
    writeFileSync(join(output, "bridge-judge-report.json"), JSON.stringify(checked));
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(validateBridgeJudgementCandidate(root, output, { files: [BRIDGE_JUDGEMENT_FILE], base_sha256: sha(before), sha256: sha(readFileSync(join(output, BRIDGE_JUDGEMENT_FILE))), records: 2 })).toEqual([BRIDGE_JUDGEMENT_FILE]);
  });
  it("settles a batch using its originating model and pre-metadata evidence after config changes", async () => {
    const fixture = await setup(), mock = endpoint({ model: "claude-sonnet-5-5" });
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const snapshot = (await fixture.store.read())!, entry = snapshot.ledger.reservations[0]!;
    for (const request of entry.requests) request.judge = request.judge.replace("claude-haiku-5-5:", "claude-sonnet-5-5:");
    for (const evidence of Object.values(entry.evidence)) for (const card of evidence.cards) {
      delete (card as Partial<typeof card>).archetypes; delete (card as Partial<typeof card>).archetype;
    }
    await fixture.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false, maxRequests: 0 });
    expect(report.collected).toBe(2); expect(report.pending).toBe(0);
    expect(report.runSpendUsd).toBe(0.0007);
    const settled = (await fixture.store.read())!.ledger.reservations[0]!;
    expect(settled.accepted).toHaveLength(2);
    expect(settled.accepted!.every(row => row.model === "claude-sonnet-5-5" && row.judge.startsWith("claude-sonnet-5-5:"))).toBe(true);
  });
  it("bills unusable replies without storing canned reviews and retries on a later run", async () => {
    const fixture = await setup(), mock = endpoint({ malformed: true });
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const collected = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(collected.collected).toBe(2); expect(collected.submitted).toBe(0);
    expect(collected.runSpendUsd).toBeGreaterThan(0); expect(collected.acceptedRecords).toEqual([]);
    expect(bridgeGate(fixture.db, fixture.bridges[0]!).state).toBe("pending");
    expect(fixture.db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 0 });
    expect((await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false })).submitted).toBe(2);
  });
  it("prices a dry run without constructing a client or changing the ledger", async () => {
    const fixture = await setup(), before = readFileSync(join(fixture.directory, "ledger.json"), "utf8");
    const report = await runBridgeBatchJudging({ ...fixture, dryRun: true });
    expect(report.pairs).toBe(1); expect(report.requests).toBe(2);
    expect(report.estimatedInputTokens).toBeGreaterThan(0); expect(report.estimatedOutputTokens).toBeGreaterThan(0);
    expect(report.estimatedCostUsd).toBeCloseTo((report.estimatedInputTokens * 0.10 + report.estimatedOutputTokens * 0.50) / 1_000_000 * 0.5, 10);
    expect(readFileSync(join(fixture.directory, "ledger.json"), "utf8")).toBe(before);
  });

  it("submits two framings through the SDK, collects them and reuses their evidence hashes", async () => {
    const fixture = await setup(), mock = endpoint({ model: "claude-haiku-5-5-20261001" });
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

  it("bills collected replies while dropping ungrounded outside-card prose", async () => {
    const fixture = await setup(), mock = endpoint({ lockNote: "Summon Blue-Eyes White Dragon to avoid the restriction." });
    await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    const report = await runBridgeBatchJudging({ ...fixture, client: mock.client, dryRun: false });
    expect(report.collected).toBe(2);
    expect(report.runSpendUsd).toBeGreaterThan(0);
    expect(report.acceptedRecords.every(record => record.result.verdict === "valid" && record.result.lock_note === "")).toBe(true);
    expect(bridgeGate(fixture.db, fixture.bridges[0]!).state).toBe("shown");
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
    const stale = { ...original, judge: identity.join(":"), result: { ...original.result, line: Array.from({ length: 4 }, () => original.result.line[0]!) } }, path = join(fixture.directory, "bridge-judgements.jsonl.gz");
    writeFileSync(path, gzipSync(JSON.stringify(stale) + "\n"));
    expect(importBridgeJudgements(fixture.db, fixture.directory)).toEqual({ imported: 0, skipped: 1 });
    expect(exportBridgeBatchJudgements(fixture.db, fixture.directory)).toBe(3);
    const rows = gunzipSync(readFileSync(path)).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toContainEqual(stale);
    const root = join(fixture.directory, "legacy-base"), output = join(fixture.directory, "legacy-candidate");
    mkdirSync(join(root, "packages/shared/data/effects"), { recursive: true }); mkdirSync(join(output, "packages/shared/data/effects"), { recursive: true });
    const before = gzipSync(JSON.stringify(stale) + "\n"), after = readFileSync(path);
    writeFileSync(join(root, BRIDGE_JUDGEMENT_FILE), before); writeFileSync(join(output, BRIDGE_JUDGEMENT_FILE), after);
    writeFileSync(join(output, "bridge-judge-report.json"), JSON.stringify(report));
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(validateBridgeJudgementCandidate(root, output, { files: [BRIDGE_JUDGEMENT_FILE], base_sha256: sha(before), sha256: sha(after), records: 3 })).toEqual([BRIDGE_JUDGEMENT_FILE]);
    expect(bridgeGate(fixture.db, fixture.bridges[0]!).judgements).toHaveLength(2);
    expect(exportBridgeBatchJudgements(fixture.db, fixture.directory)).toBe(3);
  });
});
