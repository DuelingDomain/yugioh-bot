import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { engineMatrix } from "./engine-test-plan.mjs";
import { planUnitShards } from "./unit-test-plan.mjs";
import {
  additionalOwners, areaFor, areas, areaSmokes, ciWiring, coreInput, dataConsumers, effectTypeInput,
  engineGraphInput, globalInput, goldenInput, isDeclaration, isDoc, isHub, productionInput,
  sourceDependents, sourceFile, testFile, workspaces,
} from "./test-areas.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const suites = [...Object.keys(workspaces), "ci_scripts"];
const packagePath = file => /^packages\/([^/]+)\//.exec(file)?.[1];
const testPath = file => /^packages\/[^/]+\/(?:tests|e2e)\//.test(file) || testFile.test(file);
const duelTestPath = file => file.startsWith("packages/duel-server/tests/") && testFile.test(file);
const allLayers = () => ({
  ...Object.fromEntries(suites.map(suite => [suite, true])),
  web_build: true, e2e: true, effects: true, effect_types: true, prod_build: true, engine: true, core: true,
  golden: true, docs_only: false, tests_only: false, checks_only: false, full: true,
  routes: {}, smoke: {}, typecheck: [], engine_diff: [],
});

function touchedTypechecks(files, { all, root }) {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
    .map(({ name }) => [name, JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"))]);
  const touched = new Set(files.map(packagePath));
  if (files.some(file => areaFor(file) === "vision")) touched.add("vision");
  if (files.some(file => areaFor(file) === "web")) touched.add("web");
  const names = packages.filter(([dir]) => touched.has(dir)).map(([, pkg]) => pkg.name);
  const explicit = new Set([...touched].flatMap(dir => sourceDependents[dir] ?? []));
  return packages.filter(([dir, pkg]) => pkg.scripts?.typecheck && (all || touched.has(dir) || explicit.has(dir) ||
    names.some(name => name in { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })))
    .map(([dir]) => dir).sort();
}

export function changedLayers(files, event, options = {}) {
  // Main is the full release gate. Partial PR results can never satisfy it.
  if (event !== "pull_request" || !files?.length || files.some(globalInput)) return allLayers();
  const { typeOnly = new Set(), duelEngineTests, webEngineTests = new Set(), root: workspaceRoot = root } = options;
  const relevant = files.filter(file => !isDoc(file));
  const runtime = relevant.filter(file => !isDeclaration(file) && !typeOnly.has(file));
  const hubs = runtime.filter(isHub);
  const direct = runtime.filter(file => !isHub(file));
  const routes = Object.fromEntries(Object.keys(workspaces).map(suite => [suite, { owned: [], consumers: [], hubs: [] }]));
  const engine = [];
  let ci_scripts = false;
  let effects = false;
  let web_build = false;
  let smoke = {};
  for (const file of direct) {
    const owners = [areaFor(file, duelEngineTests), ...(additionalOwners[file] ?? [])];
    if (webEngineTests.has(file)) owners.push("engine");
    if (dataConsumers.paths.test(file)) {
      if (file.startsWith("packages/shared/data/staples/")) continue;
    } else if (owners.includes("effects") && file.startsWith("packages/shared/")) {
      owners.push("shared_services");
    }
    if (duelTestPath(file) && !existsSync(join(workspaceRoot, file)) && !owners.includes("engine")) owners.push("engine");
    for (const owner of new Set(owners)) {
      if (!owner || owner === "ci" || owner === "deploy") {
        ci_scripts = true;
        continue;
      }
      if (owner === "engine") engine.push(file);
      if (owner === "effects") effects = true;
      if (owner === "web" && !testPath(file)) web_build = true;
      if (owner !== "engine" || !webEngineTests.has(file)) {
        for (const suite of areas[owner].suites) routes[suite].owned.push(file);
      }
      if (areas[owner].consumerPaths?.test(file)) {
        for (const suite of areas[owner].consumers) routes[suite].consumers.push(file);
      }
    }
  }
  for (const file of hubs) {
    const owner = areaFor(file);
    for (const suite of areas[owner]?.suites ?? []) routes[suite].hubs.push(file);
  }
  const wiring = direct.some(file => ciWiring.test(file));
  if (hubs.length || wiring || direct.some(file => !areaFor(file))) smoke = areaSmokes();
  else if (direct.some(file => areaFor(file) === "shared_db" && !testPath(file))) smoke = areaSmokes(["web", "ws", "worker", "bot", "duel_host"]);
  if (direct.some(file => dataConsumers.paths.test(file))) {
    for (const [suite, files] of Object.entries(dataConsumers.files)) smoke[suite] = [...(smoke[suite] ?? []), ...files];
  }
  if (wiring) ci_scripts = true;

  const checkAllTypes = hubs.length > 0 || wiring || relevant.some(file => isDeclaration(file) && !packagePath(file));
  const typecheck = relevant.length ? touchedTypechecks(relevant, { all: checkAllTypes, root: workspaceRoot }) : [];
  const uniqueEngine = [...new Set(engine)];
  return {
    ...Object.fromEntries(Object.entries(routes).map(([suite, route]) => [suite, route.owned.length > 0 || !!smoke[suite]])),
    web_build, e2e: typecheck.includes("e2e"), ci_scripts, effects,
    effect_types: relevant.some(file => effectTypeInput.test(file)) || !!smoke.effects,
    prod_build: direct.some(file => productionInput.test(file)),
    engine: uniqueEngine.length > 0,
    core: uniqueEngine.some(coreInput), golden: uniqueEngine.some(file => goldenInput.test(file)),
    docs_only: relevant.length === 0,
    tests_only: runtime.length > 0 && runtime.every(testPath),
    checks_only: relevant.length > 0 && direct.every(file => ciWiring.test(file) || file === "docs/engine/core-pins.md"),
    full: false, routes, smoke, typecheck,
    engine_diff: uniqueEngine.length > 0 && !uniqueEngine.some(coreInput) && uniqueEngine.every(engineGraphInput) ? uniqueEngine : [],
  };
}

export function selectionOutputs(layers, results = {}) {
  const { routes, smoke, typecheck, engine_diff, ...flags } = layers;
  const output = {
    ...flags, typecheck: typecheck.length ? JSON.stringify(typecheck) : "",
    engine_diff: engine_diff.length ? JSON.stringify(engine_diff) : "",
    effect_smoke: !flags.effects && smoke.effects ? JSON.stringify(smoke.effects) : "",
    engine_matrix: JSON.stringify(engineMatrix(false)),
  };
  for (const suite of Object.keys(workspaces)) {
    const result = results[suite];
    if (!result && !smoke[suite]) continue;
    const files = result?.files === null ? null : [...new Set([...(result?.files ?? []), ...(smoke[suite] ?? [])])].sort();
    output[suite] = files === null ? result.affected : files.length > 0;
    if (!files?.length) continue;
    output[suite + "_files"] = JSON.stringify(files);
    if (suite === "web") output.web_shards = JSON.stringify(files.slice(0, 5).map((_, i) => i + 1));
    if (suite === "shared" || suite === "duel_unit") {
      const plan = planUnitShards(suite, files);
      output[suite + "_shards"] = JSON.stringify(plan.map((_, i) => `${i + 1}/${plan.length}`));
    }
  }
  return output;
}

const readCommand = (command, args) => execFileSync(command, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

// The changed files, or null when there is no usable PR diff.
function changedFiles(base, head) {
  if (!base || !head || /^0+$/.test(base)) return null;
  try {
    if (process.env.PR_NUMBER) {
      const pages = JSON.parse(readCommand("gh", ["api", "--paginate", "--slurp",
        `repos/${process.env.GITHUB_REPOSITORY}/pulls/${process.env.PR_NUMBER}/files?per_page=100`]));
      const entries = pages.flat();
      if (entries.length >= 3000) throw new Error("PR file list may be truncated");
      return entries.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
    }
    return readCommand("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`]).split("\0").filter(Boolean);
  } catch (error) {
    console.warn(`No usable PR diff for ${base}..${head}; every group runs. ${error.message}`);
    return null;
  }
}

export function writeOutputs(outputs) {
  console.log(outputs);
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.EVENT;
  const files = event === "pull_request" ? changedFiles(process.env.BASE, process.env.HEAD) : null;
  console.log(files === null ? "(full run)" : files.join("\n"));
  const layers = changedLayers(files, event);
  const output = selectionOutputs(layers);
  // Keep the complete diff in this job's checkout, including large PRs.
  if (!layers.full && files.some(file => !isDoc(file) && !isDeclaration(file) && !ciWiring.test(file) &&
    (sourceFile.test(file) || Object.values(layers.routes).some(route => route.owned.includes(file))))) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(process.env.RUNNER_TEMP ?? process.cwd(), "pr-test-diff.json"), JSON.stringify(files));
    output.scan = true;
  }
  writeOutputs(output);
}
