import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ZERO_SHA = /^0+$/;

// engine=true runs cores, engine, engine-legacy, native and rule-coverage. Pull requests and pushes to main use the
// changed files; any other event (schedule, manual run) and a push without a usable diff run every job.
export function changedLayers(files, event) {
  if (!["pull_request", "push"].includes(event) || files === null) return { engine: true, golden: true, tests_only: false };
  // Retain main's reviewed exemptions. Unknown shared paths still require the engine.
  const nonEngine = /^(packages\/shared\/(tests\/|scripts\/README\.md$|src\/maintenance\/repair-ratings\.ts$|src\/services\/(bug-reports|card-images|cubes|deal|draft-access|draft-decks|draft-tournament|drafts|guild-settings|live-now|players|tournament-registrations)\.ts$)|scripts\/(seed\.ts$|generate-draft-catalog-snapshot\.ts$|data\/draft-catalog-legendary\.json$))/;
  // The ADR-0002 rules and the coverage table are inputs of rule-coverage.
  const engine = files.some((file) => !nonEngine.test(file) && /^(packages\/(duel-server|shared|e2e)\/|patches\/|scripts\/|\.github\/workflows\/test\.yml$|package(-lock)?\.json$|turbo\.json$|tsconfig[^/]*\.json$|\.nvmrc$|docs\/adr\/0002-multiplayer-duel-rules\.md$|docs\/specs\/multiplayer-rule-coverage\.md$)/.test(file));
  // Golden rows depend only on the core, overlay, data pins and native tooling (and the step's own wiring).
  const golden = files.some((file) => /^(\.github\/workflows\/test\.yml$|scripts\/ci\/changed-layers\.mjs$)|^packages\/duel-server\/(domain-core\/(patches\/|multi-scripts\/|pins\.json$)|scripts\/(native\/|(?:run-nduel|build-native-core|prepare-multi-core-tree|multi-core-common)\.sh$|(?:prepare-data|released-card-data)\.ts$))/.test(file));
  // Main pushes always run the full engine suites when engine=true; only pull requests get a narrow test selection.
  const tests_only = event === "pull_request" && files.length > 0 && files.every((file) => file.startsWith("packages/duel-server/tests/"));
  return { engine, golden, tests_only };
}

// The changed files, or null when there is no usable diff (then every job runs).
function changedFiles(event, base, head) {
  if (!["pull_request", "push"].includes(event) || !base || !head || ZERO_SHA.test(base)) return null;
  try {
    if (event === "push") execFileSync("git", ["merge-base", "--is-ancestor", base, head]);
    const range = event === "pull_request" ? `${base}...${head}` : `${base}..${head}`;
    return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", range], { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch (error) {
    console.warn(`No usable diff for ${event} ${base}..${head}; every job runs. ${error.message}`);
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.EVENT;
  const base = event === "push" ? process.env.PUSH_BEFORE : process.env.BASE;
  const head = event === "push" ? process.env.PUSH_AFTER : process.env.HEAD;
  const files = changedFiles(event, base, head);
  console.log(files === null ? "(no diff)" : files.join("\n"));
  const outputs = { ...changedLayers(files, event), base: base ?? "", head: head ?? "" };
  console.log(outputs);
  for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
