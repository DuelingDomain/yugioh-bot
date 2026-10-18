import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CardTags, fillDefaults } from "@yugidraft/shared/cards/effects";
import type { Card } from "@yugidraft/shared/cards/effects";
import { hashCardEffectSourceText } from "@yugidraft/shared/cards/effects";
import { cleanTags, repairEntry } from "./tag-cleanup.js";
import { buildSystemPrompt, TagEntry } from "./tagging-prompt.js";
import { alignArtifactToCatalog, isTaggable, loadTaggingCatalog, readPinnedArtifact } from "./catalog.js";
import { AnthropicBatchClient, type BatchClient } from "./batch-client.js";
import { budgetUsed, createEmptyLedger, GithubLedgerStore, MAX_CARDS_PER_REQUEST, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, MODEL, MONTHLY_CAP_MICROS, REQUEST_RESERVATION_MICROS, type AcceptedTag, type LedgerStore, type Reservation } from "./budget-ledger.js";
import { writeEffectArtifactCandidate } from "./artifact-output.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export interface TaggingReport { mode: "dry-run" | "live"; candidates: number; submitted: number; collected: number; reused: number; pending: number; usedMicros: number; deferred: string[]; accepted: AcceptedTag[] }
export interface TaggingOptions { cards: Card[]; store: LedgerStore; client?: BatchClient; dryRun?: boolean; now?: () => Date; maxRequests?: number; artifactDirectory?: string }
const isObject = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function parseResults(reservation: Reservation, results: unknown[]): { actualMicros: number; accepted: AcceptedTag[]; failures: number[] } {
  const expected = new Map(reservation.requests.map(req => [req.customId, req]));
  const seen = new Set<string>(), accepted: AcceptedTag[] = [], failures: number[] = [];
  let actualMicros = 0;
  for (const raw of results) {
    if (!isObject(raw) || typeof raw.custom_id !== "string" || !expected.has(raw.custom_id) || seen.has(raw.custom_id) || !isObject(raw.result)) throw new Error("Unknown or duplicate Batch results identity");
    seen.add(raw.custom_id);
    const req = expected.get(raw.custom_id)!, result = raw.result;
    if (["errored", "canceled", "expired"].includes(result.type)) { failures.push(...req.cards.map(card => card.id)); continue; }
    if (result.type !== "succeeded" || !isObject(result.message) || !isObject(result.message.usage)) throw new Error("Incomplete billed Batch results");
    const message = result.message, usage = message.usage;
    const input = usage.input_tokens, output = usage.output_tokens;
    if (message.model !== MODEL || !Number.isSafeInteger(input) || input < 0 || input > MAX_INPUT_TOKENS || !Number.isSafeInteger(output) || output < 0 || output > MAX_OUTPUT_TOKENS || (usage.cache_creation_input_tokens ?? 0) !== 0 || (usage.cache_read_input_tokens ?? 0) !== 0) throw new Error("Batch usage violates reserved token bounds");
    // Batch rates: $0.50/M input and $2.50/M output; round UP per request.
    actualMicros += Math.ceil((input + 5 * output) / 2);
    try {
      if (message.stop_reason !== "end_turn" || !Array.isArray(message.content)) throw new Error("Incomplete tagging output");
      const text = message.content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("");
      const parsed = JSON.parse(text);
      if (!isObject(parsed) || !Array.isArray(parsed.cards) || parsed.cards.length !== req.cards.length) throw new Error("Tag card count mismatch");
      const cards = new Map(req.cards.map(card => [card.id, card as Card]));
      const emitted = new Set<number>(), rows: AcceptedTag[] = [];
      for (const rawEntry of parsed.cards) {
        const entry = TagEntry.parse(repairEntry(fillDefaults(rawEntry)));
        if (!cards.has(entry.id) || emitted.has(entry.id)) throw new Error("Unexpected tagging card ID");
        emitted.add(entry.id);
        const card = cards.get(entry.id)!, { id, ...tags } = entry;
        const clean = CardTags.parse(cleanTags(card, tags));
        rows.push({ id, name: card.name, model: MODEL, tags: clean, inputHash: req.hashes[id], promptHash: reservation.promptHash,
          reservationId: reservation.id, batchId: reservation.batchId!, customId: req.customId, taggedAt: reservation.createdAt });
      }
      accepted.push(...rows);
    } catch { failures.push(...req.cards.map(card => card.id)); }
  }
  if (seen.size !== expected.size) throw new Error("Incomplete Batch results; reservation remains held");
  if (actualMicros > reservation.reservedMicros) throw new Error("Batch usage exceeds reservation");
  return { actualMicros, accepted, failures };
}

/** Recover by a known immutable ID only after every reserved custom_id matches.
 * In-progress or mismatching batches cannot release any uncertain reservation.
 */
export async function recoverTaggingSubmission(store: LedgerStore, client: BatchClient, reservationId: string, batchId: string): Promise<boolean> {
  const snapshot = await store.read();
  const entry = snapshot?.ledger.reservations.find(entry => entry.id === reservationId);
  if (!snapshot || !entry || entry.state !== "submission_started") throw new Error("No ambiguous durable reservation to recover");
  if ((await client.retrieve(batchId)).processing_status !== "ended") return false;
  const candidate = { ...entry, batchId };
  const outcome = parseResults(candidate, await client.results(batchId));
  Object.assign(entry, outcome, { batchId, state: "settled" });
  snapshot.ledger.months[entry.month] = (snapshot.ledger.months[entry.month] ?? 0) + outcome.actualMicros;
  await store.compareAndSwap(snapshot.revision, snapshot.ledger);
  return true;
}

/** Dry run is the default. Live writes are durable BEFORE any Anthropic POST. */
export async function runTagging(options: TaggingOptions): Promise<TaggingReport> {
  const dryRun = options.dryRun !== false, now = options.now ?? (() => new Date()), instant = now(), month = instant.toISOString().slice(0, 7);
  const artifact = readPinnedArtifact(options.artifactDirectory);
  const aligned = alignArtifactToCatalog(artifact, options.cards);
  const byId = new Map(options.cards.filter(isTaggable).map(card => [card.id, card]));
  const candidates = [...byId.values()].filter(card => !aligned.tagIds.has(card.id) || aligned.hashes.get(card.id) !== hashCardEffectSourceText(card)).sort((a, b) => b.views - a.views || a.id - b.id);
  let snapshot = await options.store.read();
  if (!snapshot && !dryRun) throw new Error("Durable budget ledger is missing; explicit initialization is required");
  let ledger = snapshot?.ledger ?? createEmptyLedger(), revision = snapshot?.revision;
  const persist = async () => { revision = await options.store.compareAndSwap(revision, ledger); };
  const report: TaggingReport = { mode: dryRun ? "dry-run" : "live", candidates: candidates.length, submitted: 0, collected: 0, reused: 0, pending: 0, usedMicros: 0, deferred: [], accepted: [] };
  if (!dryRun) {
    if (!options.client) throw new Error("Live tagging requires a Batch client");
    for (const entry of ledger.reservations) {
      if (entry.state !== "submitted") continue;
      if ((await options.client.retrieve(entry.batchId!)).processing_status !== "ended") continue;
      const outcome = parseResults(entry, await options.client.results(entry.batchId!));
      entry.state = "settled"; Object.assign(entry, outcome);
      ledger.months[entry.month] = (ledger.months[entry.month] ?? 0) + outcome.actualMicros;
      if (ledger.months[entry.month] > MONTHLY_CAP_MICROS) throw new Error("Monthly settled spend exceeds hard cap");
      await persist(); report.collected++;
    }
  }
  const reusable = new Map<number, AcceptedTag>();
  for (const entry of ledger.reservations) for (const tag of entry.accepted ?? []) {
    const card = byId.get(tag.id);
    if (card && tag.inputHash === hashCardEffectSourceText(card) && (!reusable.has(tag.id) || reusable.get(tag.id)!.taggedAt < tag.taggedAt)) reusable.set(tag.id, tag);
  }
  report.accepted = candidates.flatMap(card => reusable.has(card.id) ? [reusable.get(card.id)!] : []);
  report.reused = report.accepted.length;
  const pending = new Set(ledger.reservations.filter(entry => entry.state !== "settled").flatMap(entry => entry.requests.flatMap(req => req.cards.map(card => card.id))));
  const recentFailures = new Set(ledger.reservations.filter(entry => entry.state === "settled" && entry.month === month).flatMap(entry => entry.requests.flatMap(req => req.cards.filter(card => entry.failures?.includes(card.id) && req.hashes[card.id] === hashCardEffectSourceText(byId.get(card.id) ?? card as Card)).map(card => card.id))));
  const eligible = candidates.filter(card => !reusable.has(card.id) && !pending.has(card.id) && !recentFailures.has(card.id));
  if (ledger.reservations.some(entry => entry.state === "submission_started")) report.deferred.push("ambiguous-submission");
  if (recentFailures.size) report.deferred.push("failed-output-this-month");
  const nextMonth = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1));
  const monthEnd = nextMonth.getTime() - instant.getTime() <= 25 * 60 * 60 * 1000;
  if (monthEnd) report.deferred.push("month-end");
  const maxRequests = options.maxRequests ?? 66;
  if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 66) throw new Error("maxRequests must be between 0 and 66");
  const availableRequests = Math.min(maxRequests, Math.max(0, Math.floor((MONTHLY_CAP_MICROS - budgetUsed(ledger, month)) / REQUEST_RESERVATION_MICROS)));
  if (candidates.length && !availableRequests && maxRequests > 0) report.deferred.push("monthly-budget");
  if (!dryRun && !monthEnd && maxRequests > 0) {
    const reserved = ledger.reservations.find(entry => entry.state === "reserved");
    let entry = reserved;
    if (!entry && availableRequests && eligible.length) {
      const cards = eligible.slice(0, availableRequests * MAX_CARDS_PER_REQUEST), id = randomBytes(16).toString("hex");
      const systemPrompt = buildSystemPrompt(options.cards), requests: Reservation["requests"] = [];
      for (let start = 0; start < cards.length; start += MAX_CARDS_PER_REQUEST) {
        const chunk = cards.slice(start, start + MAX_CARDS_PER_REQUEST);
        requests.push({ customId: `et_${id}_${requests.length}`, cards: chunk.map(card => ({ ...card })), hashes: Object.fromEntries(chunk.map(card => [card.id, hashCardEffectSourceText(card)!])) });
      }
      entry = { id, month, createdAt: instant.toISOString(), state: "reserved", reservedMicros: requests.length * REQUEST_RESERVATION_MICROS, systemPrompt, promptHash: sha(systemPrompt), requests };
      ledger.reservations.push(entry); await persist();
    }
    if (entry) {
      // Recheck the UTC window immediately before intent, including resumes.
      const submittingAt = now(), boundary = Date.UTC(submittingAt.getUTCFullYear(), submittingAt.getUTCMonth() + 1, 1);
      const submittingMonth = submittingAt.toISOString().slice(0, 7);
      if (boundary - submittingAt.getTime() <= 25 * 60 * 60 * 1000 || budgetUsed(ledger, submittingMonth) > MONTHLY_CAP_MICROS) report.deferred.push("submission-window");
      else {
        entry.month = submittingMonth; entry.createdAt = submittingAt.toISOString(); entry.state = "submission_started"; await persist();
        try {
          const batch = await options.client!.create(entry);
          entry.batchId = batch.id; entry.state = "submitted"; await persist(); report.submitted++;
        } catch (error) {
          // Durable state is still submission_started if creation or persistence
          // was uncertain. Never release its money or automatically repeat POST.
          throw new Error("Batch submission is uncertain; durable reservation retained, no automatic retry", { cause: error });
        }
      }
    }
  }
  report.pending = ledger.reservations.filter(entry => entry.state !== "settled").length;
  report.usedMicros = budgetUsed(ledger, month);
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, "initialize-ledger": { type: "boolean", default: false }, "recover-reservation": { type: "string" }, "recover-batch": { type: "string" }, "engine-directory": { type: "string" }, output: { type: "string" }, "max-requests": { type: "string" } } });
  const store: LedgerStore = process.env.GITHUB_REPOSITORY ? new GithubLedgerStore(process.env.GITHUB_REPOSITORY) : { read: async () => undefined, compareAndSwap: async () => { throw new Error("GitHub ledger is required for live mode"); } };
  if (values["initialize-ledger"]) {
    if (!values.live) throw new Error("Ledger initialization requires explicit --live");
    if (await store.read()) throw new Error("Durable ledger already exists");
    await store.compareAndSwap(undefined, createEmptyLedger()); console.log("Initialized durable budget ledger; no Anthropic request made."); return;
  }
  if (!values["engine-directory"]) throw new Error("--engine-directory is required");
  const cards = await loadTaggingCatalog(resolve(values["engine-directory"]));
  const client = values.live ? new AnthropicBatchClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" }) : undefined;
  if (values["recover-reservation"] || values["recover-batch"]) {
    if (!client || !values["recover-reservation"] || !values["recover-batch"]) throw new Error("Recovery requires --live and both immutable reservation/batch IDs");
    if (!await recoverTaggingSubmission(store, client, values["recover-reservation"], values["recover-batch"])) throw new Error("Recovery batch is still processing; reservation remains held");
  }
  const report = await runTagging({ cards, store, client, dryRun: !values.live, maxRequests: values["max-requests"] === undefined ? undefined : Number(values["max-requests"]) });
  const output = resolve(values.output ?? ".status/effect-tagging"); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(output, "report.md"), `Effect tagging: ${report.mode}\n\nCandidates: ${report.candidates}; submitted batches: ${report.submitted}; collected batches: ${report.collected}; reusable tags: ${report.reused}; pending reservations: ${report.pending}.\n\nMonthly spent + held: $${(report.usedMicros / 1_000_000).toFixed(6)} of $10. Deferred: ${report.deferred.join(", ") || "none"}.\n`);
  if (values.live) writeEffectArtifactCandidate({ root: process.cwd(), outputDirectory: output, baseSha: process.env.EFFECT_BASE_SHA ?? process.env.GITHUB_SHA ?? "", accepted: report.accepted });
  console.log(JSON.stringify({ ...report, accepted: report.accepted.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
