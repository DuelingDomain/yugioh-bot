import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";

import { NEEDS_ENGINE } from "./engine-test-plan.mjs";
export { NEEDS_ENGINE } from "./engine-test-plan.mjs";

const packageRoot = new URL("../../packages/duel-server/", import.meta.url);
const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Partition files without importing test modules (which can open databases/workers).
 * Follow actual module imports, including shared test helpers and suite registrations.
 * Mixed files move as a whole to the engine lane, retaining their non-engine cases.
 */
export function duelTestFiles() {
  const sources = new Map();
  for (const dir of ["tests", "src", "scripts"]) {
    for (const file of readdirSync(new URL(dir + "/", packageRoot), { recursive: true })) {
      const path = dir + "/" + file;
      if (/\.[cm]?[jt]sx?$/.test(path)) sources.set(path, readFileSync(new URL(path, packageRoot), "utf8"));
    }
  }
  const imports = new Map([...sources].map(([file, source]) => [file,
    ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName }) => {
      if (!fileName.startsWith(".")) return [];
      const path = posix.normalize(posix.join(posix.dirname(file), fileName));
      const stem = path.replace(/\.[cm]?jsx?$/, "");
      return [path, stem + ".ts", stem + ".tsx", path + "/index.ts"].filter(candidate => sources.has(candidate));
    }),
  ]));
  const needsCores = new Set(["tests/support/cores.ts"]);
  let added;
  do {
    added = false;
    for (const [file, dependencies] of imports) {
      if (!needsCores.has(file) && dependencies.some(path => needsCores.has(path))) {
        needsCores.add(file);
        added = true;
      }
    }
  } while (added);
  const all = [...sources.keys()].filter(file => file.startsWith("tests/") && testFile.test(file)).sort();
  const requiresEngine = file => needsCores.has(file) || NEEDS_ENGINE.some(pattern =>
    pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : file === pattern);
  return { all, unit: all.filter(file => !requiresEngine(file)), engine: all.filter(requiresEngine) };
}
