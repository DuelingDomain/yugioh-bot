import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DuelOutcome } from "./driver.js";
import { knownIssueFor } from "./known-issues.js";

export const FAILURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "failures");
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function reproCommand(outcome: Pick<DuelOutcome, "scenario" | "failure">, dataDirectory: string): string {
  const { scenario, failure } = outcome;
  const maxSteps = failure ? Math.max(1, failure.step + 1) : scenario.maxSteps;
  const data = relative(resolve(PACKAGE_DIR, "../.."), dataDirectory) || dataDirectory;
  return (
    `cd packages/duel-server && DUEL_DATA_DIR=$PWD/../../${data} npx tsx scripts/fuzz-repro.ts ` +
    `--seed ${scenario.seed} --mode ${scenario.mode} --master-rule ${scenario.masterRule} --max-steps ${maxSteps}`
  );
}

export function describeFailure(outcome: DuelOutcome, dataDirectory: string): string {
  const f = outcome.failure;
  if (!f) return "no failure";
  const known = knownIssueFor(f);
  const lines = [
    `FUZZ FAILURE [${f.invariant}]${known ? ` (known issue: ${known.id})` : ""}`,
    `  seed ${outcome.scenario.seed}, mode ${outcome.scenario.mode}, master rule ${outcome.scenario.masterRule}, step ${f.step}`,
    `  ${f.message}`,
  ];
  if (f.prompt) {
    lines.push(
      `  prompt ${f.prompt.id} seat ${f.seat ?? "?"} [${f.prompt.kind}] "${f.prompt.title}" options: ${f.prompt.options
        .slice(0, 8)
        .map((o) => o.label)
        .join(" | ")}${f.prompt.options.length > 8 ? " ..." : ""}`,
    );
  }
  lines.push(`  repro: ${reproCommand(outcome, dataDirectory)}`);
  return lines.join("\n");
}

/** Write one failing case as JSON. The directory is meant to be git-ignored. */
export function writeFailure(outcome: DuelOutcome, dataDirectory: string, directory = FAILURE_DIR): string {
  mkdirSync(directory, { recursive: true });
  const f = outcome.failure;
  const name = `${f?.invariant ?? "unknown"}-seed${outcome.scenario.seed}-${outcome.scenario.mode}.json`;
  const path = join(directory, name);
  writeFileSync(
    path,
    JSON.stringify(
      {
        scenario: outcome.scenario,
        failure: f,
        knownIssue: f ? (knownIssueFor(f)?.id ?? null) : null,
        repro: reproCommand(outcome, dataDirectory),
        decks: outcome.decks,
        deckNotes: outcome.deckNotes,
        disjointDecks: outcome.disjoint,
        steps: outcome.steps,
        journal: outcome.journal,
      },
      null,
      1,
    ),
  );
  return path;
}
