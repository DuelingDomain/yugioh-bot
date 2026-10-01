// Rule coverage table for ADR-0002 (multi-player duel rules).
//
// A rule counts as COVERED only by an outcome scenario: a DSL scenario (tests/scenarios/**, not a *.test.ts file) that
//   1. declares the rule in its `rules: [...]` field (the marker),
//   2. is not a `knownBug` scenario, and
//   3. has at least one outcome assertion (a step named `expect*`) AFTER at least one action step.
// A check of the start state or of the first prompt alone is not an outcome. These are listed but NOT counted:
//   - presets (src/presets): hand-play smoke runs, a human reads the checklist;
//   - catalog sketches (tests/scenarios/multiplayer/catalog.ts): every entry is pending;
//   - scenarios that declare `rules` but have no outcome assertion ("weak").
// Rules with no outcome scenario must be in the allow-list scripts/rule-coverage-pending.json (rule id -> reason).
// Each later part that adds an outcome scenario removes its entries. --strict fails on a rule that has no outcome
// scenario and no allow-list entry, on a stale allow-list entry (rule now covered, or not in the ADR), on a weak
// scenario, on an unknown rule id, on a scenario list that no test file runs, and (with --check) on a doc that differs
// from the table this script makes. Without --strict the exit code is always 0.
// One tested clause is enough to mark the whole rule id as covered: the marker cannot see which clauses of a rule a scenario checks.
// A covered rule with clauses that no scenario proves is listed in scripts/rule-coverage-partial.json (rule id -> what is not proven).
// The table shows it as "covered (partial: ...)". --strict fails on a partial entry for a rule that is not covered or not in the ADR.
// Usage: npx tsx scripts/rule-coverage.ts [--strict] [--check]   (--check: write nothing, compare the doc with the table)

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** covered = outcome scenario; pending = no outcome scenario but in the allow-list; none = neither (strict fails). */
export type Status = "covered" | "pending" | "none";
/** outcome = counts. The others are listed only: preset (smoke run), sketch (pending catalog entry), weak (rules but no outcome assert). */
export type RefKind = "outcome" | "preset" | "sketch" | "weak";
export interface RuleRef {
  /** Test id: a scenario or catalog id, or the file path of a preset. */
  test: string;
  kind: RefKind;
}
export interface RuleRow {
  id: string;
  title: string;
  status: Status;
  /** Allow-list reason, only when status is "pending". */
  reason?: string;
  /** What no scenario proves yet, only when status is "covered" and the rule is in the partial list. */
  partial?: string;
  tests: RuleRef[];
}
/** Allow-list: rule id -> reason. The partial list has the same shape: rule id -> what is not proven. */
export type PendingList = Record<string, string>;

/** Step ops that are not actions: every `expect*` step only reads the state. */
const isAssertion = (step: { op: string }) => step.op.startsWith("expect");

/** True when a step list asserts an outcome: an `expect*` step that comes after at least one action step. */
export function outcomeAsserts(steps: { op: string }[]): boolean {
  let acted = false;
  for (const step of steps) {
    if (!isAssertion(step)) acted = true;
    else if (acted) return true;
  }
  return false;
}

/** The part of a DSL scenario that coverage reads. */
export interface ScenarioLike {
  id: string;
  rules?: string[];
  knownBug?: string;
  steps: { op: string }[];
}

const ID = "R-(?:COMMON|TAG|FFA)-[A-Z0-9]+(?:-[A-Z0-9]+)*";

/** Parse the rule ids from the ADR. A rule bullet starts with "- `[R-...]`". */
export function parseAdrRules(markdown: string): { id: string; title: string }[] {
  const rules: { id: string; title: string }[] = [];
  const pattern = new RegExp("^- `\\[(" + ID + ")\\]` (.*)$", "gm");
  for (const match of markdown.matchAll(pattern)) {
    const title = match[2]!
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    rules.push({ id: match[1]!, title: title.length > 90 ? `${title.slice(0, 87).trimEnd()}...` : title });
  }
  return rules;
}

/** Find the ids in every `rules: [ ... ]` array of a source text. */
export function parseRuleDeclarations(source: string): string[] {
  const found = new Set<string>();
  for (const block of source.matchAll(/\brules\s*:\s*\[([^\]]*)\]/g)) {
    for (const id of block[1]!.matchAll(new RegExp(`["'\`](${ID})["'\`]`, "g"))) found.add(id[1]!);
  }
  return [...found];
}

/** Build one row per ADR rule from the references. */
export function buildRows(
  rules: { id: string; title: string }[],
  refs: { rule: string; ref: RuleRef }[],
  pending: PendingList = {},
  partial: PendingList = {},
): RuleRow[] {
  return rules.map((rule) => {
    const tests = refs.filter((r) => r.rule === rule.id).map((r) => r.ref);
    if (tests.some((t) => t.kind === "outcome")) {
      return partial[rule.id] ? { ...rule, status: "covered", partial: partial[rule.id], tests } : { ...rule, status: "covered", tests };
    }
    const reason = pending[rule.id];
    return reason ? { ...rule, status: "pending", reason, tests } : { ...rule, status: "none", tests };
  });
}

/** Allow-list entries to remove: the rule is now covered, or it is not in the ADR. */
export function staleEntries(rows: RuleRow[], pending: PendingList): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.keys(pending).filter((id) => byId.get(id)?.status !== "pending");
}

/** Partial-list entries to remove: the rule is not covered (so it is pending or unknown), or it is not in the ADR. */
export function stalePartial(rows: RuleRow[], partial: PendingList): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.keys(partial).filter((id) => byId.get(id)?.status !== "covered");
}

/** Turn the scenarios that declare `rules` into references (outcome, or weak without an outcome assert). */
export function scenarioRefs(scenarios: ScenarioLike[]): { rule: string; ref: RuleRef }[] {
  const refs: { rule: string; ref: RuleRef }[] = [];
  for (const scenario of scenarios) {
    if (!scenario.rules?.length) continue;
    const kind: RefKind = !scenario.knownBug && outcomeAsserts(scenario.steps) ? "outcome" : "weak";
    for (const rule of scenario.rules) refs.push({ rule, ref: { test: scenario.id, kind } });
  }
  return refs;
}

/** Rule ids used in references but missing from the ADR. */
export function unknownRules(known: string[], refs: { rule: string }[]): string[] {
  const set = new Set(known);
  return [...new Set(refs.map((r) => r.rule).filter((id) => !set.has(id)))];
}

export function renderTable(rows: RuleRow[], sketchEntries: number): string {
  const count = (status: Status) => rows.filter((row) => row.status === status).length;
  const list = (refs: RuleRef[], label: (ref: RuleRef) => string) => {
    const shown = refs.slice(0, 6).map(label);
    return shown.join(", ") + (refs.length > 6 ? `, and ${refs.length - 6} more` : "");
  };
  const outcomeCell = (row: RuleRow) => {
    const outcome = row.tests.filter((t) => t.kind === "outcome");
    return outcome.length === 0 ? "-" : list(outcome, (t) => `\`${t.test}\``);
  };
  const otherCell = (row: RuleRow) => {
    const named = row.tests.filter((t) => t.kind === "preset" || t.kind === "weak");
    const sketches = row.tests.filter((t) => t.kind === "sketch").length;
    const parts = [...named.slice(0, 3).map((t) => `\`${t.test}\` (${t.kind === "preset" ? "preset" : "no outcome assert"})`)];
    if (named.length > 3) parts.push(`${named.length - 3} more`);
    if (sketches > 0) parts.push(`${sketches} catalog sketch${sketches === 1 ? "" : "es"}`);
    return parts.length === 0 ? "-" : parts.join(", ");
  };
  const statusCell = (row: RuleRow) =>
    row.status === "pending" ? `pending: ${row.reason}` : row.partial ? `covered (partial: ${row.partial})` : row.status;
  const pendingCount = count("pending");
  const noneCount = count("none");
  return [
    "# Multi-player rule coverage",
    "",
    "Generated by `packages/duel-server/scripts/rule-coverage.ts`. Do not edit by hand.",
    "Rules: `docs/adr/0002-multiplayer-duel-rules.md`.",
    "",
    "A rule is **covered** only by an outcome scenario: a DSL scenario (`tests/scenarios/**`) that lists the rule in `rules: [...]`,",
    "is not a `knownBug` scenario, and has an `expect*` step after at least one action step. A check of the start state or of the",
    "first prompt is not an outcome. Presets (hand-play smoke runs), catalog sketches and scenarios with no outcome assert are",
    "listed but never counted. A rule with no outcome scenario must be in `scripts/rule-coverage-pending.json` (rule id and reason);",
    "each part that adds an outcome scenario removes its entries. `--strict` fails on a rule with no outcome scenario and no entry,",
    "on a stale entry, and on a scenario that declares `rules` with no outcome assert.",
    "",
    "A rule id is one unit: if a rule has several clauses, one tested clause is enough to mark it covered. The marker does not check",
    "which clauses a scenario proves, so read the scenario before you trust a rule that has more than one clause. When a covered rule",
    "has clauses that no scenario proves, `scripts/rule-coverage-partial.json` says so and the status reads `covered (partial: ...)`.",
    "",
    "The outcome scenarios in `tests/scenarios/multiplayer/nseat-scenarios.ts` run on a real engine only with `NSEAT_LIVE=1` and a",
    "multi core that has `Debug.SetupDuelists`. Until the live core is the default (and the gate is removed), a default `npm test` skips them.",
    "",
    `Summary: ${rows.length} rules. ${count("covered")} covered by an outcome scenario, ${pendingCount} pending (allow-list), ${noneCount} with no test and no allow-list entry. ${sketchEntries} catalog sketches are still pending (not counted).`,
    "",
    "| Rule | Text | Status | Outcome scenarios | Listed, not counted |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) => `| \`${row.id}\` | ${row.title.replace(/\|/g, "\\|")} | ${statusCell(row)} | ${outcomeCell(row)} | ${otherCell(row)} |`,
    ),
    "",
  ].join("\n");
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const here = fileURLToPath(new URL(".", import.meta.url));
export const packageRoot = resolve(here, "..");
export const repoRoot = resolve(packageRoot, "../..");

export const pendingListPath = join(packageRoot, "scripts", "rule-coverage-pending.json");
export const partialListPath = join(packageRoot, "scripts", "rule-coverage-partial.json");

/** Read the allow-list. A missing file is an empty list. A value must be a non-empty reason. */
export function loadPending(path = pendingListPath): PendingList {
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${path}: expected an object of rule id to reason`);
  for (const [id, reason] of Object.entries(data)) {
    if (typeof reason !== "string" || reason.trim() === "") throw new Error(`${path}: ${id} needs a reason`);
  }
  return data as PendingList;
}

/** Preset files: they declare `rules` for hand play, listed but not counted. */
export function presetFiles(root = packageRoot): string[] {
  return walk(join(root, "src", "presets")).filter((file) => /\.(ts|mjs)$/.test(file));
}

/** Scenario modules: plain data files under tests/scenarios (no *.test.ts, and not the catalog, which is read on its own). */
export function scenarioModules(root = packageRoot): string[] {
  return walk(join(root, "tests", "scenarios")).filter(
    (file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file) && !/scenarios[\\/]multiplayer[\\/]catalog\.ts$/.test(file),
  );
}

const looksLikeScenario = (value: unknown): value is ScenarioLike => {
  const v = value as { id?: unknown; steps?: unknown } | null;
  return typeof v === "object" && v !== null && typeof v.id === "string" && Array.isArray(v.steps);
};

/** One exported scenario array of a data module. */
export interface ScenarioList {
  file: string;
  name: string;
  scenarios: ScenarioLike[];
}

/** Import the scenario modules and return every exported array of DSL scenarios. */
export async function loadScenarioLists(root = packageRoot): Promise<ScenarioList[]> {
  const lists: ScenarioList[] = [];
  for (const file of scenarioModules(root)) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      if (Array.isArray(value) && value.some(looksLikeScenario)) lists.push({ file, name, scenarios: value.filter(looksLikeScenario) });
    }
  }
  return lists;
}

/** All scenarios of the lists, once per id. The same id in two lists is an error: the second would hide the first. */
export function uniqueScenarios(lists: ScenarioList[]): ScenarioLike[] {
  const found = new Map<string, { scenario: ScenarioLike; where: string }>();
  for (const list of lists) {
    for (const scenario of list.scenarios) {
      const where = `${relative(packageRoot, list.file)}:${list.name}`;
      const first = found.get(scenario.id);
      if (first) throw new Error(`Duplicate scenario id "${scenario.id}" in ${first.where} and ${where}`);
      found.set(scenario.id, { scenario, where });
    }
  }
  return [...found.values()].map((entry) => entry.scenario);
}

export async function loadScenarios(root = packageRoot): Promise<ScenarioLike[]> {
  return uniqueScenarios(await loadScenarioLists(root));
}

/** Test files (tests/scenarios/**\/*.test.ts) that pass a list name to runScenarios. */
export function runnerSources(root = packageRoot): string[] {
  return walk(join(root, "tests", "scenarios"))
    .filter((file) => /\.test\.ts$/.test(file))
    .map((file) => readFileSync(file, "utf8"));
}

/** Lists with a scenario that declares rules, but that no test file passes to runScenarios: their scenarios never run. */
export function unrunLists(lists: ScenarioList[], sources: string[]): string[] {
  return lists
    .filter((list) => list.scenarios.some((s) => s.rules?.length))
    .filter((list) => !sources.some((source) => new RegExp(`\\brunScenarios\\([^;]*\\b${list.name}\\b`).test(source)))
    .map((list) => `${relative(packageRoot, list.file)}:${list.name}`);
}

export async function collect(root = packageRoot) {
  const refs = scenarioRefs(await loadScenarios(root));
  for (const file of presetFiles(root)) {
    const name = relative(root, file);
    for (const rule of parseRuleDeclarations(readFileSync(file, "utf8"))) refs.push({ rule, ref: { test: name, kind: "preset" } });
  }
  const catalog = (await import(pathToFileURL(join(root, "tests/scenarios/multiplayer/catalog.ts")).href)) as {
    SCENARIOS: { id: string; rules: string[] }[];
  };
  for (const scenario of catalog.SCENARIOS) {
    for (const rule of scenario.rules) refs.push({ rule, ref: { test: scenario.id, kind: "sketch" } });
  }
  return { refs, sketchEntries: catalog.SCENARIOS.length };
}

async function main() {
  const strict = process.argv.includes("--strict");
  const checkOnly = process.argv.includes("--check");
  const adr = readFileSync(join(repoRoot, "docs/adr/0002-multiplayer-duel-rules.md"), "utf8");
  const rules = parseAdrRules(adr);
  const pending = loadPending();
  const { refs, sketchEntries } = await collect();
  const unknown = unknownRules(rules.map((r) => r.id), refs);
  const partial = loadPending(partialListPath);
  const rows = buildRows(rules, refs, pending, partial);
  const table = renderTable(rows, sketchEntries);
  const docPath = join(repoRoot, "docs/specs/multiplayer-rule-coverage.md");
  if (!checkOnly) writeFileSync(docPath, table);
  const docStale = checkOnly && (!existsSync(docPath) || readFileSync(docPath, "utf8") !== table);
  const unrun = unrunLists(await loadScenarioLists(), runnerSources());
  const count = (status: Status) => rows.filter((row) => row.status === status).length;
  const none = rows.filter((row) => row.status === "none");
  const stale = staleEntries(rows, pending);
  const stalePartialIds = stalePartial(rows, partial);
  const weak = [...new Set(refs.filter((r) => r.ref.kind === "weak").map((r) => r.ref.test))];
  console.log(`${rows.length} rules: ${count("covered")} covered by an outcome scenario, ${count("pending")} pending (allow-list), ${none.length} with no test.`);
  if (unknown.length > 0) console.error(`Unknown rule ids: ${unknown.join(", ")}`);
  if (none.length > 0) console.log(`No outcome test and not in the allow-list: ${none.map((row) => row.id).join(", ")}`);
  if (stale.length > 0) console.error(`Stale allow-list entries (covered or not in the ADR): ${stale.join(", ")}`);
  if (stalePartialIds.length > 0) console.error(`Stale partial entries (rule not covered or not in the ADR): ${stalePartialIds.join(", ")}`);
  if (weak.length > 0) console.error(`Scenarios with rules but no outcome assert: ${weak.join(", ")}`);
  if (unrun.length > 0) console.error(`Scenario lists that no test file runs: ${unrun.join(", ")}`);
  if (docStale) console.error("docs/specs/multiplayer-rule-coverage.md is out of date. Run: npx tsx scripts/rule-coverage.ts");
  if (strict && (none.length > 0 || unknown.length > 0 || stale.length > 0 || stalePartialIds.length > 0 || weak.length > 0 || unrun.length > 0 || docStale)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
