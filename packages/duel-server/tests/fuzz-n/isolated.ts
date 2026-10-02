import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { readCore } from "./core.js";
import { playDuel, setupScenario, type JournalItem, type NFailure, type NOutcome, type NScenario } from "./driver.js";
import { firstTurnDrawFor } from "../../src/first-turn-draw.js";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/fuzz-n.ts");
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RESULT_MARK = "@@FUZZ-N-RESULT@@";

/** What the parent gives the child through a JSON file. */
export interface ChildSpec {
  scenario: NScenario;
  dataDirectory: string;
  corePath: string;
  firstTurnDraw?: boolean;
  /** The child appends one JSON line per pending call and per accepted action, so a hang leaves a trace. */
  journalFile: string;
  script?: { journal: JournalItem[]; pending?: JournalItem | undefined };
}

interface TraceLine {
  t: "pending" | "journal";
  item: JournalItem;
  prompt?: DuelPrompt | null;
  step?: number;
}

/** Entry of the child process: play (or replay) one duel and print the outcome. */
export async function childMain(specFile: string): Promise<void> {
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as ChildSpec;
  const core = readCore(spec.corePath);
  // Lua seeds from time(NULL) in cores without a fixed seed; freeze the clock like the differential tests do.
  Date.now = () => Date.UTC(2026, 0, 1);
  const outcome = await playDuel(spec.scenario, {
    dataDirectory: spec.dataDirectory,
    firstTurnDraw: spec.firstTurnDraw,
    multiWasmBinary: core.bytes,
    ...(spec.script ? { script: spec.script } : {}),
    hooks: {
      onPending: (item, prompt, step) => appendFileSync(spec.journalFile, `${JSON.stringify({ t: "pending", item, prompt, step } satisfies TraceLine)}\n`),
      onJournal: (item) => appendFileSync(spec.journalFile, `${JSON.stringify({ t: "journal", item } satisfies TraceLine)}\n`),
    },
  });
  process.stdout.write(`\n${RESULT_MARK}${JSON.stringify(outcome)}\n`);
}

function readTrace(file: string): TraceLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TraceLine];
      } catch {
        return [];
      }
    });
}

export interface IsolatedOptions {
  dataDirectory: string;
  corePath: string;
  timeoutMs: number;
  firstTurnDraw?: boolean;
  script?: ChildSpec["script"];
}

/**
 * Run one duel in a child process with a wall-clock limit. The core is synchronous wasm: when it loops forever
 * nothing in the same process can stop it, so the parent kills the child and classifies a `hang`.
 */
export async function runIsolated(scenario: NScenario, options: IsolatedOptions): Promise<NOutcome> {
  options = { ...options, firstTurnDraw: options.firstTurnDraw ?? firstTurnDrawFor(scenario.mode, scenario.masterRule) };
  const dir = mkdtempSync(join(tmpdir(), "fuzz-n-"));
  const specFile = join(dir, "spec.json");
  const journalFile = join(dir, "trace.jsonl");
  const spec: ChildSpec = { scenario, dataDirectory: options.dataDirectory, corePath: options.corePath, firstTurnDraw: options.firstTurnDraw, journalFile, ...(options.script ? { script: options.script } : {}) };
  writeFileSync(specFile, JSON.stringify(spec));
  try {
    const run = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((done) => {
      const child = spawn(process.execPath, ["--import", "tsx", SCRIPT, "--child", specFile], { cwd: PACKAGE_DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ stdout, stderr, code, timedOut });
      });
    });
    const at = run.stdout.lastIndexOf(RESULT_MARK);
    if (at >= 0 && !run.timedOut) return JSON.parse(run.stdout.slice(at + RESULT_MARK.length)) as NOutcome;
    return synthesize(scenario, options, run, readTrace(journalFile));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The child hung (wall-clock limit) or died: build an outcome from the trace it left. */
function synthesize(
  scenario: NScenario,
  options: IsolatedOptions,
  run: { stderr: string; code: number | null; timedOut: boolean },
  trace: TraceLine[],
): NOutcome {
  const journal = trace.filter((line) => line.t === "journal").map((line) => line.item);
  const lastPending = [...trace].reverse().find((line) => line.t === "pending");
  const setup = setupScenario(scenario, options.dataDirectory);
  const pendingItem = lastPending?.item;
  const prompt = lastPending?.prompt ?? undefined;
  const seat = pendingItem?.seat;
  const title = prompt?.title ?? "(no prompt recorded)";
  const failure: NFailure = run.timedOut
    ? {
        invariant: "hang",
        message: `wall-clock: the core did not return within ${options.timeoutMs} ms ${pendingItem ? `while handling ${pendingItem.kind === "answer" ? "an answer" : "an elimination"} of seat ${seat} ("${title}")` : "before the first prompt (create or opening)"}`,
        step: journal.length,
        ...(seat !== undefined ? { seat } : {}),
        ...(prompt ? { prompt } : {}),
        pending: pendingItem,
        detail: { kind: "wall-clock", timeoutMs: options.timeoutMs, waitingSeat: seat ?? null, lastPrompt: title },
      }
    : {
        invariant: "engine-throw",
        message: `child process died (exit ${run.code}): ${run.stderr.trim().split("\n").slice(-3).join(" | ")}`,
        step: journal.length,
        ...(seat !== undefined ? { seat } : {}),
        ...(prompt ? { prompt } : {}),
        pending: pendingItem,
        detail: { kind: "child-died", exit: run.code },
      };
  return {
    scenario,
    firstTurnDraw: options.firstTurnDraw!,
    decks: setup.decks,
    deckNotes: setup.deckNotes,
    disjoint: setup.disjoint,
    steps: journal.length,
    status: "failed",
    result: null,
    journal,
    finalHash: "",
    failure,
    softRejections: 0,
    promptKinds: {},
    stats: {},
    turns: 0,
    eliminations: journal.filter((item) => item.kind === "eliminate").length,
    diagnostics: [],
  };
}
