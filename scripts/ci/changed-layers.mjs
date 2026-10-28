import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

const ZERO_SHA = /^0+$/;

const isDoc = (file) => /\.md$/i.test(file) || /^(docs|site)\//.test(file);

/** Follow literal module references, including re-exports, type and dynamic imports.
 * Scanning all path literals is deliberately conservative (also catches file readers).
 * Keep unresolved candidate paths so deletion/renaming still selects their callers.
 * Barrels include all exports: changes to their side effects can affect the host.
 */
export function engineSharedFiles(sources, exports) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, reference] of (sources[file] ?? "").matchAll(/["'`]((?:\.\.?\/|@yugidraft\/shared\/)[^"'`\s]+)["'`]/g)) {
      let path;
      if (reference.startsWith("@yugidraft/shared/")) {
        const subpath = "./" + reference.slice("@yugidraft/shared/".length);
        const entry = exports[subpath];
        const target = typeof entry === "string" ? entry : entry?.source ?? entry?.default;
        path = target ? "packages/shared/" + target.replace(/^\.\//, "").replace(/^dist\//, "src/")
          : "packages/shared/src/" + subpath.slice(2);
      } else path = posix.normalize(posix.join(posix.dirname(file), reference));
      if (!/^(packages\/shared\/src|packages\/duel-server\/src)\//.test(path)) continue;
      const stem = path.replace(/\.[cm]?jsx?$/, "");
      for (const candidate of [path, stem + ".ts", stem + ".tsx", stem + "/index.ts"]) visit(candidate);
    }
  };
  for (const file of Object.keys(sources)) if (file.startsWith("packages/duel-server/src/")) visit(file);
  return seen;
}

let sharedDependencies;
function sharedEngineInput(file) {
  if (file.startsWith("packages/shared/src/duels/")) return true;
  if (!file.startsWith("packages/shared/src/")) return false;
  if (!sharedDependencies) {
    const root = new URL("../../", import.meta.url);
    const sources = {};
    const collect = (dir) => {
      for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
        const path = dir + entry.name;
        if (entry.isDirectory()) collect(path + "/");
        else if (/\.[cm]?[jt]sx?$/.test(path)) sources[path] = readFileSync(new URL(path, root), "utf8");
      }
    };
    collect("packages/duel-server/src/");
    collect("packages/shared/src/");
    sharedDependencies = engineSharedFiles(sources, JSON.parse(readFileSync(new URL("packages/shared/package.json", root), "utf8")).exports);
  }
  return sharedDependencies.has(file);
}

// PRs and main pushes use the same engine rule. Scheduled/manual runs and
// missing diffs enable every layer; docs never select tests on their own.
export function changedLayers(files, event) {
  if (!["pull_request", "push"].includes(event) || files === null) return { engine: true, golden: true, tests_only: false };
  const engine = files.some((file) => !isDoc(file) && (
    sharedEngineInput(file) ||
    /^(packages\/duel-server\/(?!domain-core\/proposals\/)|packages\/shared\/(package\.json$|tsconfig[^/]*\.json$)|data\/duel-engine[^/]*\/|patches\/|scripts\/(native\/|ci\/(?:build-core|parallel-emxx|bin\/em\+\+|core-cache-key|assemble-core-bundle|run-engine-tests|select-engine-tests|engine-sequencer|changed-layers|publish-engine-data))|\.github\/actions\/(restore-engine-bundle|prepare-production-bundle|setup-ci-node)\/|\.github\/workflows\/test\.yml$|package(-lock)?\.json$|turbo\.json$|tsconfig[^/]*\.json$|\.nvmrc$)/.test(file)
  ));
  // Golden rows depend only on the core, overlay, data pins and native tooling (and the step's own wiring).
  const golden = files.some((file) => /^(\.github\/workflows\/test\.yml$|scripts\/ci\/changed-layers\.mjs$)|^packages\/duel-server\/(card-script-patches\/|domain-core\/(patches\/|multi-scripts\/|pins\.json$)|scripts\/(native\/|(?:run-nduel|build-native-core|prepare-multi-core-tree|multi-core-common)\.sh$|(?:prepare-data|released-card-data|card-script-patches)\.ts$))/.test(file));
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
