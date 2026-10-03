import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file is packages/duel-server/tests/differential/summary.ts). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const STATUS_DIR = join(REPO_ROOT, ".status");
export const SUMMARY_PATH = join(STATUS_DIR, "differential-summary.json");
export const HISTORY_PATH = join(STATUS_DIR, "differential-history.tsv");

export interface WasmIdentity {
  path: string;
  /** Hex sha256 of the file, or null when the file does not exist. */
  sha256: string | null;
}

/** The shape that the status board reads. Do not rename a field. */
export interface DifferentialSummary {
  /** ISO time when the run finished. */
  time: string;
  /** "long", "domain" or "scenarios" (the extended test). Another file may write "main". */
  mode: string;
  reference: WasmIdentity;
  multi: WasmIdentity;
  baseSeed: number;
  /** How many seeds (or scenarios) ran. */
  seeds: number;
  /** The DIFF_ONLY_SEEDS list, or an empty list. */
  onlySeeds: number[];
  maxSteps: number;
  /** Seeds with a difference (stock self-check and multi core together). */
  differences: number;
  /** "failed to parse a message" warnings of all cores. */
  parseWarnings: number;
  /** First seed with a difference, or null. */
  firstFailingSeed: number | null;
  durationMs: number;
}

export function wasmIdentity(path: string): WasmIdentity {
  const resolved = resolve(path);
  return { path: resolved, sha256: existsSync(resolved) ? createHash("sha256").update(readFileSync(resolved)).digest("hex") : null };
}

/** Columns of each line of differential-history.tsv (tab separated, no header line). */
export const HISTORY_COLUMNS = ["time", "mode", "differences", "parseWarnings", "seeds", "baseSeed", "maxSteps", "firstFailingSeed", "durationMs", "referenceSha256", "multiSha256"];

/** Write `.status/differential-summary.json` and append one line to `.status/differential-history.tsv`. */
export function writeDifferentialSummary(summary: DifferentialSummary, statusDir = STATUS_DIR): { summaryPath: string; historyPath: string } {
  mkdirSync(statusDir, { recursive: true });
  const summaryPath = join(statusDir, "differential-summary.json");
  const historyPath = join(statusDir, "differential-history.tsv");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const row = [
    summary.time,
    summary.mode,
    summary.differences,
    summary.parseWarnings,
    summary.seeds,
    summary.baseSeed,
    summary.maxSteps,
    summary.firstFailingSeed ?? "",
    Math.round(summary.durationMs),
    summary.reference.sha256?.slice(0, 12) ?? "",
    summary.multi.sha256?.slice(0, 12) ?? "",
  ].join("\t");
  // No header line: every line is one run. The columns are HISTORY_COLUMNS.
  appendFileSync(historyPath, `${row}\n`);
  return { summaryPath, historyPath };
}
