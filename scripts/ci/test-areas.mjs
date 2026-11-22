// PR ownership and the existing runners that implement it. Order matters:
// narrower paths (engine, effects, DB) take precedence over package roots.
export const workspaces = {
  web: "web", ws: "ws", worker: "worker", bot: "bot", shared: "shared",
  duel_unit: "duel-server", vision: "vision",
};

const newCardSmokeInput = /^packages\/duel-server\/scripts\/(?:lib\/)?new-card-smoke(?:-[^/]+)?\.ts$/;
const tableSeatState = "packages/web/src/components/duel/table/seat-state.ts";

export const areas = {
  engine: {
    paths: [
      newCardSmokeInput,
      /^packages\/shared\/(?:src|tests)\/duels\//,
      /^packages\/duel-server\/(?:domain-core|legacy-1v1|card-script-patches)\//,
      /^packages\/duel-server\/(?:package|card-remap-overrides|card-block-list)\.json$/,
      /^packages\/duel-server\/src\/(?:engine|core|domain-core|legacy|presets)\//,
      /^packages\/duel-server\/src\/(?:engine(?:-[^/]+)?|domain-core|worker(?:-protocol|-client|-pool|-error)?|core-capabilities|wasm-sync-export)\.ts$/,
      /^packages\/duel-server\/src\/(?:attack-target-pick|answer-validation|chain-(?:activator|mode|options)|domain-action-prompts|first-turn-draw|hand-identities|lp-opponent-hints|prompt(?:s|-match|-trace)|raw-messages|scripted-bot|sort-response|views)\.ts$/,
      /^packages\/duel-server\/src\/(?:cards|card-(?:hints|name-search|script-[^/]+)|multi-(?:scripts|domain-guard)|released-database-files|script-errors|script-load-scope|target-names|text)\.ts$/,
      /^packages\/duel-server\/scripts\/(?:native\/|(?:build-[^/]*core[^/]*|prepare-data|released-card-data|prerelease[^/]*|card-script-patches|build-card-(?:logic|behaviour))\.)/,
      /^packages\/duel-server\/scripts\/(?:prepare-multi-core-tree|multi-core-common|install-engine-bundle|check-legacy-pin|package-deploy-multi-cores|run-nduel|rule-coverage)\./,
      /^packages\/duel-server\/tests\/(?:support\/|scenarios\/|legacy-main\/|differential\/|fuzz(?:-n)?\/|[^/]+\.smoke\.ts$)/,
      /^(?:data\/duel-engine[^/]*\/|scripts\/native\/|docs\/(?:adr\/0002-multiplayer-duel-rules\.md|specs\/multiplayer-rule-coverage\.md)$)/,
    ],
    suites: ["duel_unit"],
    smoke: { duel_unit: ["tests/sort-response.test.ts"] },
  },
  effects: {
    paths: /^(?:scripts\/effects\/|packages\/shared\/(?:src\/cards\/effects|data\/effects)\/|packages\/duel-server\/src\/card-effect[^/]*\.ts$)/,
    suites: [],
    smoke: { effects: ["scripts/effects/tests/bridge-artifacts.integration.test.ts"] },
  },
  shared_db: {
    paths: /^packages\/shared\/(?:src\/db|tests\/db|data\/(?:migrations?|schema))\//,
    suites: ["shared"],
    smoke: { shared: ["tests/db/schema.test.ts"] },
  },
  shared_services: {
    paths: /^packages\/shared\//,
    suites: ["shared"],
    consumers: ["web", "ws", "worker", "bot", "duel_unit", "vision"],
    consumerPaths: /^packages\/shared\/(?!tests\/)/,
    smoke: { shared: ["tests/services/drafts.test.ts"] },
  },
  duel_host: {
    paths: /^packages\/duel-server\//,
    suites: ["duel_unit"],
    smoke: { duel_unit: ["tests/decision-clock-credit.test.ts"] },
  },
  web: {
    paths: /^(?:packages\/web\/|site\/|scripts\/(?:seed|generate-draft-catalog-snapshot)\.ts$)/,
    suites: ["web"],
    smoke: { web: ["tests/observability-migration.test.ts"] },
  },
  ws: {
    paths: /^packages\/ws\//, suites: ["ws"],
    // The worker health integration starts WS from source.
    consumers: ["worker"], consumerPaths: /^packages\/ws\/src\//,
    smoke: { ws: ["tests/observability.test.ts"] },
  },
  worker: {
    paths: /^packages\/worker\//, suites: ["worker"],
    smoke: { worker: ["tests/analytics-drain.test.ts"] },
  },
  bot: {
    paths: /^packages\/bot\//, suites: ["bot"],
    smoke: { bot: ["tests/bot-enabled.test.ts"] },
  },
  e2e: {
    paths: /^packages\/e2e\//, suites: [],
    // CI checks Playwright types; browser flows use the separate local stack.
  },
  vision: {
    paths: /^(?:packages\/vision\/|scripts\/vision\/)/, suites: ["vision"],
    smoke: { vision: ["src/face-state.test.ts"] },
  },
  deploy: {
    paths: /^(?:scripts\/deployment\/|Dockerfile$|\.dockerignore$|Caddyfile$|docker-compose[^/]*\.ya?ml$|\.github\/(?:workflows\/deploy\.yml$|actions\/(?:prepare-production-bundle|build-production-image|reuse-production-image)\/))/,
    suites: ["ci_scripts"],
  },
  ci: {
    paths: /^(?:scripts\/ci\/|\.github\/|docs\/engine\/core-pins\.md$)/,
    suites: ["ci_scripts"],
  },
};

const testInputDocs = /^(?:docs\/adr\/0002-multiplayer-duel-rules\.md|docs\/specs\/multiplayer-rule-coverage\.md|docs\/engine\/core-pins\.md)$/;
export const isDoc = file => !testInputDocs.test(file) && (/\.md$/i.test(file) || file.startsWith("docs/"));
export const isDeclaration = file => /\.d\.[cm]?ts$/.test(file);
export const sourceFile = /\.[cm]?[jt]sx?$/;
export const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
export const webEngineTest = (file, source = "") => file.startsWith("packages/web/tests/") && testFile.test(file) &&
  source.split("\n").some(line => !/^\s*(?:\/\/|\*)/.test(line) && /duel-server\/tests\/support\/cores(?:\.js)?["']/.test(line));

export const effectTypeInput = /^(?:scripts\/effects|packages\/(?:shared|duel-server))\//;

// Test workflow and CI helper changes select smoke, even when they edit engine
// orchestration. Vitest configs, the lockfile and root tooling are full inputs.
export const globalInput = file => /^(?:package(?:-lock)?\.json$|tsconfig[^/]*\.json$|turbo\.json$|\.npmrc$|\.nvmrc$|patches\/)/.test(file) ||
  /(?:^|\/)vitest(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(file);
export const ciWiring = /^(?:\.github\/(?:workflows|actions)\/|scripts\/ci\/)/;

// Runtime hubs stop reverse traversal. Dedicated same-package tests may link
// directly to a hub, and the fixed consumer smokes below cover representative callers.
export const isHub = file => /^packages\/[^/]+\/(?:src|app)\//.test(file) && sourceFile.test(file) &&
  /(?:\/(?:observability|analytics|logging|loggers?|utils?|config|env)\/|\/(?:env|config|logger|logging|log-lines|utils?|instrument(?:ation)?|dotenv)\.[cm]?[jt]sx?$)/.test(file);

export function hubTest(file, hub) {
  if (file.split("/")[1] !== hub.split("/")[1] || !testFile.test(file)) return false;
  const topic = hub.match(/\/(observability|analytics|logging|loggers?|utils?|config|env)\//)?.[1]
    ?? hub.split("/").at(-1).split(".")[0];
  return file.includes("/" + topic + "/") || file.split("/").at(-1).startsWith(topic + "-") ||
    file.split("/").at(-1).startsWith(topic + ".");
}

export function areaFor(file, duelEngineTests) {
  // Other duel test files are classified by the same inventory as Vitest.
  // A missing file may have been removed from that inventory.
  if (duelEngineTests?.has(file)) return "engine";
  return Object.keys(areas).find(area => [areas[area].paths].flat().some(path => path.test(file)));
}

export function areaSmokes(selected = Object.keys(areas)) {
  const result = {};
  for (const area of selected) {
    for (const [suite, files] of Object.entries(areas[area].smoke ?? {})) {
      result[suite] = [...new Set([...(result[suite] ?? []), ...files])];
    }
  }
  return result;
}

// These workspace imports bypass package manifests. Manifest dependencies are
// discovered by name as well. Only one dependency edge is followed.
export const sourceDependents = {
  "duel-server": ["web", "shared", "bot", "e2e"],
  shared: ["vision"],
  vision: ["shared"],
  web: ["duel-server", "e2e", "vision"],
  ws: ["duel-server", "worker"],
};

export const coreInput = file =>
  /^scripts\/native\//.test(file) ||
  /^packages\/duel-server\/(?:package\.json$|card-script-patches\/|domain-core\/(?:src\/|lua\/|patches\/|multi-scripts\/|pins\.json$|expected-sha256\.txt$)|legacy-1v1\/(?:domain-core\/|scripts\/build-[^/]*core\.(?:sh|ts)$|expected-sha256\.txt$)|scripts\/(?:native\/|build-[^/]*core\.(?:sh|ts)$|(?:prepare-data|released-card-data|card-script-patches)\.ts$|(?:prepare-multi-core-tree|multi-core-common|check-legacy-pin|run-nduel)\.sh$)|tests\/(?:differential\/|fuzz\/|support\/(?:cores|shard|setup)\.ts$))/.test(file);

export const goldenInput = /^packages\/duel-server\/(?:card-script-patches\/|domain-core\/(?:patches\/|multi-scripts\/|pins\.json$)|scripts\/(?:native\/|(?:run-nduel|build-native-core|prepare-multi-core-tree|multi-core-common)\.sh$|(?:prepare-data|released-card-data|card-script-patches)\.ts$))/;

export const productionInput = /^(?:Dockerfile$|\.dockerignore$|\.github\/actions\/(?:prepare-production-bundle|build-production-image|reuse-production-image)\/|scripts\/deployment\/|packages\/shared\/(?:package\.json$|tsconfig[^/]*\.json$|src\/duels\/)|packages\/duel-server\/(?:domain-core\/|legacy-1v1\/|card-script-patches\/|card-remap-overrides\.json$|scripts\/(?:prepare-data|released-card-data|prerelease[^/]*|card-script-patches|build-[^/]*core[^/]*|prepare-multi-core-tree|multi-core-common|install-engine-bundle|check-legacy-pin|package-deploy-multi-cores)\.|src\/(?:multi-scripts|released-database-files|cards|card-script-source|card-name-search|card-script-patches)\.ts$))/;

// Known generated and runtime-only readers do not appear as module imports.
export const additionalOwners = {
  // Real-core Owner Hands/Exodia scenarios exercise these table rules.
  [tableSeatState]: ["engine"],
  "packages/web/src/lib/remote/card-behaviour-data.json": ["engine", "shared_services", "duel_host"],
  "packages/web/src/lib/remote/card-logic-data.json": ["engine", "duel_host"],
  "packages/web/src/lib/card-data-history.json": ["duel_host"],
  "packages/shared/src/remote/card-behaviour.ts": ["engine"],
};

// These raw files are read by path rather than imported. Retain their
// representative integration set alongside any other area inputs in the PR.
export const dataConsumers = {
  paths: /^packages\/shared\/data\/(?:effects|staples)\//,
  files: {
    shared: ["tests/effect-artifact.integration.test.ts", "tests/effect-artifact-identity.integration.test.ts",
      "tests/effect-search.integration.test.ts", "tests/cube-effect-search.integration.test.ts"],
    duel_unit: ["tests/host-deck-suggestions.integration.test.ts", "tests/host-deck-suggestion-scope.integration.test.ts",
      "tests/deck-suggestion-workers.integration.test.ts"],
    web: ["tests/cube-effects-routes.integration.test.ts", "tests/effect-startup.integration.test.ts",
      "tests/deck-effect-search-route.integration.test.ts", "tests/deck-effect-search-ui.integration.test.tsx",
      "tests/effect-standalone.integration.test.ts"],
  },
};

// Static engine graph only for TS/JS inputs. Workflows use the tuned full
// engine plan for core/data/configuration or when the graph cannot bound them.
export const engineGraphInput = file => newCardSmokeInput.test(file) || file === tableSeatState ||
  (sourceFile.test(file) && /^packages\/(?:shared\/(?:src|tests)\/duels\/|duel-server\/(?:src|tests)\/|web\/tests\/)/.test(file));
