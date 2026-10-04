import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const prefix = "packages/duel-server/tests/";
const webPrefix = "packages/web/tests/";
const isTest = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.startsWith(prefix + "support/fixtures/");

/** Static imports, re-exports, literal dynamic imports, fixture paths and directory readers.
 * Never import test modules: some open the database while they are collected.
 * Keep missing dependency paths too, so deleting a helper still runs its callers.
 */
export function selectTests(sources, changed) {
  const known = new Set([...Object.keys(sources), ...changed]);
  const graph = new Map();
  for (const [file, text] of Object.entries(sources)) {
    const deps = new Set();
    const directories = new Set();
    // loadScenarios walks join(packageRoot, "tests", "scenarios"). Static imports
    // cannot describe that registry; its callers depend on new/deleted scenarios too.
    if (file === "packages/duel-server/scripts/rule-coverage.ts") directories.add(prefix + "scenarios/");
    const add = (reference) => {
      const path = reference.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(file), reference))
        : reference.startsWith("tests/") ? posix.join(file.split("/tests/")[0], reference) : "";
      if (!path || path.startsWith("../")) return;
      const candidates = /\.[cm]?jsx?$/.test(path)
        ? [path.replace(/\.[cm]?jsx?$/, ".ts"), path.replace(/\.[cm]?jsx?$/, ".tsx"), path]
        : [path, path + ".ts", path + ".tsx", path + ".js", path + "/index.ts"];
      for (const candidate of candidates) if (known.has(candidate)) deps.add(candidate);
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
          for (const path of changed) if (posix.basename(path) === posix.basename(node.text)) deps.add(path);
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
  const affected = new Set(changed);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", `${process.env.BASE}...${process.env.HEAD}`], { encoding: "utf8" }).split("\0").filter(Boolean);
  if (!changed.every((file) => file.startsWith(prefix))) throw new Error("Narrow test selection requires a tests-only PR");
  // A helper can reach a test through src/ or scripts/ (for example the issue registry).
  // Keep those graph nodes, but emit only duel-server and web test files.
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "packages/", "scripts/"], { encoding: "utf8" }).split("\0").filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  const sources = Object.fromEntries(tracked.map((file) => [file, readFileSync(file, "utf8")]));
  const selected = selectTests(sources, changed);
  const files = selected.filter((file) => file.startsWith(prefix)).map((file) => file.slice("packages/duel-server/".length));
  const webFiles = selected.filter((file) => file.startsWith(webPrefix)).map((file) => file.slice("packages/web/".length));
  console.log(JSON.stringify({ files, webFiles }, null, 2));
  appendFileSync(process.env.GITHUB_OUTPUT, `files=${JSON.stringify(files)}\nweb_files=${JSON.stringify(webFiles)}\n`);
}
