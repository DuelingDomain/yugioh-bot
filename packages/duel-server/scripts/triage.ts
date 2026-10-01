/**
 * One command from a failure file to a replay and a Layer 1 scenario draft.
 *
 *   npx tsx scripts/triage.ts <file-or-dir> [--step N] [--wasm path] [--detect] [--no-scenario] [--no-issue]
 *                             [--page-revision N --page-prompt visible|hidden]   (stall class: page state) [--no-issue] [--page-revision N --page-prompt visible|hidden]
 *
 * Input types (detected from the content, not only the name):
 *   fuzz          tests/fuzz/failures/*.json (scenario + journal + decks)
 *   differential  tests/differential/failures/*.json (the same plus `engine` and `differential`)
 *   journal       duel-journal-<slug>.json of an E2E run (format "yugidraft-duel-journal/1")
 *   stall         stall-<n>.json of the E2E stall detector (unknown shape is fine; a journal next to it is replayed)
 *   nduel         one nduel summary line: JSON with n, mode, seed
 *   manual        a folder .status/manual/<slug>-<time>/ with journal.jsonl and note.md (each may be missing)
 * A directory that is not a manual folder is searched for *.json (one level deep) and each file is triaged.
 *
 *   fuzz-n        tests/fuzz-n/failures/*.json (3 and 4 seats: answers, check, wasm)
 *
 * For a replayable type with two seats it replays on the core named in the file (else the engine data directory, default
 * data/duel-engine-next), writes a scenario draft with scripts/failure-to-scenario.ts and prints the run command.
 * For 3 and 4 seats it replays on the wasm whose sha matches the `wasmSha` of the journal (else the data directory multi
 * core, with a warning), captures every seat at the last open state and writes a preset draft
 * `src/presets/generated/<sig>.ts` (preset contract format) and the index `src/presets/generated/index.ts`.
 * For a type it cannot replay (nduel, no journal) it prints what to run by hand and exits 2.
 * Every run ends with a signature, an owner (scripts/owners.tsv, known issues) and an issue file
 * `.status/issues/<sig>.json` (--no-issue skips it).
 * A stall file or a host `debug-trace` JSON gets a stall class (core, bot, ui, transport): scripts/lib/stall-classes.ts.
 * Exit codes: 0 done, 1 error, 2 run it by hand. --detect only prints the detected type.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { engineDataDirectory } from "../tests/fuzz/config.js";
import { generate, generateDraft, loadNSource, slugify, type NSource } from "./failure-to-scenario.js";
import { ownerOfFailure, recordIssue, signatureOf, siteOfInfo, type FailureInfo } from "./lib/issue-registry.js";
import { loadOwners, type OwnerRow } from "./lib/owners.js";
import { classifyStall, isDebugTrace, type DebugTrace, type PageState } from "./lib/stall-classes.js";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type InputType = "fuzz" | "fuzz-n" | "differential" | "journal" | "stall" | "nduel" | "manual" | "directory" | "unknown";

export interface Detected {
  type: InputType;
  /** The parsed JSON (for a file) or the journal found in a manual folder. */
  data?: Record<string, any>;
  reason: string;
}

const JOURNAL_FORMAT = "yugidraft-duel-journal/1";

function readJson(file: string): Record<string, any> | null {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The first line of a text that is a JSON object with n, mode and seed (an nduel summary line). */
export function parseNduelLine(text: string): Record<string, any> | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value = JSON.parse(trimmed);
      if (isNduel(value)) return value;
    } catch {
      // not json
    }
  }
  return null;
}

function isNduel(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.n === "number" && "mode" in v && "seed" in v && !("scenario" in v) && !("journal" in v);
}

/** Decide the type of one parsed JSON object. `name` is the file name, used only to break a tie for stall files. */
export function detectJson(json: Record<string, any>, name = ""): Detected {
  if (json.format === JOURNAL_FORMAT) return { type: "journal", data: json, reason: `format ${JOURNAL_FORMAT}` };
  if (Array.isArray(json.answers) && json.check && json.wasm && Array.isArray(json.decks)) {
    return { type: "fuzz-n", data: json, reason: "answers, check, wasm and decks (fuzz-n failure)" };
  }
  if (isDebugTrace(json)) return { type: "stall", data: json, reason: "host debug-trace (revision, seats, worker)" };
  if (json.scenario && Array.isArray(json.journal) && Array.isArray(json.decks)) {
    return json.differential
      ? { type: "differential", data: json, reason: "scenario, journal, decks and a differential block" }
      : { type: "fuzz", data: json, reason: "scenario, journal and decks" };
  }
  if (/^stall-.*\.json$/.test(name) || (typeof json.slug === "string" && typeof json.message === "string" && /stall/i.test(json.message))) {
    return { type: "stall", data: json, reason: "stall report" };
  }
  if (isNduel(json)) return { type: "nduel", data: json, reason: "n, mode and seed" };
  return { type: "unknown", data: json, reason: "no known fields" };
}

/** Detect the type of a file or a folder. */
export function detectInput(path: string): Detected {
  if (!existsSync(path)) return { type: "unknown", reason: `${path} does not exist` };
  if (statSync(path).isDirectory()) {
    const hasJournal = existsSync(join(path, "journal.jsonl"));
    const hasNote = existsSync(join(path, "note.md"));
    if (hasJournal || hasNote || /[\\/]manual[\\/]/.test(resolve(path) + "/")) {
      return { type: "manual", reason: `manual report folder${hasJournal ? "" : " (no journal.jsonl)"}${hasNote ? "" : " (no note.md)"}` };
    }
    return { type: "directory", reason: "folder of files" };
  }
  const name = basename(path);
  const text = readFileSync(path, "utf8");
  const json = readJson(path);
  if (json) return detectJson(json, name);
  const line = parseNduelLine(text);
  if (line) return { type: "nduel", data: line, reason: "nduel summary line" };
  return { type: "unknown", reason: "not JSON" };
}

/** Read `journal.jsonl` of a manual folder. The file may hold one journal object per line, or a header line then one command per line. */
export function readManualJournal(folder: string): Record<string, any> | null {
  const file = join(folder, "journal.jsonl");
  if (!existsSync(file)) return null;
  let header: Record<string, any> | null = null;
  const commands: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value?.format === JOURNAL_FORMAT) {
      header = { ...value, commands: [...(value.commands ?? [])] };
    } else if (value && typeof value.seat === "number" && value.command) {
      commands.push(value);
    } else if (value?.type === "eliminate" && typeof value.seat === "number") {
      // A host elimination (surrender, time loss) sits in the journal like an answer: promptId `eliminate:<win reason code>`.
      const code = Number(value.code ?? value.reason ?? 0);
      commands.push({ seat: value.seat, ...(typeof value.seq === "number" ? { seq: value.seq } : {}), command: { promptId: `eliminate:${code}`, revision: Number(value.revision ?? 0), answer: {} } });
    }
  }
  if (!header) return null;
  // Lines carry `seq` (answer and elimination share one counter): keep the order of the game, not of the file.
  if (commands.every((c: any) => typeof c.seq === "number")) commands.sort((a: any, b: any) => a.seq - b.seq);
  header.commands = [...header.commands, ...commands];
  return header;
}

export interface TriageResult {
  /** 0 done, 1 error, 2 run it by hand. */
  code: 0 | 1 | 2;
  lines: string[];
  /** Signature of the failure class (12 hex). */
  sig?: string;
  /** Owner task tag or "UNOWNED". */
  owner?: string;
  /** The command that repeats the run. */
  repro?: string;
  /** The issue file written. */
  issueFile?: string;
  /** Stall class, for a stall or a debug-trace. */
  stallClass?: string;
  /** The preset draft written (3 and 4 seats). */
  presetDraft?: string;
}

export interface TriageOptions {
  step?: number;
  wasmPath?: string;
  dataDirectory?: string;
  /** Do not write a scenario. */
  noScenario?: boolean;
  /** Where to write the scenario. Default tests/scenarios/generated. */
  outDirectory?: string;
  /** Where to write preset drafts (3 and 4 seats) and their index. Default src/presets/generated. */
  presetDirectory?: string;
  /** Where to write issue files. Default <repo>/.status/issues. */
  issuesDirectory?: string;
  /** Do not write an issue file. */
  noIssue?: boolean;
  /** Owner rows. Default scripts/owners.tsv. */
  owners?: OwnerRow[];
  /** The page state of a stalled duel (revision, prompt shown), for the stall class. */
  page?: PageState;
  /** Set by triage: the signature of this run. */
  sig?: string;
}

const REPO_DIR = resolve(PACKAGE_DIR, "../..");
export const DEFAULT_ISSUES_DIR = join(REPO_DIR, ".status", "issues");
export const DEFAULT_PRESET_DIR = join(PACKAGE_DIR, "src", "presets", "generated");

/** Rewrite `index.ts` of a preset draft folder: it imports every draft file and exports `GENERATED_PRESETS`. */
export function writeGeneratedIndex(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((name) => name.slice(0, -3))
    .sort();
  const ident = (name: string) => `g_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const lines = [
    "// Written by scripts/triage.ts. Do not edit by hand: triage rewrites this file when it adds a draft.",
    'import type { Preset } from "../types.js";',
    ...names.map((name) => `import { preset as ${ident(name)} } from "./${name}.js";`),
    "",
    `export const GENERATED_PRESETS: readonly Preset[] = [${names.map(ident).join(", ")}];`,
    "",
  ];
  const file = join(dir, "index.ts");
  writeFileSync(file, lines.join("\n"));
  return file;
}

/** The wasm a file names: only when the file exists here (relative to the cwd or the package). */
function findWasm(path: string | undefined): string | undefined {
  if (!path) return undefined;
  for (const candidate of [resolve(path), resolve(PACKAGE_DIR, path)]) if (existsSync(candidate)) return candidate;
  return undefined;
}

async function triageFile(file: string, options: TriageOptions, label: string, tempName?: string): Promise<TriageResult> {
  const lines: string[] = [];
  const dataDirectory = options.dataDirectory ?? engineDataDirectory();
  let source: NSource;
  try {
    source = loadNSource(file);
  } catch (error) {
    return { code: 1, lines: [`${label}: cannot read the duel: ${error instanceof Error ? error.message : String(error)}`] };
  }
  lines.push(`${label}: ${source.label}, ${source.commands.length} answers, ${source.seatCount} seats (${source.format})`);
  if (source.seatCount > 2 || source.label.startsWith("fuzz-n")) return triageDraft(file, source, options, lines, dataDirectory);
  const wasmPath = options.wasmPath ? resolve(options.wasmPath) : findWasm(source.wasmPath);
  if (source.wasmPath && !wasmPath) lines.push(`  The file names the core ${source.wasmPath}. It is missing here, so the data directory core is used.`);
  lines.push(`  Core: ${wasmPath ?? `${dataDirectory} (data directory)`}`);
  const isFuzzOrDiff = source.kind === "fuzz";
  const total = source.commands.length;
  let step = options.step ?? (source.kind === "fuzz" && source.wasmPath === undefined ? source.failureStep : undefined);
  if (step === undefined || step < 0 || step > total) step = total;
  lines.push(`  Step: ${step} of ${total}${options.step === undefined ? " (default: the failure step, else the end of the journal)" : ""}`);
  if (isFuzzOrDiff) {
    lines.push(`  Replay: cd packages/duel-server && DUEL_DATA_DIR=${dataDirectory} npx tsx scripts/fuzz-repro.ts --file ${file}${wasmPath ? ` --wasm ${wasmPath}` : ""}`);
  } else {
    lines.push(`  Replay: cd packages/duel-server && DUEL_DATA_DIR=${dataDirectory} npx tsx scripts/replay-journal.ts ${file} --views`);
  }
  if (options.noScenario) return { code: 0, lines };
  try {
    const result = await generate({
      file,
      step,
      name: tempName ? `triage-${slugify(tempName)}-step-${step}` : `triage-${slugify(basename(file))}-step-${step}`,
      dataDirectory,
      ...(wasmPath ? { wasmPath } : {}),
    });
    const dir = options.outDirectory ?? resolve(PACKAGE_DIR, "tests/scenarios/generated");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${result.name}.ts`);
    writeFileSync(out, result.text);
    lines.push(`  Scenario draft: ${out} (${result.capture.warnings.length} warning(s); write the expected result by hand)`);
    lines.push(`  Run: cd packages/duel-server && SCENARIO_ID=${result.name} DUEL_DATA_DIR=${dataDirectory} npx vitest run tests/scenarios/generated`);
    return { code: 0, lines };
  } catch (error) {
    lines.push(`  Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    lines.push(`  This is often the bug itself (revision or prompt mismatch, or an engine error). Replay by hand with the Replay command above.`);
    return { code: 1, lines };
  }
}

/** 3 and 4 seats (and fuzz-n files): replay on the matching core, capture every seat, write a preset draft. */
async function triageDraft(file: string, source: NSource, options: TriageOptions, lines: string[], dataDirectory: string): Promise<TriageResult> {
  const total = source.commands.length;
  let step = options.step ?? source.failureStep;
  if (step === undefined || step < 0 || step > total) step = total;
  lines.push(`  Step: ${step} of ${total}${options.step === undefined ? " (default: the failure step, else the end of the journal)" : ""}`);
  const repro = `cd packages/duel-server && DUEL_DATA_DIR=${dataDirectory} npx tsx scripts/replay-journal.ts ${file} --views${options.wasmPath ? ` --wasm ${options.wasmPath}` : ""}`;
  lines.push(`  Replay: ${repro}`);
  if (options.noScenario) return { code: 0, lines, repro };
  try {
    const sig = options.sig ?? slugify(basename(file));
    const result = await generateDraft({
      file,
      step,
      name: `generated-${sig}`,
      dataDirectory,
      ...(options.wasmPath ? { wasmPath: options.wasmPath } : {}),
    });
    for (const warning of result.core.warnings) lines.push(`  Warning: ${warning}`);
    lines.push(`  Core: ${result.core.path ?? `${dataDirectory} (data directory default)`}`);
    const dir = options.presetDirectory ?? DEFAULT_PRESET_DIR;
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${sig}.ts`);
    writeFileSync(out, result.text);
    writeGeneratedIndex(dir);
    lines.push(`  Preset draft: ${out} (${result.capture.warnings.length} capture warning(s); write the bot rules and the checklist by hand)`);
    lines.push(`  Register: src/presets/index.ts must import GENERATED_PRESETS from "./generated/index.js" and spread it into PRESETS.`);
    return { code: 0, lines, repro, presetDraft: out };
  } catch (error) {
    lines.push(`  Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    lines.push(`  This is often the bug itself (revision or prompt mismatch, a hang, or an engine error). Replay by hand with the Replay command above.`);
    return { code: 1, lines, repro };
  }
}

function findJournalNear(stallFile: string, slug: string | undefined): string | undefined {
  const dirs = [dirname(stallFile), dirname(dirname(stallFile))];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const hit = names.find((name) => /^duel-journal-.*\.json$/.test(name) && (!slug || name.includes(slug)));
    if (hit) return join(dir, hit);
  }
  return undefined;
}

async function triageInner(path: string, options: TriageOptions, detected: Detected): Promise<TriageResult> {
  const lines: string[] = [`${path}: ${detected.type} (${detected.reason})`];
  switch (detected.type) {
    case "fuzz":
    case "fuzz-n":
    case "differential":
    case "journal": {
      const result = await triageFile(path, options, detected.type);
      return { ...result, lines: [...lines, ...result.lines] };
    }
    case "stall": {
      const data = detected.data ?? {};
      lines.push(`  Keys: ${Object.keys(data).join(", ") || "(none)"}`);
      if (typeof data.message === "string") lines.push(`  ${data.message}`);
      // The class of the stall, from a debug-trace (the file itself, or the `trace` key of a stall file) and the page state.
      const trace: DebugTrace | null = isDebugTrace(data) ? data : isDebugTrace(data.trace) ? data.trace : null;
      const page: PageState | undefined = options.page ?? (data.page && typeof data.page.revision === "number" ? { revision: data.page.revision, promptVisible: !!data.page.promptVisible } : undefined);
      let stallClass: string | undefined;
      if (trace) {
        const verdict = classifyStall(trace, page);
        stallClass = verdict.class;
        lines.push(`  Stall class: ${verdict.class}. ${verdict.reason}`);
        if (trace.wasmSha) lines.push(`  Core sha: ${trace.wasmSha}`);
      } else lines.push(`  No debug-trace in the file: the stall class is unknown. Get it with the host op debug-trace (DUEL_SCENARIOS=1).`);
      const journal = isDebugTrace(data) ? undefined : findJournalNear(path, typeof data.slug === "string" ? data.slug : undefined);
      if (!journal) {
        lines.push(
          isDebugTrace(data)
            ? `  A debug-trace holds no journal. By hand: get the journal of the duel from the host, then run triage.ts on it.`
            : `  No duel-journal-<slug>.json next to the stall file.`,
        );
        if (!isDebugTrace(data)) lines.push(`  By hand: read the stall file and timeline.md, get the journal of the duel from the host (E2E evidence or the duels tables), then run triage.ts on it.`);
        return { code: 2, lines, ...(stallClass ? { stallClass } : {}) };
      }
      lines.push(`  Journal found: ${journal}. The duel stalled after the last answer, so the board at the end is captured.`);
      const result = await triageFile(journal, options, "journal", basename(path));
      return { ...result, lines: [...lines, ...result.lines], ...(stallClass ? { stallClass } : {}) };
    }
    case "nduel": {
      const d = detected.data ?? {};
      lines.push(
        `  nduel run: n ${d.n}, mode ${d.mode}, seed ${d.seed}. An nduel run has no replayable journal yet.`,
        `  By hand: NDUEL_SEEDS=1 NDUEL_CASES="n${d.n}" bash packages/duel-server/scripts/run-nduel.sh`,
        `  Then read packages/duel-server/.status/nduel-summary.json and the run log of that seed.`,
      );
      return { code: 2, lines, repro: `NDUEL_SEEDS=1 NDUEL_CASES="n${d.n}" bash packages/duel-server/scripts/run-nduel.sh` };
    }
    case "manual": {
      const note = join(path, "note.md");
      if (existsSync(note)) {
        lines.push(`  note.md: ${readFileSync(note, "utf8").split(/\r?\n/).filter(Boolean).slice(0, 6).join(" | ")}`);
      } else lines.push(`  note.md is missing.`);
      const journal = readManualJournal(path);
      if (!journal) {
        lines.push(`  journal.jsonl is missing or has no journal header (format ${JOURNAL_FORMAT}).`, `  By hand: read ${join(path, "journal.jsonl")} and ${note}.`);
        return { code: 2, lines };
      }
      const tmp = join(mkdtempSync(join(tmpdir(), "triage-")), "journal.json");
      writeFileSync(tmp, JSON.stringify(journal));
      const result = await triageFile(tmp, options, "journal", basename(resolve(path)));
      return { ...result, lines: [...lines, ...result.lines] };
    }
    case "directory": {
      const files = readdirSync(path)
        .filter((name) => name.endsWith(".json"))
        .sort();
      if (files.length === 0) {
        lines.push(`  No .json files in the folder.`);
        return { code: 2, lines };
      }
      let code: 0 | 1 | 2 = 0;
      for (const name of files) {
        const one = await triage(join(path, name), options);
        lines.push(...one.lines.map((line) => `  ${line}`));
        code = Math.max(code, one.code) as 0 | 1 | 2;
      }
      return { code, lines };
    }
    default:
      lines.push(`  Unknown input. Supported: fuzz or differential failure json, duel journal, stall json, nduel summary line, manual report folder.`);
      return { code: 1, lines };
  }
}

/** What is known about the failure in a detected input, in the shape the registry needs. */
export function failureInfoOf(path: string, detected: Detected): FailureInfo {
  const data = detected.data ?? {};
  const info: FailureInfo = { source: detected.type };
  switch (detected.type) {
    case "fuzz-n": {
      const message = String(data.check?.message ?? "");
      const kind = /^([a-z-]+):/.exec(message)?.[1];
      Object.assign(info, {
        invariant: String(data.check?.name ?? ""),
        message,
        format: String(data.format ?? ""),
        coreTag: String(data.wasm?.tag ?? ""),
        ...(data.pending ? { pendingSeat: data.pending.seat, pendingKind: data.pending.kind } : {}),
        ...(kind ? { detail: { kind } } : {}),
      });
      break;
    }
    case "fuzz":
    case "differential":
      Object.assign(info, {
        invariant: String(data.failure?.invariant ?? data.differential?.found ?? detected.type),
        message: String(data.failure?.message ?? data.failure?.detail ?? ""),
        coreTag: String(data.differential?.multiWasm ?? ""),
        text: `${data.differential?.mode ?? ""} ${data.differential?.scenarioId ?? ""}`,
      });
      break;
    case "nduel":
      Object.assign(info, { invariant: "nduel", message: JSON.stringify(data), text: `n${data.n} ${data.mode}` });
      break;
    case "stall":
      Object.assign(info, { invariant: "stall", message: String(data.message ?? ""), text: `stall ${data.slug ?? ""}` });
      break;
    case "manual": {
      const note = join(path, "note.md");
      const text = existsSync(note) ? readFileSync(note, "utf8").split(/\r?\n/).filter(Boolean).slice(0, 3).join(" ") : "";
      Object.assign(info, { invariant: "manual", message: text, text: basename(resolve(path)) });
      break;
    }
    default:
      Object.assign(info, { invariant: detected.type, text: basename(path) });
  }
  const presetId = presetIdOf(path, detected);
  if (presetId) info.presetId = presetId;
  const site = siteFromTextOf(info);
  if (site) info.site = site;
  return info;
}

const asId = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * The preset a failing duel started from. Read from the journal header (`presetId`, or `setup.presetId`), the `presetId` of
 * a host stall file, a manual report folder (journal.jsonl, then stall.json), or the journal next to a stall file.
 * The Playwright `failure-summary.json` of P1 has a top-level `presetId`; the first line below (`data.presetId`) reads it.
 */
function presetIdOf(path: string, detected: Detected): string | undefined {
  const data = (detected.data ?? {}) as Record<string, any>;
  const direct = asId(data.presetId) ?? asId(data.setup?.presetId);
  if (direct) return direct;
  if (detected.type === "manual") {
    const fromStall = readJson(join(path, "stall.json"));
    return asId(readManualJournal(path)?.presetId) ?? asId(fromStall?.presetId);
  }
  if (detected.type === "stall") {
    const journal = findJournalNear(path, typeof data.slug === "string" ? data.slug : undefined);
    const json = journal ? readJson(journal) : null;
    return asId(json?.presetId) ?? asId(json?.setup?.presetId);
  }
  return undefined;
}

function siteFromTextOf(info: FailureInfo) {
  return siteOfInfo({ ...info, site: undefined });
}

/** Triage one input: detect, replay, write the draft, name the owner and write the issue file. */
export async function triage(path: string, options: TriageOptions = {}): Promise<TriageResult> {
  const detected = detectInput(path);
  if (detected.type === "directory" || detected.type === "unknown") return triageInner(path, options, detected);
  const info = failureInfoOf(path, detected);
  const rows = options.owners ?? loadOwners();
  const { owner, known } = ownerOfFailure(info, rows);
  const sig = known?.id ?? signatureOf(info);
  const result = await triageInner(path, { ...options, sig }, detected);
  const lines = [...result.lines];
  lines.push(`  Signature: ${sig}${known ? ` (known issue: ${known.summary})` : " (new)"}`);
  lines.push(`  Owner: ${owner}`);
  const repro = result.repro ?? `cd packages/duel-server && npx tsx scripts/triage.ts ${path}`;
  let issueFile: string | undefined;
  if (!options.noIssue) {
    const dir = options.issuesDirectory ?? DEFAULT_ISSUES_DIR;
    const title = known?.summary ?? (info.message ? info.message.slice(0, 160) : `${detected.type} ${basename(path)}`);
    recordIssue(dir, { sig, owner, title, repro, source: `${detected.type}: ${path}`, ...(info.presetId ? { presetId: info.presetId } : {}) });
    issueFile = join(dir, `${sig}.json`);
    lines.push(`  Issue: ${issueFile}`);
  }
  return { ...result, lines, sig, owner, repro, ...(issueFile ? { issueFile } : {}) };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target || target.startsWith("--")) throw new Error("Usage: triage.ts <file-or-dir> [--step N] [--wasm path] [--detect] [--no-scenario] [--no-issue] [--page-revision N --page-prompt visible|hidden]");
  if (process.argv.includes("--detect")) {
    const detected = detectInput(target);
    console.log(`${detected.type}: ${detected.reason}`);
    return;
  }
  const stepArg = arg("step");
  const result = await triage(target, {
    ...(stepArg === undefined ? {} : { step: Number(stepArg) }),
    ...(arg("wasm") ? { wasmPath: arg("wasm") } : {}),
    noScenario: process.argv.includes("--no-scenario"),
    noIssue: process.argv.includes("--no-issue"),
    ...(arg("page-revision") !== undefined ? { page: { revision: Number(arg("page-revision")), promptVisible: arg("page-prompt") === "visible" } } : {}),
  });
  console.log(result.lines.join("\n"));
  process.exit(result.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
