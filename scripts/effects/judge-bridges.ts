import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { migrate } from "@yugidraft/shared/db";
import {
  BRIDGE_JUDGE_FRAMINGS, BRIDGE_JUDGE_IDENTITIES, BRIDGE_JUDGE_MODEL, BRIDGE_JUDGE_RESERVATION_MICROS, BridgeJudgementRecordSchema,
  bridgeJudgeBilledMicros, bridgeJudgeRates, bridgeJudgeReservationMicros, bridgeJudgeIdentity, bridgeJudgeRequest, buildBridgeJudgeEvidence,
  importBridgeArtifact, importBridgeJudgements, importCardEffectArtifact, makeBridgeJudgementRecord, parseBridgeJudgement,
  readBridgeJudgements, saveBridgeJudgement,
  type ArchetypeBridge, type BridgeJudgeEvidence, type BridgeJudgeFraming, type BridgeJudgementRecord,
} from "@yugidraft/shared/cards/effects";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const MAX_INPUT_TOKENS = 1_000_000, MAX_OUTPUT_TOKENS = 4096, BATCH_REQUEST_RESERVATION_MICROS = Math.ceil(BRIDGE_JUDGE_RESERVATION_MICROS / 2);
const MAX_LEDGER_BYTES = 250_000_000, MAX_REQUESTS_PER_BATCH = 1000;
type Request = { customId: string; evidenceHash: string; inputHash: string; framing: BridgeJudgeFraming; judge: string; reservedMicros?: number };
type Reservation = {
  id: string; month: string; createdAt: string; state: "submission_started" | "submitted" | "settled";
  reservedMicros: number; requests: Request[]; evidence: Record<string, BridgeJudgeEvidence>; batchId?: string;
  actualMicros?: number; accepted?: BridgeJudgementRecord[];
};
export interface BridgeBatchLedger { version: 1; months: Record<string, number>; reservations: Reservation[] }
export interface BridgeBatchStore {
  read(): Promise<{ revision: string; ledger: BridgeBatchLedger } | undefined>;
  compareAndSwap(revision: string | undefined, ledger: BridgeBatchLedger): Promise<string>;
}
type BatchRequest = { custom_id: string; params: ReturnType<typeof bridgeJudgeRequest> };
export interface BridgeBatchClient {
  create(requests: BatchRequest[]): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ processing_status: string }>;
  results(id: string): Promise<unknown[]>;
}
export interface BridgeBatchReport {
  mode: "dry-run" | "live"; pairs: number; requests: number; cached: number; submitted: number; collected: number; pending: number;
  estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number;
  runSpendUsd: number; monthlySpendUsd: number; reservedUsd: number; deferred: string[];
  acceptedRecords: BridgeJudgementRecord[];
}
export const emptyBridgeBatchLedger = (): BridgeBatchLedger => ({ version: 1, months: {}, reservations: [] });

function validateLedger(value: unknown): BridgeBatchLedger {
  const ledger = value as BridgeBatchLedger;
  if (!ledger || ledger.version !== 1 || !ledger.months || !Array.isArray(ledger.reservations)) throw new Error("Invalid bridge batch ledger");
  const ids = new Set<string>(), totals: Record<string, number> = {};
  for (const entry of ledger.reservations) {
    if (!/^[a-f0-9]{32}$/.test(entry.id) || ids.has(entry.id) || !/^\d{4}-\d{2}$/.test(entry.month) || !Number.isFinite(Date.parse(entry.createdAt)) || !["submission_started", "submitted", "settled"].includes(entry.state)
      || !Array.isArray(entry.requests) || !entry.requests.length || entry.requests.length > MAX_REQUESTS_PER_BATCH || entry.reservedMicros !== entry.requests.reduce((sum, request) => sum + (request.reservedMicros ?? BATCH_REQUEST_RESERVATION_MICROS), 0) || !entry.evidence) throw new Error("Invalid bridge batch reservation");
    ids.add(entry.id);
    const customIds = new Set<string>();
    for (const request of entry.requests) {
      if (request.reservedMicros !== undefined && (!Number.isSafeInteger(request.reservedMicros) || request.reservedMicros < 1)) throw new Error("Invalid bridge request reservation");
      if (customIds.has(request.customId) || !/^bj_[a-f0-9]{32}_\d+$/.test(request.customId) || !/^[a-f0-9]{64}$/.test(request.evidenceHash) || !/^[a-f0-9]{64}$/.test(request.inputHash) || !BRIDGE_JUDGE_FRAMINGS.includes(request.framing) || typeof request.judge !== "string") throw new Error("Invalid bridge batch request identity");
      customIds.add(request.customId);
      if (entry.state !== "settled" && (entry.evidence[request.inputHash]?.evidence_hash !== request.evidenceHash || entry.evidence[request.inputHash]?.input_hash !== request.inputHash)) throw new Error("Missing durable bridge evidence");
    }
    if (entry.state !== "submission_started" && !/^msgbatch_[\w]+$/.test(entry.batchId ?? "")) throw new Error("Missing immutable bridge batch identity");
    if (entry.state === "settled") {
      if (!Number.isSafeInteger(entry.actualMicros) || entry.actualMicros! < 0 || entry.actualMicros! > entry.reservedMicros || !Array.isArray(entry.accepted)) throw new Error("Invalid settled bridge batch billing");
      totals[entry.month] = (totals[entry.month] ?? 0) + entry.actualMicros!;
    }
  }
  if (JSON.stringify(Object.entries(totals).sort()) !== JSON.stringify(Object.entries(ledger.months).sort())) throw new Error("Bridge monthly totals differ from settled history");
  return ledger;
}

export class FileBridgeBatchStore implements BridgeBatchStore {
  constructor(private path: string) {}
  async read() {
    if (!existsSync(this.path)) return undefined;
    const bytes = readFileSync(this.path, "utf8");
    return { revision: hash(bytes), ledger: validateLedger(JSON.parse(bytes)) };
  }
  async compareAndSwap(revision: string | undefined, ledger: BridgeBatchLedger) {
    mkdirSync(dirname(this.path), { recursive: true }); const lock = `${this.path}.lock`; mkdirSync(lock);
    try {
      if ((await this.read())?.revision !== revision) throw new Error("Bridge ledger CAS conflict");
      const bytes = JSON.stringify(validateLedger(ledger)) + "\n";
      writeFileSync(`${this.path}.next`, bytes, { mode: 0o600 }); renameSync(`${this.path}.next`, this.path); return hash(bytes);
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
}

/** Compare-and-swap state is persisted before any paid submission. */
export class GithubBridgeBatchStore implements BridgeBatchStore {
  constructor(private repository: string, private branch = "state/bridge-judging") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) throw new Error("Invalid bridge ledger repository or branch");
  }
  private api(path: string, method?: string, body?: unknown): any {
    const args = ["api", `repos/${this.repository}/${path}`]; if (method) args.push("--method", method, "--input", "-");
    return JSON.parse(execFileSync("gh", args, { encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 80_000_000, stdio: ["pipe", "pipe", "pipe"] }));
  }
  async read() {
    let ref;
    try { ref = this.api(`git/ref/heads/${this.branch}`); }
    catch (error) { if (String((error as { stderr?: unknown }).stderr).includes("HTTP 404")) return undefined; throw new Error("Cannot read durable bridge ledger", { cause: error }); }
    const commit = this.api(`git/commits/${ref.object.sha}`), tree = this.api(`git/trees/${commit.tree.sha}`);
    const row = tree.tree.find((entry: any) => entry.path === "ledger.json.gz" && entry.type === "blob");
    if (!row) throw new Error("Missing ledger.json.gz on bridge state branch");
    const blob = this.api(`git/blobs/${row.sha}`);
    if (blob.encoding !== "base64" || blob.size > 50_000_000) throw new Error("Invalid durable bridge ledger blob");
    const bytes = gunzipSync(Buffer.from(blob.content.replace(/\s/g, ""), "base64"), { maxOutputLength: MAX_LEDGER_BYTES });
    return { revision: String(ref.object.sha), ledger: validateLedger(JSON.parse(bytes.toString("utf8"))) };
  }
  async compareAndSwap(revision: string | undefined, ledger: BridgeBatchLedger) {
    if ((await this.read())?.revision !== revision) throw new Error("Bridge ledger CAS conflict");
    const bytes = Buffer.from(JSON.stringify(validateLedger(ledger)) + "\n");
    if (bytes.length > MAX_LEDGER_BYTES) throw new Error("Bridge ledger exceeds size bound");
    const compressed = gzipSync(bytes);
    if (compressed.length > 50_000_000) throw new Error("Compressed bridge ledger exceeds size bound");
    const blob = this.api("git/blobs", "POST", { content: compressed.toString("base64"), encoding: "base64" });
    const prior = revision ? this.api(`git/commits/${revision}`) : undefined;
    const tree = this.api("git/trees", "POST", { ...(prior ? { base_tree: prior.tree.sha } : {}), tree: [{ path: "ledger.json.gz", mode: "100644", type: "blob", sha: blob.sha }] });
    const commit = this.api("git/commits", "POST", { message: "chore(cards): persist bridge judging state", tree: tree.sha, parents: revision ? [revision] : [] });
    try {
      if (revision) this.api(`git/refs/heads/${this.branch}`, "PATCH", { sha: commit.sha, force: false });
      else this.api("git/refs", "POST", { ref: `refs/heads/${this.branch}`, sha: commit.sha });
    } catch (error) { if ((await this.read())?.revision !== commit.sha) throw new Error("Bridge ledger CAS write failed", { cause: error }); }
    return String(commit.sha);
  }
}

export class AnthropicBridgeBatchClient implements BridgeBatchClient {
  constructor(private client: Anthropic) {}
  async create(requests: BatchRequest[]) {
    const batch = await this.client.messages.batches.create({ requests }, { maxRetries: 0 });
    if (!/^msgbatch_[\w]+$/.test(batch.id)) throw new Error("Invalid immutable bridge batch ID");
    return { id: batch.id };
  }
  async retrieve(id: string) { const batch = await this.client.messages.batches.retrieve(id); return { processing_status: batch.processing_status }; }
  async results(id: string) {
    const rows: unknown[] = []; let bytes = 0;
    for await (const row of await this.client.messages.batches.results(id)) {
      bytes += Buffer.byteLength(JSON.stringify(row)); if (bytes > 50_000_000) throw new Error("Bridge batch results exceed size bound"); rows.push(row);
    }
    return rows;
  }
}

/** Old prompt rows remain inert history; runtime gates accept current identities. */
export function exportBridgeBatchJudgements(db: Database.Database, directory: string): number {
  const path = join(directory, "bridge-judgements.jsonl.gz"), records = new Map<string, BridgeJudgementRecord>();
  if (existsSync(path)) {
    const compressed = readFileSync(path);
    if (compressed.length > 30_000_000) throw new Error("Bridge judgement artifact is too large");
    for (const line of gunzipSync(compressed, { maxOutputLength: 150_000_000 }).toString("utf8").split("\n").filter(Boolean)) {
      const row = BridgeJudgementRecordSchema.parse(JSON.parse(line)), identity = `${row.evidence_hash}:${row.judge}`;
      if (records.has(identity)) throw new Error("Duplicate cached bridge judgement");
      records.set(identity, row);
    }
  }
  for (const value of db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY evidence_hash,judge").all() as { judgement_json: string }[]) {
    const row = BridgeJudgementRecordSchema.parse(JSON.parse(value.judgement_json));
    if (row.judge === `${BRIDGE_JUDGE_IDENTITIES[row.framing]}:${row.input_hash}`) records.set(`${row.evidence_hash}:${row.judge}`, row);
  }
  const rows = [...records.values()].sort((a, b) => a.evidence_hash.localeCompare(b.evidence_hash) || a.judge.localeCompare(b.judge));
  const bytes = rows.length ? rows.map(row => JSON.stringify(row)).join("\n") + "\n" : "", compressed = gzipSync(bytes, { level: 9 });
  if (Buffer.byteLength(bytes) > 150_000_000 || compressed.length > 30_000_000) throw new Error("Bridge judgement artifact is too large");
  mkdirSync(directory, { recursive: true }); writeFileSync(`${path}.next`, compressed); renameSync(`${path}.next`, path); return rows.length;
}

function resultsFor(entry: Reservation, rows: unknown[], db?: Database.Database) {
  const expected = new Map(entry.requests.map(request => [request.customId, request])), seen = new Set<string>(), accepted: BridgeJudgementRecord[] = [];
  let actualMicros = 0;
  for (const raw of rows) {
    const row = raw as any, request = expected.get(row?.custom_id);
    if (!request || seen.has(row.custom_id) || !row.result) throw new Error("Unknown or duplicate bridge Batch results identity");
    seen.add(row.custom_id);
    if (["errored", "canceled", "expired"].includes(row.result.type)) continue;
    const message = row.result.message, usage = message?.usage;
    if (row.result.type !== "succeeded" || !message?.model?.startsWith(BRIDGE_JUDGE_MODEL) || !usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0 || usage.output_tokens > MAX_OUTPUT_TOKENS
      || [usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0].some(value => !Number.isSafeInteger(value) || value < 0)
      || usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) > MAX_INPUT_TOKENS) throw new Error("Invalid billed bridge Batch usage");
    actualMicros += bridgeJudgeBilledMicros(usage, true, message.model);
    const evidence = entry.evidence[request.inputHash]!;
    let parsed = null;
    try {
      if (message.stop_reason === "end_turn" && Array.isArray(message.content)) parsed = parseBridgeJudgement(JSON.parse(message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("")), evidence, db);
    } catch { /* Malformed output stays pending. */ }
    if (parsed) accepted.push({ ...makeBridgeJudgementRecord(evidence, request.framing, parsed, new Date(entry.createdAt), db), judge: request.judge });
  }
  if (seen.size !== expected.size) throw new Error("Incomplete Batch results; reservation remains held");
  if (actualMicros > entry.reservedMicros) throw new Error("Bridge Batch usage exceeds reservation");
  return { actualMicros, accepted };
}

export async function recoverBridgeBatchSubmission(store: BridgeBatchStore, client: BridgeBatchClient, reservationId: string, batchId: string) {
  const snapshot = await store.read(), entry = snapshot?.ledger.reservations.find(row => row.id === reservationId);
  if (!snapshot || !entry || entry.state !== "submission_started" || !/^msgbatch_[\w]+$/.test(batchId)) throw new Error("No ambiguous bridge reservation to recover");
  if ((await client.retrieve(batchId)).processing_status !== "ended") return false;
  const outcome = resultsFor(entry, await client.results(batchId));
  Object.assign(entry, outcome, { batchId, state: "settled", evidence: {} });
  snapshot.ledger.months[entry.month] = (snapshot.ledger.months[entry.month] ?? 0) + outcome.actualMicros;
  await store.compareAndSwap(snapshot.revision, snapshot.ledger); return true;
}

export async function runBridgeBatchJudging(options: {
  db: Database.Database; store: BridgeBatchStore; client?: BridgeBatchClient; dryRun?: boolean; now?: () => Date;
  bridges?: ArchetypeBridge[]; monthlyUsd?: string; maxRequests?: number;
}): Promise<BridgeBatchReport> {
  const dryRun = options.dryRun !== false, instant = (options.now ?? (() => new Date()))(), month = instant.toISOString().slice(0, 7);
  const snapshot = dryRun ? undefined : await options.store.read();
  if (!dryRun && !snapshot) throw new Error("Durable bridge ledger is missing; initialize it explicitly before live judging");
  const ledger = snapshot?.ledger ?? emptyBridgeBatchLedger(); let revision = snapshot?.revision;
  const attempted = new Set<string>();
  const persist = async () => { revision = await options.store.compareAndSwap(revision, ledger); };
  const report: BridgeBatchReport = { mode: dryRun ? "dry-run" : "live", pairs: 0, requests: 0, cached: 0, submitted: 0, collected: 0, pending: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: 0, runSpendUsd: 0, monthlySpendUsd: 0, reservedUsd: 0, deferred: [], acceptedRecords: [] };
  if (!dryRun) {
    if (!options.client) throw new Error("Live bridge judging requires a Batch client");
    for (const entry of ledger.reservations) {
      if (entry.state !== "submitted" || (await options.client.retrieve(entry.batchId!)).processing_status !== "ended") continue;
      const outcome = resultsFor(entry, await options.client.results(entry.batchId!), options.db);
      for (const request of entry.requests) attempted.add(`${request.evidenceHash}:${request.inputHash}:${request.judge}`);
      Object.assign(entry, outcome, { state: "settled", evidence: {} });
      ledger.months[entry.month] = (ledger.months[entry.month] ?? 0) + outcome.actualMicros;
      await persist(); report.collected += entry.requests.length; report.runSpendUsd += outcome.actualMicros / 1_000_000;
    }
    for (const entry of ledger.reservations) for (const record of entry.accepted ?? []) if (record.judge === `${BRIDGE_JUDGE_IDENTITIES[record.framing]}:${record.input_hash}`) { saveBridgeJudgement(options.db, record); report.acceptedRecords.push(record); }
  }
  const bridges = options.bridges ?? (options.db.prepare("SELECT bridge_json FROM (SELECT bridge_json, ROW_NUMBER() OVER (PARTITION BY source,format ORDER BY score DESC,target) AS rank FROM archetype_bridge) WHERE rank<=10").all() as { bridge_json: string }[]).map(row => JSON.parse(row.bridge_json) as ArchetypeBridge);
  const pending = new Set(ledger.reservations.filter(entry => entry.state !== "settled").flatMap(entry => entry.requests.map(request => `${request.evidenceHash}:${request.inputHash}:${request.judge}`)));
  const eligible: { evidence: BridgeJudgeEvidence; framing: BridgeJudgeFraming; reservedMicros: number }[] = [], queued = new Set<string>();
  for (const bridge of bridges) {
    const evidence = buildBridgeJudgeEvidence(options.db, bridge); if (!evidence) continue;
    const cached = new Set(readBridgeJudgements(options.db, bridge.evidence_hash).filter(row => row.input_hash === evidence.input_hash).map(row => row.judge));
    let missing = false;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) {
      const identity = bridgeJudgeIdentity(evidence, framing), key = `${bridge.evidence_hash}:${evidence.input_hash}:${identity}`;
      if (cached.has(identity)) { report.cached++; continue; }
      if (pending.has(key) || attempted.has(key) || queued.has(key)) continue;
      const params = bridgeJudgeRequest(evidence, framing);
      missing = true; queued.add(key); eligible.push({ evidence, framing, reservedMicros: bridgeJudgeReservationMicros(params, true) });
      // UTF-8 bytes deliberately overestimate ordinary English token counts.
      const inputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(params)) / 3), rates = bridgeJudgeRates(params.model, inputTokens);
      report.estimatedInputTokens += inputTokens;
      report.estimatedOutputTokens += 700;
      report.estimatedCostUsd += (inputTokens * rates.input + 700 * rates.output) / 1_000_000 * 0.5;
    }
    if (missing) report.pairs++;
  }
  report.requests = eligible.length;
  if (ledger.reservations.some(entry => entry.state === "submission_started")) report.deferred.push("ambiguous-submission");
  const configuredCap = options.monthlyUsd?.trim(), cap = configuredCap ? Number(configuredCap) * 1_000_000 : Infinity;
  if (Number.isNaN(cap) || cap < 0 || (configuredCap && !Number.isFinite(cap))) throw new Error("BRIDGE_JUDGE_MONTHLY_USD must be a nonnegative finite number");
  const unsettled = ledger.reservations.filter(entry => entry.state !== "settled").reduce((sum, entry) => sum + entry.reservedMicros, 0);
  const maximum = options.maxRequests ?? eligible.length;
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 100_000) throw new Error("--max-requests must be between 0 and 100000");
  let count = 0, available = cap - (ledger.months[month] ?? 0) - unsettled;
  while (count < Math.min(maximum, eligible.length) && eligible[count]!.reservedMicros <= available) available -= eligible[count++]!.reservedMicros;
  if (eligible.length && !count && maximum) report.deferred.push("monthly-budget");
  for (let start = 0; !dryRun && start < count && !report.deferred.includes("ambiguous-submission"); start += MAX_REQUESTS_PER_BATCH) {
    const id = randomBytes(16).toString("hex"), selected = eligible.slice(start, Math.min(count, start + MAX_REQUESTS_PER_BATCH));
    const entry: Reservation = { id, month, createdAt: instant.toISOString(), state: "submission_started", reservedMicros: selected.reduce((sum, row) => sum + row.reservedMicros, 0),
      requests: selected.map(({ evidence, framing, reservedMicros }, index) => ({ customId: `bj_${id}_${index}`, evidenceHash: evidence.evidence_hash, inputHash: evidence.input_hash, framing, judge: bridgeJudgeIdentity(evidence, framing), reservedMicros })), evidence: Object.fromEntries(selected.map(row => [row.evidence.input_hash, row.evidence])) };
    ledger.reservations.push(entry); await persist();
    try {
      const batch = await options.client!.create(entry.requests.map(request => ({ custom_id: request.customId, params: bridgeJudgeRequest(entry.evidence[request.inputHash]!, request.framing) })));
      entry.batchId = batch.id; entry.state = "submitted"; await persist(); report.submitted += selected.length;
    } catch (error) { throw new Error(`Bridge Batch submission is uncertain; reservation ${id}${entry.batchId ? ` / batch ${entry.batchId}` : ""} retained without automatic retry`, { cause: error }); }
  }
  report.pending = ledger.reservations.filter(entry => entry.state !== "settled").reduce((sum, entry) => sum + entry.requests.length, 0);
  report.reservedUsd = ledger.reservations.filter(entry => entry.state !== "settled").reduce((sum, entry) => sum + entry.reservedMicros, 0) / 1_000_000;
  report.monthlySpendUsd = (ledger.months[month] ?? 0) / 1_000_000;
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false }, "initialize-ledger": { type: "boolean", default: false }, directory: { type: "string" }, output: { type: "string" }, "max-requests": { type: "string" }, "recover-reservation": { type: "string" }, "recover-batch": { type: "string" } } });
  if (values.live && values["dry-run"]) throw new Error("Choose either --live or --dry-run");
  const dryRun = !values.live, directory = resolve(values.directory ?? "packages/shared/data/effects");
  const store: BridgeBatchStore = !dryRun && process.env.GITHUB_REPOSITORY ? new GithubBridgeBatchStore(process.env.GITHUB_REPOSITORY) : { read: async () => undefined, compareAndSwap: async () => { throw new Error("Live bridge judging requires GITHUB_REPOSITORY and durable GitHub state"); } };
  if (values["initialize-ledger"]) {
    if (dryRun) throw new Error("Ledger initialization requires explicit --live");
    if (await store.read()) throw new Error("Bridge ledger already exists; never reset billing history");
    await store.compareAndSwap(undefined, emptyBridgeBatchLedger()); console.log("Initialized bridge judging ledger; no paid request submitted."); return;
  }
  const db = new Database(":memory:");
  try {
    migrate(db); importCardEffectArtifact(db, { directory }); importBridgeArtifact(db, directory); importBridgeJudgements(db, directory);
    const cachePath = join(directory, "bridge-judgements.jsonl.gz");
    if (existsSync(cachePath)) for (const line of gunzipSync(readFileSync(cachePath), { maxOutputLength: 150_000_000 }).toString("utf8").split("\n").filter(Boolean)) {
      const record = BridgeJudgementRecordSchema.parse(JSON.parse(line));
      if (record.judge === `${BRIDGE_JUDGE_IDENTITIES[record.framing]}:${record.input_hash}`) saveBridgeJudgement(db, record);
    }
    const client = dryRun ? undefined : new AnthropicBridgeBatchClient(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 }));
    if (values["recover-reservation"] || values["recover-batch"]) {
      if (!client || !values["recover-reservation"] || !values["recover-batch"]) throw new Error("Recovery requires --live and both immutable reservation/batch IDs");
      if (!await recoverBridgeBatchSubmission(store, client, values["recover-reservation"], values["recover-batch"])) throw new Error("Recovery batch is still processing; reservation remains held");
    }
    const report = await runBridgeBatchJudging({ db, store, client, dryRun, monthlyUsd: process.env.BRIDGE_JUDGE_MONTHLY_USD, maxRequests: values["max-requests"] === undefined ? undefined : Number(values["max-requests"]) });
    if (!dryRun) exportBridgeBatchJudgements(db, directory);
    if (values.output) {
      const output = resolve(values.output); mkdirSync(output, { recursive: true }); writeFileSync(join(output, "bridge-judge-report.json"), JSON.stringify(report, null, 2) + "\n");
      writeFileSync(join(output, "bridge-judge-report.md"), `## Bridge judging\n\nMode: ${report.mode}. Eligible: ${report.pairs} pairs / ${report.requests} judge requests. Estimated tokens: ${report.estimatedInputTokens} input and ${report.estimatedOutputTokens} output. Estimated Batch cost: $${report.estimatedCostUsd.toFixed(6)} at $0.10/M input and $0.50/M output, less 50%.\n\nSubmitted: ${report.submitted}. Collected: ${report.collected}. Pending: ${report.pending}. Spend collected this run: $${report.runSpendUsd.toFixed(6)}. Month settled: $${report.monthlySpendUsd.toFixed(6)}; unsettled reservation: $${report.reservedUsd.toFixed(6)}. ${process.env.BRIDGE_JUDGE_MONTHLY_USD ? `Optional monthly cap: $${process.env.BRIDGE_JUDGE_MONTHLY_USD}.` : "No monthly hard cap is configured."}\n\n${report.deferred.length ? `Deferred: ${report.deferred.join(", ")}.\n` : ""}`);
    }
    const { acceptedRecords, ...summary } = report; console.log(JSON.stringify({ ...summary, acceptedRecords: acceptedRecords.length }, null, 2));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
