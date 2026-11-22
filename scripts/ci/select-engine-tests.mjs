import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";
import { DIFFERENTIAL_FILES } from "./engine-test-plan.mjs";
import { isHub, sourceFile, webEngineTest } from "./test-areas.mjs";

const prefix = "packages/duel-server/tests/";
const webPrefix = "packages/web/tests/";
const isTest = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.startsWith(prefix + "support/fixtures/");

/** Static imports, re-exports, literal dynamic imports, fixture paths and directory readers.
 * Never import test modules: some open the database while they are collected.
 * Keep missing dependency paths too, so deleting a helper still runs its callers.
 */
export function selectTests(sources, changed, sharedExports = {}) {
  const known = new Set([...Object.keys(sources), ...changed]);
  const graph = new Map();
  for (const [file, text] of Object.entries(sources)) {
    if (isHub(file)) continue;
    const deps = new Set();
    const directories = new Set();
    // loadScenarios walks join(packageRoot, "tests", "scenarios"). Static imports
    // cannot describe that registry; its callers depend on new/deleted scenarios too.
    if (file === "packages/duel-server/scripts/rule-coverage.ts") directories.add(prefix + "scenarios/");
    const add = (reference) => {
      const path = reference.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(file), reference))
        : reference.startsWith("tests/") ? posix.join(file.split("/tests/")[0], reference)
        : reference.startsWith("@/") && file.startsWith("packages/web/") ? "packages/web/src/" + reference.slice(2)
        : sharedTarget(reference, sharedExports);
      if (!path || path.startsWith("../")) return;
      const candidates = /\.[cm]?jsx?$/.test(path)
        ? [path.replace(/\.[cm]?jsx?$/, ".ts"), path.replace(/\.[cm]?jsx?$/, ".tsx"), path]
        : [path, path + ".ts", path + ".tsx", path + ".js", path + "/index.ts"];
      for (const candidate of candidates) if (known.has(candidate) && !isHub(candidate)) deps.add(candidate);
      // Also records new files in a directory loaded with readdir/new URL (scenario registry).
      if (reference.endsWith("/") || !posix.extname(path)) directories.add(path.replace(/\/$/, "") + "/");
    };
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) add(imported.fileName);
    const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) {
        add(node.text);
        // join(dir, "fixture.lua") is a file read, not a module import. Match its readers too.
        if (posix.extname(node.text)) {
          for (const path of changed) {
            if (!sourceFile.test(path) && posix.basename(path) === posix.basename(node.text)) deps.add(path);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
    // A child Vitest config owns its folder's fixture inputs, including new/deleted files.
    if (/\/vitest\.config\.[cm]?[jt]s$/.test(file)) directories.add(posix.dirname(file) + "/");
    if (isTest(file) && file.startsWith(prefix)) deps.add(prefix + "support/setup.ts");
    graph.set(file, { deps, directories });
  }
  const affected = new Set(changed.filter(file => !isHub(file)));
  for (const file of changed) {
    if (file.endsWith(".snap") && posix.basename(posix.dirname(file)) === "__snapshots__") {
      affected.add(posix.join(posix.dirname(posix.dirname(file)), posix.basename(file).slice(0, -5)));
    }
  }
  let added;
  do {
    added = false;
    for (const [file, { deps, directories }] of graph) {
      if (affected.has(file)) continue;
      if ([...deps].some((dep) => affected.has(dep)) || [...directories].some((dir) => [...affected].some((dep) => dep.startsWith(dir)))) {
        affected.add(file);
        added = true;
      }
    }
  } while (added);
  return Object.keys(sources).filter((file) => (file.startsWith(prefix) || file.startsWith(webPrefix)) && isTest(file) && affected.has(file)).sort();
}

function sharedTarget(reference, exports) {
  const name = "@yugidraft/shared";
  if (reference !== name && !reference.startsWith(name + "/")) return "";
  const subpath = "." + reference.slice(name.length);
  const entry = exports[subpath];
  const target = typeof entry === "string" ? entry : entry?.source ?? entry?.default;
  return target ? "packages/shared/" + target.replace(/^\.\//, "").replace(/^dist\//, "src/") : "";
}

export function selectEngineFiles(root, changed, engineInventory) {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "packages/", "scripts/"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\0").filter(file => sourceFile.test(file) && existsSync(posix.join(root, file)));
  const sources = Object.fromEntries(tracked.map(file => [file, readFileSync(posix.join(root, file), "utf8")]));
  const { exports } = JSON.parse(readFileSync(posix.join(root, "packages/shared/package.json"), "utf8"));
  const selected = selectTests(sources, changed, exports);
  const files = selected.filter(file => file.startsWith(prefix))
    .map(file => file.slice("packages/duel-server/".length))
    .filter(file => engineInventory.includes(file) && !DIFFERENTIAL_FILES.includes(file));
  const webFiles = selected.filter(file => webEngineTest(file, sources[file])).map(file => file.slice("packages/web/".length));
  return { files, webFiles };
}
