import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isDoc, sourceFile } from "./test-areas.mjs";

// Inputs whose effects cannot be bounded by module imports. Keep this list in
// sync with test setup, runtime loaders, and workspace build entry points.
const fullSuiteInputs = [
  // Installation, resolution, transforms, generated types and workflow wiring.
  /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|(?:vite|vitest|next|postcss)[^/]*\.config\.[^/]+|\.npmrc|\.nvmrc|turbo\.json)$/,
  /(?:^|\/)\.env(?:\.|$)/,

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

function fullSuiteInput(file) {
  if (fullSuiteInputs.some(pattern => pattern.test(file))) return true;
  // JSON, SQL, CSS, snapshots, media, shell scripts, and new or unknown layouts
  // all fall back. Only code inside the known workspace module trees can narrow.
  return !sourceFile.test(file) || !/^packages\/[^/]+\/(?:app|src|tests|scripts)\//.test(file);
}

export function fullSuiteReason(root, changes) {
  for (const file of changes) {
    if (isDoc(file)) continue;
    if (fullSuiteInput(file)) return `configuration or runtime input: ${file}`;
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
