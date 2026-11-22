import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Inputs whose effects cannot be bounded by module imports. Keep this list in
// sync with test setup, runtime loaders, and workspace build entry points.
const fullSuiteInputs = [
  // Installation, resolution, transforms, generated types and workflow wiring.
  /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|(?:vite|vitest|next|postcss)[^/]*\.config\.[^/]+|\.npmrc|\.nvmrc|turbo\.json)$/,
  /(?:^|\/)\.env(?:\.|$)|\.d\.[cm]?ts$/,
  /^(?:\.github\/|patches\/|scripts\/ci\/.*(?:test-inputs|test-files))/,

  // Test bootstrap, global mocks, environment loaders and database initialization.
  /(?:^|\/)(?:__mocks__|mocks|migrations?|schema|fixtures|__snapshots__|seeds?|assets|public|data)\//,
  /(?:^|\/)(?:setup|global-setup|test-setup|instrument|instrumentation|env|dotenv|schema|migrate|engine-data-dir)\.[cm]?[jt]sx?$/,
  /(?:^|\/)(?:test|vitest)[.-]setup\./,

  // Runtime-loaded TS, worker entry points, native and engine inputs.
  /^packages\/bot\/src\/(?:index|deploy-commands|runtime\/registry)\.ts$/,
  /^packages\/ws\/src\/server\.ts$/,
  /^packages\/worker\/src\/index\.ts$/,
  /^packages\/duel-server\/(?:domain-core|legacy-1v1|card-script-patches|tests\/(?:scenarios\/(?:cases|generated)|support))\//,
  /^packages\/duel-server\/src\/(?:card-effects|card-effect-facets|server)\.ts$/,
];

export const sourceFile = /\.[cm]?[jt]sx?$/;

function fullSuiteInput(file) {
  if (fullSuiteInputs.some(pattern => pattern.test(file))) return true;
  // JSON, SQL, CSS, snapshots, media, shell scripts, and new or unknown layouts
  // all fall back. Only code inside the known workspace module trees can narrow.
  return !sourceFile.test(file) || !/^packages\/[^/]+\/(?:app|src|tests|scripts)\//.test(file);
}

// The old layer detector doesn't know about these runtime file reads.
export const extraFullSuites = {
  web: /^Dockerfile$/,
  shared: /^packages\/web\/src\/lib\/remote\/card-behaviour-data\.json$/,
  duel_unit: /^packages\/web\/src\/lib\/(?:remote\/card-(?:logic|behaviour)-data|card-data-history)\.json$/,
};

export function fullSuiteReason(root, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return "no usable PR diff";
  for (const file of changes) {
    if (/\.md$/i.test(file) || file.startsWith("docs/")) continue;
    if (fullSuiteInput(file)) return `configuration, runtime or unknown input: ${file}`;
    if (!existsSync(resolve(root, file))) return `deleted or renamed input: ${file}`;
  }
}

// Some tests pass entry points to child processes as strings or copy them into
// a temporary tree. Include their entry points so transitive imports count too.
export const runtimeDependencies = {
  "packages/bot/tests/bot-enabled.test.ts": [
    "packages/bot/src/index.ts", "packages/bot/src/deploy-commands.ts",
  ],
  "packages/web/tests/draft-pick.test.ts": ["scripts/seed.ts"],
  "packages/web/tests/drafts-route.test.ts": ["scripts/seed.ts"],
  "packages/web/tests/seed-script.test.ts": ["scripts/seed.ts"],
  "packages/duel-server/tests/startup-database.integration.test.ts": ["packages/duel-server/src/server.ts"],
  "packages/duel-server/tests/fuzz-first-turn-draw.test.ts": ["packages/duel-server/scripts/fuzz-repro.ts"],
  "packages/duel-server/tests/fuzz-n/isolated.ts": ["packages/duel-server/scripts/fuzz-n.ts"],
  "packages/duel-server/tests/host-report-replay.test.ts": ["packages/duel-server/scripts/replay-journal.ts"],
  "packages/duel-server/tests/update-engine-data.test.ts": ["packages/duel-server/scripts/validate-engine-data.ts"],
  "packages/duel-server/tests/verify-deploy-multi-cores.test.ts": ["packages/duel-server/scripts/verify-deploy-multi-cores.mjs"],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const layers = JSON.parse(process.env.CI_LAYERS);
  const files = JSON.parse(layers.test_diff);
  const extra = Object.entries(extraFullSuites).filter(([, inputs]) => files.some(file => inputs.test(file)));
  for (const [suite] of extra) appendFileSync(process.env.GITHUB_OUTPUT, `${suite}=true\n`);
  if (["web", "shared", "bot", "ws", "worker", "duel_unit"].some(suite => layers[suite] === "true") || extra.length) {
    const reason = fullSuiteReason(fileURLToPath(new URL("../../", import.meta.url)), files);
    if (reason) console.log(`PR test selection falls back to full suites: ${reason}`);
    else appendFileSync(process.env.GITHUB_OUTPUT, "scan=true\n");
  }
}
