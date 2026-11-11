import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import { NEEDS_ENGINE, SURRENDER_FILES, DIFFERENTIAL_FILES } from "./engine-test-plan.mjs";

const ZERO_SHA = /^0+$/;
const AREAS = ["web", "bot", "ws", "worker", "shared", "duel_unit", "e2e", "ci_scripts"];
const globalInput = (file) => /^(package(-lock)?\.json$|turbo\.json$|tsconfig[^/]*\.json$|vitest[^/]*\.[cm]?[jt]s$|\.nvmrc$|\.github\/workflows\/|\.github\/actions\/setup-ci-node\/|patches\/)/.test(file);
const allLayers = () => ({ ...Object.fromEntries(AREAS.map(area => [area, true])), docs_only: false, data_only: false, effects: true, prod_build: true, engine: true, engine_app: false, core: true, golden: true, tests_only: false });

// Native checks build the repo patch series and pinned Lua via multi-core-common.sh.
// Differential uses the WASM targets built by build-core.sh/core-cache-key.mjs.
// Include their build/test wiring and the data/Lua overlays read by native and golden checks.
// TS host code alone does not select core checks.
const coreInput = (file) =>
  /^(patches\/|scripts\/native\/|scripts\/ci\/(?:build-core\.sh$|parallel-emxx\.py$|bin\/em\+\+$|core-cache-key\.mjs$|assemble-core-bundle\.mjs$|changed-layers\.mjs$|run-engine-tests\.mjs$|engine-test-plan\.mjs$)|\.github\/workflows\/test\.yml$|\.github\/actions\/restore-engine-bundle\/|package(-lock)?\.json$|\.nvmrc$)/.test(file) ||
  /^packages\/duel-server\/(?:card-script-patches\/|domain-core\/(?:src\/|lua\/|patches\/|multi-scripts\/|pins\.json$|expected-sha256\.txt$)|legacy-1v1\/(?:domain-core\/|scripts\/build-[^/]*core\.(?:sh|ts)$|expected-sha256\.txt$)|scripts\/(?:native\/|build-[^/]*core\.(?:sh|ts)$|(?:prepare-data|released-card-data|card-script-patches)\.ts$|(?:prepare-multi-core-tree|multi-core-common|check-legacy-pin|run-nduel)\.sh$)|tests\/(?:differential\/|fuzz\/|support\/(?:cores|shard|setup)\.ts$)|vitest\.config\.ts$|package\.json$)/.test(file);

const docTestInputs = new Map([
  ["docs/adr/0002-multiplayer-duel-rules.md", "engine"],
  ["docs/specs/multiplayer-rule-coverage.md", "engine"],
  ["docs/engine/core-pins.md", "ci_scripts"],
]);
const isDoc = (file) => !docTestInputs.has(file) && (/\.md$/i.test(file) || file.startsWith("docs/"));

// Start at the engine host/workers and core suites, not HTTP/DB startup or unit tests.
// DB connection/migration are fixture setup; card remaps and engine-used services
// remain inputs. Resolve their named barrel imports so unrelated services stay out.
const engineRuntimeRoots = ["host", "engine", "legacy/index", "worker", "engine-resource-worker",
  "deck-suggestion-worker", "replay-worker", "replay-json-worker"].map(file => `packages/duel-server/src/${file}.ts`);
const applicationSetup = file => /^packages\/shared\/src\/db\/(?:connection|schema)\.[cm]?[jt]s$/.test(file);
const applicationBarrel = file => /^packages\/shared\/src\/(?:db|services)\/index\.ts$/.test(file);
const moduleReferences = source => [...source.matchAll(/["'`]((?:\.\.?\/|@yugidraft\/shared\/|@\/)[^"'`\s]+)["'`]/g)];

// These application boundaries have dedicated host/series/recording coverage.
// This is a lane choice, never an exclusion: membership in the import graph is
// still required. Other shared services (deck validation, replay, etc.) stay full.
const applicationEngineInput = file => /^packages\/shared\/src\/(?:remote\/|services\/(?:remote-[^/]+|tournament-remote[^/]*|duel-series|matches|tournament-duels|tournaments|tournament-visibility|index)\.ts$)/.test(file);
const serviceBarrel = "packages/shared/src/services/index.ts";
// A barrel can redirect engine/deck exports too. Narrow it only when the actual
// edit consists entirely of Remote service re-exports; unknown edits stay full.
export function remoteBarrelEdit(before, after) {
  const lines = source => new Set(source.split("\n").map(line => line.trim()).filter(Boolean));
  const oldLines = lines(before), newLines = lines(after);
  const changed = [...oldLines].filter(line => !newLines.has(line)).concat([...newLines].filter(line => !oldLines.has(line)));
  return changed.length > 0 && changed.every(line => /^export\s+(?:\*|\{[^}]+\})\s+from\s+["']\.\/(?:remote-|tournament-remote)[^/"']*\.js["'];?$/.test(line));
}
export const webEngineTest = (file, source) => file.startsWith("packages/web/tests/") && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
  /duel-server\/tests\/support\/cores(?:\.js)?["']/.test(source);

const prefix = "packages/duel-server/tests/";
const webPrefix = "packages/web/tests/";
const isTest = file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.startsWith(prefix + "support/fixtures/");

/** Follow changed application inputs from every duel and web engine test root.
 * Fixture-worker host tests matter too: they exercise the same service calls.
 * Keep lifecycle/recording gates as a minimum for engine-imported inputs.
 */
export function selectApplicationTests(sources, changed, exports) {
  // Unit-only Remote consumers do not make an application input engine-relevant.
  const engineInputs = engineSharedFiles(sources, exports);
  const inputs = changed.filter(input => engineInputs.has(input));
  if (!inputs.length) return { files: [], webFiles: [] };
  const affected = Object.entries(sources).filter(([file, source]) => {
    if (!(file.startsWith(prefix) && isTest(file)) && !webEngineTest(file, source)) return false;
    const dependencies = engineSharedFiles(sources, exports, [file]);
    return inputs.some(input => dependencies.has(input));
  }).map(([file]) => file).sort();
  return {
    files: [...new Set([
      "tests/host.test.ts", "tests/host-series.test.ts", "tests/draft-deck-legality.test.ts",
      ...affected.filter(file => file.startsWith(prefix)).map(file => file.slice("packages/duel-server/".length)),
    ])],
    webFiles: affected.filter(file => file.startsWith(webPrefix)).map(file => file.slice("packages/web/".length)),
  };
}

// Focused shards run whole files with plain Vitest sharding. Slow suites need
// the full lane's surrender legs/differential jobs; broad selections need its LPT plan.
export function applicationSelectionNeedsFullEngine(files, duelSuiteCount) {
  return files.some(file => SURRENDER_FILES.includes(file) || DIFFERENTIAL_FILES.includes(file)) ||
    files.length > duelSuiteCount / 2;
}

/** Follow literal imports, re-exports and file readers; keep missing paths for deletions.
 * Namespace/dynamic imports and unknown exports conservatively retain the whole barrel.
 */
export function engineSharedFiles(sources, exports, roots) {
  const resolve = (file, reference) => {
    let path;
    if (reference.startsWith("@yugidraft/shared/")) {
      const subpath = "./" + reference.slice("@yugidraft/shared/".length);
      const entry = exports[subpath];
      const target = typeof entry === "string" ? entry : entry?.source ?? entry?.default;
      path = target ? "packages/shared/" + target.replace(/^\.\//, "").replace(/^dist\//, "src/")
        : "packages/shared/src/" + subpath.slice(2);
    } else if (reference.startsWith("@/")) path = "packages/web/src/" + reference.slice(2);
    else path = posix.normalize(posix.join(posix.dirname(file), reference));
    if (!/^(packages\/shared\/src|packages\/duel-server\/(src|tests|scripts)|packages\/web\/(src|tests|app|e2e))\//.test(path)) return [];
    const stem = path.replace(/\.[cm]?jsx?$/, "");
    return [...new Set([path, stem + ".ts", stem + ".tsx", stem + "/index.ts"])];
  };
  const exportedNames = (list) => list.split(",").map(item => item.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)).filter(Boolean);
  const ownsExport = (file, name, checking = new Set()) => {
    if (checking.has(file)) return false;
    checking.add(file);
    const source = sources[file] ?? "";
    if (new RegExp(`\\bexport\\s+(?:(?:declare|async|abstract)\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`).test(source)) return true;
    for (const [, list] of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
      if (exportedNames(list).includes(name)) return true;
    }
    return [...source.matchAll(/\bexport\s+(?:type\s+)?\*\s+from\s+["']([^"']+)["']/g)]
      .some(([, reference]) => resolve(file, reference).some(target => ownsExport(target, name, checking)));
  };
  const references = new Map(Object.entries(sources).map(([file, source]) => [file, moduleReferences(source)]));
  const dependencies = new Map([...references].map(([file, refs]) => [file, refs.flatMap(([, reference]) => resolve(file, reference))]));
  const needsCores = new Set(["packages/duel-server/tests/support/cores.ts"]);
  let added;
  do {
    added = false;
    for (const [file, deps] of dependencies) {
      if (!needsCores.has(file) && deps.some(dep => needsCores.has(dep))) {
        needsCores.add(file);
        added = true;
      }
    }
  } while (added);

  const seen = new Set();
  const expanded = new Set();
  const visit = (file, names) => {
    if (applicationSetup(file)) return;
    const key = file + (applicationBarrel(file) && names ? ":" + [...names].sort().join(",") : ":*");
    if (expanded.has(key)) return;
    expanded.add(key);
    seen.add(file);
    const source = sources[file] ?? "";
    const knownNames = names && applicationBarrel(file) ? names.filter(name => ownsExport(file, name)) : undefined;
    for (const match of references.get(file) ?? []) {
      const targets = resolve(file, match[1]);
      const before = source.slice(0, match.index);
      const named = before.match(/\b(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s+from\s*$/);
      const star = /\bexport\s+(?:type\s+)?\*\s+from\s*$/.test(before);
      if (knownNames && knownNames.length === names.length && (named || star)) {
        const relevant = named ? knownNames.some(name => exportedNames(named[1]).includes(name))
          : knownNames.some(name => targets.some(target => ownsExport(target, name)));
        // A deleted export target has unknown ownership and must keep coverage.
        if (!relevant && targets.some(target => sources[target] !== undefined)) continue;
      }
      const importedNames = named?.[1].split(",").map(item => item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);
      for (const candidate of targets) visit(candidate, importedNames);
    }
  };
  if (roots) {
    for (const file of roots) visit(file);
    return seen;
  }
  for (const file of engineRuntimeRoots) visit(file);
  visit("packages/duel-server/tests/support/setup.ts");
  visit("packages/duel-server/scripts/rule-coverage.ts");
  for (const file of Object.keys(sources)) {
    const relative = file.replace(/^packages\/duel-server\//, "");
    if (file.startsWith("packages/duel-server/tests/scenarios/") ||
      (relative.startsWith("tests/") && /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative) &&
        (needsCores.has(file) || NEEDS_ENGINE.some(pattern => pattern.endsWith("/**") ? relative.startsWith(pattern.slice(0, -2)) : relative === pattern))) ||
      webEngineTest(file, sources[file])) visit(file);
  }
  return seen;
}

let sharedDependencies;
let sharedSources;
const applicationSelections = new Map();
export function engineSources() {
  const root = new URL("../../", import.meta.url);
  const sources = {};
  const collect = (dir) => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const path = dir + entry.name;
      if (entry.isDirectory()) collect(path + "/");
      else if (/\.[cm]?[jt]sx?$/.test(path)) sources[path] = readFileSync(new URL(path, root), "utf8");
    }
  };
  for (const dir of ["packages/duel-server/src/", "packages/duel-server/tests/", "packages/duel-server/scripts/", "packages/shared/src/",
    "packages/web/src/", "packages/web/tests/", "packages/web/app/", "packages/web/e2e/"]) collect(dir);
  return { sources, exports: JSON.parse(readFileSync(new URL("packages/shared/package.json", root), "utf8")).exports };
}

function sharedEngineInput(file) {
  if (file.startsWith("packages/shared/src/duels/")) return true;
  if (!file.startsWith("packages/shared/src/")) return false;
  if (!sharedDependencies) {
    sharedSources = engineSources();
    const { sources, exports } = sharedSources;
    sharedDependencies = engineSharedFiles(sources, exports);
  }
  return sharedDependencies.has(file);
}

// Main retains full suites for imported application helpers. Only small PR
// selections use the focused lane. Missing diffs and nightly/manual stay full.
export function changedLayers(files, event, { serviceBarrelAppOnly = false } = {}) {
  if (!["pull_request", "push"].includes(event) || files === null) return allLayers();
  const core = files.some(file => !isDoc(file) && coreInput(file));
  const focusedInput = file => applicationEngineInput(file) && (file !== serviceBarrel || serviceBarrelAppOnly);
  let engine = core || files.some((file) => !isDoc(file) && (
    docTestInputs.get(file) === "engine" || globalInput(file) ||
    (sharedEngineInput(file) && !(event === "pull_request" && focusedInput(file))) ||
    file === "packages/web/src/components/duel/table/seat-state.ts" ||
    // Remote Duels card logic/behaviour: the generated files are checked against the engine data in the engine shards.
    /^(packages\/shared\/src\/remote\/card-behaviour\.ts|packages\/web\/src\/lib\/remote\/card-(?:logic|behaviour)-data\.json)$/.test(file) ||
    /^(packages\/duel-server\/(?!domain-core\/proposals\/)|packages\/shared\/(package\.json$|tsconfig[^/]*\.json$)|data\/duel-engine[^/]*\/|patches\/|scripts\/(native\/|ci\/(?:build-core|parallel-emxx|bin\/em\+\+|core-cache-key|assemble-core-bundle|run-engine-tests|select-engine-tests|engine-sequencer|engine-test-plan|engine-test-times|duel-test-files|check-engine-test-coverage|changed-layers|publish-engine-data))|\.github\/actions\/(restore-engine-bundle|prepare-production-bundle|setup-ci-node)\/|\.github\/workflows\/test\.yml$|package(-lock)?\.json$|turbo\.json$|tsconfig[^/]*\.json$|\.nvmrc$)/.test(file)
  ));
  let engine_app = event === "pull_request" && !engine && files.some(file => focusedInput(file) && sharedEngineInput(file));
  if (engine_app) {
    const { sources, exports } = sharedSources;
    const inputs = files.filter(file => focusedInput(file) && sharedDependencies.has(file)).sort();
    const key = JSON.stringify(inputs);
    if (!applicationSelections.has(key)) {
      const selected = selectApplicationTests(sources, inputs, exports);
      const total = Object.keys(sources).filter(file => file.startsWith(prefix) && isTest(file)).length;
      applicationSelections.set(key, applicationSelectionNeedsFullEngine(selected.files, total));
    }
    if (applicationSelections.get(key)) {
      engine = true;
      engine_app = false;
    }
  }
  // Golden rows depend only on the core, overlay, data pins and native tooling (and the step's own wiring).
  const golden = files.some((file) => /^(\.github\/workflows\/test\.yml$|scripts\/ci\/changed-layers\.mjs$)|^packages\/duel-server\/(card-script-patches\/|domain-core\/(patches\/|multi-scripts\/|pins\.json$)|scripts\/(native\/|(?:run-nduel|build-native-core|prepare-multi-core-tree|multi-core-common)\.sh$|(?:prepare-data|released-card-data|card-script-patches)\.ts$))/.test(file));
  // Main pushes always run the full engine suites when engine=true; only pull requests get a narrow test selection.
  const tests_only = event === "pull_request" && files.length > 0 && files.every((file) => file.startsWith("packages/duel-server/tests/"));
  const areas = Object.fromEntries(AREAS.map(area => [area, false]));
  const consumers = () => { for (const area of AREAS.filter(area => area !== "ci_scripts")) areas[area] = true; };
  for (const file of files.filter(file => !isDoc(file))) {
    if (docTestInputs.has(file)) {
      if (docTestInputs.get(file) === "ci_scripts") areas.ci_scripts = true;
    }
    else if (globalInput(file)) { for (const area of AREAS) areas[area] = true; }
    else if (/^packages\/shared\/(src\/|package\.json$|tsconfig)/.test(file)) consumers();
    else if (/^packages\/shared\/data\/(effects|staples)\//.test(file)) { areas.web = true; areas.shared = true; areas.duel_unit = true; }
    else if (file.startsWith("packages/shared/data/")) consumers();
    else if (file.startsWith("packages/shared/tests/helpers/")) { areas.shared = true; areas.duel_unit = true; }
    else if (file.startsWith("packages/shared/")) areas.shared = true;
    else if (file.startsWith("packages/duel-server/")) {
      areas.duel_unit = true;
      // Tests in web/shared and E2E helpers import duel source/fixtures directly;
      // the bot resolves duel card helpers at runtime.
      if (/^packages\/duel-server\/(src|tests)\//.test(file)) {
        for (const area of ["web", "shared", "bot", "e2e"]) areas[area] = true;
      }
      if (file === "packages/duel-server/card-block-list.json") areas.web = true;
    }
    else if (file.startsWith("site/")) areas.web = true;
    else if (file === "packages/e2e/stack/start.mjs") { areas.e2e = true; areas.duel_unit = true; }
    else if (/^packages\/(web|bot|ws|worker|e2e)\//.test(file)) areas[file.split("/")[1]] = true;
    else if (file === "scripts/ci/duel-test-files.mjs" || file === "scripts/ci/publish-engine-data.mjs") { areas.duel_unit = true; areas.ci_scripts = true; }
    else if (/^scripts\/(ci|deployment)\/|^\.github\/actions\/|^Dockerfile$|^\.dockerignore$/.test(file)) areas.ci_scripts = true;
    else if (file.startsWith("scripts/effects/")) { /* dedicated effect protocol job */ }
    else if (/^(Caddyfile$|docker-compose[^/]*\.ya?ml$|data\/duel-engine[^/]*\/|scripts\/native\/|\.github\/|\.gitignore$|\.impeccable\.)/.test(file)) { /* compose checked in changes; engine/native/production have their own jobs */ }
    else { consumers(); areas.ci_scripts = true; } // Unknown app/tooling paths fail open, without broadening engine inputs.
  }
  // Worker health integration starts the WS server from source.
  if (areas.ws) areas.worker = true;
  // E2E's bug-report helper imports web source (browser flows still stay local).
  if (files.some(file => !isDoc(file) && file.startsWith("packages/web/src/"))) areas.e2e = true;
  const relevant = files.filter(file => !isDoc(file));
  const data_only = relevant.length > 0 && relevant.every(file => /^packages\/shared\/data\/(effects|staples)\//.test(file));
  const effects = relevant.some(file => globalInput(file) || /^(scripts\/effects\/|scripts\/ci\/publish-effect-tags\.mjs$|packages\/shared\/(src\/(cards\/effects|duels)\/|data\/effects\/))/.test(file));
  // Main exercises these same composites in the real production build instead.
  const prod_build = relevant.some(file => globalInput(file) || /^(Dockerfile$|\.dockerignore$|\.github\/actions\/(prepare-production-bundle|build-production-image)\/|scripts\/deployment\/|packages\/shared\/(package\.json$|tsconfig[^/]*\.json$|src\/duels\/)|packages\/duel-server\/(domain-core\/(?!proposals\/)|legacy-1v1\/|card-script-patches\/|card-remap-overrides\.json$|scripts\/(?:prepare-data|released-card-data|prerelease[^/]*|card-script-patches|build-[^/]*core[^/]*|prepare-multi-core-tree|multi-core-common|install-engine-bundle|check-legacy-pin|package-deploy-multi-cores)\.|src\/(?:multi-scripts|released-database-files|cards|card-script-source|card-name-search|card-script-patches)\.ts$))/.test(file));
  return { ...areas, data_only, effects, prod_build, docs_only: files.length > 0 && files.every(isDoc), engine, engine_app, core, golden, tests_only };
}

// The changed files, or null when there is no usable diff (then every job runs).
function changedFiles(event, base, head) {
  if (!["pull_request", "push"].includes(event) || !base || !head || ZERO_SHA.test(base)) return null;
  try {
    if (event === "pull_request" && process.env.PR_NUMBER) {
      const pages = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp",
        `repos/${process.env.GITHUB_REPOSITORY}/pulls/${process.env.PR_NUMBER}/files?per_page=100`], { encoding: "utf8" }));
      const entries = pages.flat();
      // The API caps file lists at 3000. An incomplete list must never skip coverage.
      if (entries.length >= 3000) throw new Error("PR file list may be truncated");
      return entries.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
    }
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
  let serviceBarrelAppOnly = false;
  if (event === "pull_request" && files?.includes(serviceBarrel)) {
    try {
      let before;
      try {
        before = execFileSync("git", ["show", `${base}:${serviceBarrel}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        // PR detection uses a shallow checkout. Read just this base file rather
        // than fetching the full history or installing compiler dependencies.
        const response = JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/contents/${serviceBarrel}?ref=${base}`], { encoding: "utf8" }));
        before = Buffer.from(response.content, "base64").toString("utf8");
      }
      serviceBarrelAppOnly = remoteBarrelEdit(before, readFileSync(new URL("../../" + serviceBarrel, import.meta.url), "utf8"));
    } catch (error) {
      console.warn(`Cannot classify service barrel edit; retaining full engine coverage. ${error.message}`);
    }
  }
  const outputs = { ...changedLayers(files, event, { serviceBarrelAppOnly }), base: base ?? "", head: head ?? "" };
  console.log(outputs);
  for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
