import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as z from "zod";
import { CardTags } from "./tags.js";
import { ArchetypeProfile } from "./synergy.js";
import { CARD_KINDS, SUBTYPES } from "./card.js";
import { hashCardEffectSourceText } from "./artifact.js";

export const MONTHLY_CAP_MICROS = 10_000_000;
export const RUN_CAP_MICROS = 2_000_000;
// Worst Haiku 5.5 Batch tier: $0.25/M input + $1.25/M output.
// Reserve the full 1M context plus 20K output, without relying on token estimates.
export const REQUEST_RESERVATION_MICROS = 275_000;
export const MODEL = "claude-haiku-5-5";
export const LEGACY_MODEL = "claude-haiku-4-5-20251001";
export const MAX_INPUT_TOKENS = 1_000_000;
export const reservationCost = (model: string) => model === LEGACY_MODEL ? 150_000 : REQUEST_RESERVATION_MICROS;
export const billedMicros = (model: string, input: number, output: number) => model === LEGACY_MODEL ? Math.ceil((input + 5 * output) / 2) : Math.ceil((input + 5 * output) / (input > 100_000 ? 4 : 20));
export const MAX_OUTPUT_TOKENS = 20_000;
export const MAX_CARDS_PER_REQUEST = 8;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const card = z.object({ id: z.number().int().positive().max(0xffffffff), name: z.string().min(1), kind: z.enum(CARD_KINDS), typeLine: z.string(), subtypes: z.array(z.enum(SUBTYPES)), text: z.string(), pendulumText: z.string().optional(), formats: z.array(z.string()), views: z.number().int().nonnegative(), url: z.string() }).passthrough();
const accepted = z.object({ id: z.number().int().positive().max(0xffffffff), name: z.string(), model: z.enum([MODEL, LEGACY_MODEL]), tags: CardTags, inputHash: digest, promptHash: digest, reservationId: z.string(), batchId: z.string(), customId: z.string(), taggedAt: z.string().datetime() }).strict();
const acceptedProfile = z.object({ archetype: z.string().min(1), cards: z.number().int().min(3), model: z.literal(MODEL), profile: ArchetypeProfile, inputHash: digest, promptHash: digest, reservationId: z.string(), batchId: z.string(), customId: z.string(), taggedAt: z.string().datetime() }).strict();
const request = z.object({ customId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), cards: z.array(card).min(1).max(40), archetype: z.string().min(1).optional(), profileInputHash: digest.optional(), memberCount: z.number().int().min(3).optional(), systemPrompt: z.string().optional(), promptHash: digest.optional(), hashes: z.record(z.string(), digest.nullable()) }).strict();
const reservation = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), month, createdAt: z.string().datetime(), model: z.enum([MODEL, LEGACY_MODEL]).optional(), state: z.enum(["reserved", "submission_started", "submitted", "settled"]), reservedMicros: z.number().int().nonnegative().max(MONTHLY_CAP_MICROS), systemPrompt: z.string(), promptHash: digest, requests: z.array(request).min(1).max(66), batchId: z.string().regex(/^msgbatch_[a-zA-Z0-9_]+$/).optional(), actualMicros: z.number().int().nonnegative().optional(), accepted: z.array(accepted).optional(), acceptedProfiles: z.array(acceptedProfile).optional(), failures: z.array(z.number().int().positive()).optional(), profileFailures: z.array(z.string()).optional() }).strict();
// Messages requests reserve the worst 1M-context standard tier plus 1024 output.
// Verified against the official Haiku 5.5 pricing on 2026-10-19.
export const READING_OUTPUT_TOKENS = 1024;
export const READING_RESERVATION_MICROS = 502_560;
export const readingBilledMicros = (input: number, output: number) => Math.ceil((input + 5 * output) / (input > 100_000 ? 2 : 10));
const runtimeReservation = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), month, createdAt: z.string().datetime(), model: z.literal(MODEL),
  phraseHash: digest, state: z.enum(["reserved", "submission_started", "settled"]),
  reservedMicros: z.literal(READING_RESERVATION_MICROS), actualMicros: z.number().int().nonnegative().optional(),
  messageId: z.string().regex(/^msg_[a-zA-Z0-9_]+$/).optional(),
}).strict();
export const LedgerSchema = z.object({ version: z.literal(1), months: z.record(month, z.number().int().nonnegative().max(MONTHLY_CAP_MICROS)), reservations: z.array(reservation), runtime: z.array(runtimeReservation).optional() }).strict();
export type Ledger = z.infer<typeof LedgerSchema>;
export type Reservation = Ledger["reservations"][number];
export type AcceptedProfile = z.infer<typeof acceptedProfile>;
export type AcceptedTag = z.infer<typeof accepted>;
export interface LedgerSnapshot { revision: string; ledger: Ledger }
export interface LedgerStore { read(): Promise<LedgerSnapshot | undefined>; compareAndSwap(revision: string | undefined, next: Ledger): Promise<string> }
export function createEmptyLedger(): Ledger { return { version: 1, months: {}, reservations: [] }; }
export function validateLedger(value: unknown): Ledger {
  const ledger = LedgerSchema.parse(value), ids = new Set<string>();
  const totals: Record<string, number> = {};
  for (const entry of ledger.reservations) {
    if (ids.has(entry.id) || entry.reservedMicros !== entry.requests.length * reservationCost(entry.model ?? LEGACY_MODEL) || hash(entry.systemPrompt) !== entry.promptHash) throw new Error("Invalid budget ledger reservation");
    ids.add(entry.id);
    if ((entry.state === "submitted" || entry.state === "settled") && !entry.batchId) throw new Error("Missing durable batch identity");
    if (entry.state === "settled" && (entry.actualMicros === undefined || entry.actualMicros > entry.reservedMicros)) throw new Error("Invalid settled budget usage");
    if (entry.state === "settled") totals[entry.month] = (totals[entry.month] ?? 0) + entry.actualMicros!;
    const customIds = new Set<string>();
    for (const req of entry.requests) {
      if ((!req.archetype && (req.cards.length > MAX_CARDS_PER_REQUEST || req.systemPrompt || req.promptHash || req.profileInputHash || req.memberCount)) || (req.archetype && ((!req.systemPrompt && !req.promptHash) || !req.profileInputHash || !req.memberCount || req.memberCount < req.cards.length))) throw new Error("Invalid ledger request kind");
      if (req.systemPrompt && req.promptHash && hash(req.systemPrompt) !== req.promptHash) throw new Error("Invalid ledger profile prompt hash");
      if (customIds.has(req.customId) || Object.keys(req.hashes).length !== req.cards.length || new Set(req.cards.map(card => card.id)).size !== req.cards.length || req.cards.some(card => req.hashes[card.id] !== hashCardEffectSourceText(card))) throw new Error("Invalid ledger request identity");
      customIds.add(req.customId);
    }
  }
  for (const entry of ledger.runtime ?? []) {
    if (ids.has(entry.id)) throw new Error("Duplicate runtime reservation");
    ids.add(entry.id);
    if (entry.state === "settled") {
      if (!entry.messageId || entry.actualMicros === undefined || entry.actualMicros > entry.reservedMicros) throw new Error("Invalid runtime settlement");
      totals[entry.month] = (totals[entry.month] ?? 0) + entry.actualMicros;
    } else if (entry.actualMicros !== undefined || entry.messageId !== undefined) throw new Error("Invalid pending runtime liability");
  }
  if (JSON.stringify(Object.keys(totals).sort()) !== JSON.stringify(Object.keys(ledger.months).sort()) || Object.entries(totals).some(([month, total]) => ledger.months[month] !== total)) {
    throw new Error("Budget ledger monthly totals must equal its complete settled reservation history");
  }
  return ledger;
}
export function budgetUsed(ledger: Ledger, currentMonth: string): number {
  // Uncertain liabilities survive every rollover; a new month cannot erase a
  // submitted request whose cost/results were never durably reconciled.
  return (ledger.months[currentMonth] ?? 0) + ledger.reservations.filter(row => row.state !== "settled").reduce((sum, row) => sum + row.reservedMicros, 0) + (ledger.runtime ?? []).filter(row => row.state !== "settled").reduce((sum, row) => sum + row.reservedMicros, 0);
}

/** A real durable store for offline integration tests; the live CLI uses GitHub. */
export class FileLedgerStore implements LedgerStore {
  constructor(private path: string) {}
  async read(): Promise<LedgerSnapshot | undefined> {
    if (!existsSync(this.path)) return undefined;
    const bytes = readFileSync(this.path, "utf8");
    return { revision: hash(bytes), ledger: validateLedger(JSON.parse(bytes)) };
  }
  async compareAndSwap(revision: string | undefined, next: Ledger): Promise<string> {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`; mkdirSync(lock);
    try {
      if ((await this.read())?.revision !== revision) throw new Error("Ledger CAS conflict");
      const bytes = JSON.stringify(validateLedger(next)) + "\n";
      writeFileSync(`${this.path}.next`, bytes, { mode: 0o600 }); renameSync(`${this.path}.next`, this.path);
      return hash(bytes);
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
}

/** Git Data API writes are JSON stdin, and ref updates must be fast forwards.
 * The API key never enters this store. No checked-out code or shell is executed.
 */
export class GithubLedgerStore implements LedgerStore {
  constructor(private repository: string, private branch = "state/effect-tagging") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch)) throw new Error("Invalid ledger repository or branch");
  }
  private api(path: string, method?: string, body?: unknown): any {
    const args = ["api", `repos/${this.repository}/${path}`];
    if (method) args.push("--method", method, "--input", "-");
    return JSON.parse(execFileSync("gh", args, { encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), stdio: ["pipe", "pipe", "pipe"] }));
  }
  async read(): Promise<LedgerSnapshot | undefined> {
    let ref;
    try { ref = this.api(`git/ref/heads/${this.branch}`); }
    catch (error) {
      if (String((error as { stderr?: unknown }).stderr).includes("HTTP 404")) return undefined;
      throw new Error("Cannot read durable budget ledger", { cause: error });
    }
    const commit = this.api(`git/commits/${ref.object.sha}`);
    const tree = this.api(`git/trees/${commit.tree.sha}`);
    const blob = tree.tree.find((row: any) => row.path === "ledger.json" && row.type === "blob");
    if (!blob) throw new Error("Missing ledger.json on durable state branch");
    const content = this.api(`git/blobs/${blob.sha}`);
    if (content.encoding !== "base64" || content.size > 16_000_000) throw new Error("Invalid durable budget ledger blob");
    return { revision: ref.object.sha, ledger: validateLedger(JSON.parse(Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8"))) };
  }
  async compareAndSwap(revision: string | undefined, next: Ledger): Promise<string> {
    const current = await this.read();
    if (current?.revision !== revision) throw new Error("Ledger CAS conflict");
    const bytes = JSON.stringify(validateLedger(next)) + "\n";
    const blob = this.api("git/blobs", "POST", { content: Buffer.from(bytes).toString("base64"), encoding: "base64" });
    const prior = revision ? this.api(`git/commits/${revision}`) : undefined;
    const tree = this.api("git/trees", "POST", { ...(prior ? { base_tree: prior.tree.sha } : {}), tree: [{ path: "ledger.json", mode: "100644", type: "blob", sha: blob.sha }] });
    const commit = this.api("git/commits", "POST", { message: "chore(cards): persist effect tagging budget state\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01GLTNwBcU5bVhsdGwaZoeik", tree: tree.sha, parents: revision ? [revision] : [] });
    try {
      if (revision) this.api(`git/refs/heads/${this.branch}`, "PATCH", { sha: commit.sha, force: false });
      else this.api("git/refs", "POST", { ref: `refs/heads/${this.branch}`, sha: commit.sha });
    } catch (error) {
      // A lost PATCH response may still have committed. Re-read before deciding
      // whether the reservation is durable enough to permit a paid request.
      if ((await this.read())?.revision !== commit.sha) throw new Error("Ledger CAS write failed", { cause: error });
    }
    return commit.sha;
  }
}
