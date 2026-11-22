import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const web = "packages/web/";
const shared = "packages/shared/";
const roots = ["first", "second", "third"].map(name => web + "tests/" + name + ".test.ts");
const files = {
  "tsconfig.json": '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}',
  [web + "tsconfig.json"]: '{"extends":"../../tsconfig.json","compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
  [shared + "tsconfig.json"]: '{"extends":"../../tsconfig.json"}',
  [shared + "package.json"]: JSON.stringify({
    name: "@demo/shared",
    exports: { "./helper": { types: "./dist/helper.d.ts", source: "./src/helper.ts", default: "./dist/helper.js" } },
  }),
  [roots[0]]: 'const route = () => import("@/route");',
  [roots[1]]: 'export { x } from "../src/independent.js";',
  [roots[2]]: 'const library = process.env.PLUGIN; const run = () => import(library);',
  [web + "src/route.ts"]: 'export { x } from "@demo/shared/helper";',
  [web + "src/independent.ts"]: 'export const x = 0;',
  [shared + "dist/helper.d.ts"]: 'export declare const x: number;',
  [shared + "src/helper.ts"]: 'export { x } from "./leaf.js";',
  [shared + "src/other.ts"]: "export const unused = 0;",
  [shared + "src/leaf.ts"]: 'export const x = 1;',
};

async function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(repo, ".ci-selector-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({ ...files, ...overrides })) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const { selectSuiteFiles } = await import("./select-pr-test-files.mjs");
  return (changes, existing = true) => selectSuiteFiles({
    root, suite: "web", tests: roots, changes, existing,
  });
}

test("follows tsconfig aliases, literal imports, workspace source exports and re-exports", async t => {
  const select = await fixture(t);
  const result = await select([shared + "src/leaf.ts"]);
  assert.deepEqual(result.files, ["tests/first.test.ts", "tests/third.test.ts"]);
  assert.equal(result.affected, true);
});

test("selects a changed test and keeps computed-import consumers", async t => {
  const select = await fixture(t);
  assert.deepEqual((await select([roots[1]])).files, ["tests/second.test.ts", "tests/third.test.ts"]);
});

test("a cross-package static hit can add an otherwise unselected group", async t => {
  const select = await fixture(t);
  assert.equal((await select([shared + "src/leaf.ts"], false)).affected, true);
  assert.equal((await select([shared + "src/other.ts"], false)).affected, false);
});

test("a missing literal import forces the entire selected group", async t => {
  const select = await fixture(t, { [roots[2]]: 'import("./missing.js");' });
  const result = await select([roots[1]]);
  assert.equal(result.files, null);
  assert.match(result.reason, /missing\.js/);
});

test("configuration, runtime data, and deleted paths force full coverage", async t => {
  const select = await fixture(t);
  for (const path of [
    "package-lock.json", web + "tsconfig.build.json", web + "tests/setup.ts",
    web + "tests/__mocks__/clock.ts", shared + "src/db/schema.ts",
    shared + "data/migrations/one.sql", web + "tests/fixtures/example.json",
    web + "src/deleted.ts",
  ]) {
    assert.equal((await select([path])).files, null, path);
  }
});
