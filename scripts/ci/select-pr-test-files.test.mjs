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

test("selected unit shards use file durations and cover the selection exactly", async () => {
  const { planUnitShards } = await import("./unit-test-plan.mjs");
  const files = ["a", "b", "c", "d", "new"];
  const timings = { a: 180, b: 180, c: 20, d: 10 };
  const shards = planUnitShards("duel_unit", files, timings);
  assert.equal(shards.length, 2);
  assert.deepEqual(shards.flatMap(shard => shard.files).sort(), files);
  assert.ok(shards.every(shard => shard.seconds <= 205));
  assert.equal(planUnitShards("duel_unit", ["a"], timings).length, 1);
});

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

test("a web route change keeps the runtime selection in web", async t => {
  const select = await fixture(t);
  const { changedLayers } = await import("./changed-layers.mjs");
  const layers = changedLayers([web + "src/route.ts"], "pull_request");
  assert.equal(layers.engine, false);
  assert.equal(layers.shared, false);
  assert.equal(layers.worker, false);
  assert.deepEqual((await select([web + "src/route.ts"])).files, ["tests/first.test.ts", "tests/third.test.ts"]);
});

test("a shared service reaches the importing consumer, stopping at a generic utility", async t => {
  const service = shared + "src/services/series.ts";
  const select = await fixture(t, {
    [service]: "export const series = 1;",
    [roots[0]]: 'import "../../shared/src/services/series.js";',
    [roots[1]]: 'import "../../shared/src/util/generic.js";',
    [roots[2]]: 'import "../src/independent.js";',
    [shared + "src/util/generic.ts"]: 'import "../services/series.js";',
  });
  assert.deepEqual((await select([service], false)).files, ["tests/first.test.ts"]);
});

test("type-only edits require no runtime suites, while deleting a value export still does", async () => {
  const { isTypeOnlyEdit } = await import("./select-pr-test-files.mjs");
  const { changedLayers } = await import("./changed-layers.mjs");
  const path = shared + "src/duels/contract.ts";
  const before = "export type Contract = string;\nexport const kind = 'duel';\n";
  const after = before.replace("string", "number");
  assert.equal(isTypeOnlyEdit(path, before, after), true);
  assert.equal(isTypeOnlyEdit(path, before, "export type Contract = number;\n"), false);
  const layers = changedLayers([path], "pull_request", { typeOnly: new Set([path]) });
  for (const flag of ["engine", "core", "duel_unit", "shared", "web", "effects"]) assert.equal(layers[flag], false, flag);
  assert.ok(layers.typecheck.includes("shared"));
  assert.ok(layers.typecheck.includes("duel-server"));
});

test("the observability adapter and CI wiring keep smoke coverage without engine jobs", async () => {
  const { changedLayers } = await import("./changed-layers.mjs");
  for (const changes of [[shared + "src/observability/console-adapter.ts"], [".github/workflows/test.yml"]]) {
    const layers = changedLayers(changes, "pull_request");
    assert.equal(layers.engine, false);
    assert.equal(layers.core, false);
    assert.ok(layers.smoke.web.length > 0 && layers.smoke.web.length < 5);
    assert.ok(layers.smoke.duel_unit.length > 0 && layers.smoke.duel_unit.length < 5);
  }
  const layers = changedLayers(["packages/duel-server/src/engine.ts"], "pull_request");
  assert.equal(layers.engine, true);
  assert.equal(layers.core, false);
  assert.ok(layers.engine_diff.includes("packages/duel-server/src/engine.ts"));
});

test("a named shared re-export selects its own tests and only the importing consumer files", async t => {
  const service = shared + "src/services/series.ts";
  const sharedTest = shared + "tests/services/series.test.ts";
  const other = shared + "src/services/other.ts";
  const root = mkdtempSync(join(repo, ".ci-area-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixtureFiles = {
    ...files,
    [web + "package.json"]: JSON.stringify({ name: "@demo/web", dependencies: { "@demo/shared": "*" }, scripts: { typecheck: "tsc" } }),
    [shared + "package.json"]: JSON.stringify({
      name: "@demo/shared", scripts: { typecheck: "tsc" },
      exports: { "./services": "./src/services/index.ts" },
    }),
    [shared + "src/services/index.ts"]: 'export * from "./series.js"; export * from "./other.js";',
    [service]: "export const series = 1;",
    [other]: "export const other = 2;",
    [sharedTest]: 'import { series } from "../../src/services/index.js";',
    [roots[0]]: 'import { series as current } from "@demo/shared/services";',
    [roots[1]]: 'import { other } from "@demo/shared/services";',
    [roots[2]]: 'import "../src/independent.js";',
  };
  for (const [path, content] of Object.entries(fixtureFiles)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const { selectPullRequest } = await import("./select-pr-test-files.mjs");
  const suiteTests = { web: roots, shared: [sharedTest] };
  const output = await selectPullRequest(root, [service], {
    readBase: () => "export const series = 0;",
    discover: (_root, suite, select) => select({ tests: suiteTests[suite] ?? [] }),
  });
  assert.deepEqual(JSON.parse(output.shared_files), ["tests/services/series.test.ts"]);
  assert.deepEqual(JSON.parse(output.web_files), ["tests/first.test.ts"]);
  assert.deepEqual(JSON.parse(output.typecheck), ["shared", "web"]);
  for (const flag of ["engine", "core", "bot", "ws", "worker", "duel_unit", "web_build"]) assert.equal(output[flag], false, flag);
});

test("adding a type specifier to a mixed re-export leaves its value export unchanged", async () => {
  const { isTypeOnlyEdit } = await import("./select-pr-test-files.mjs");
  const path = shared + "src/services/index.ts";
  assert.equal(isTypeOnlyEdit(path, 'export { current } from "./service.js";', 'export { current, type Contract } from "./service.js";'), true);
  assert.equal(isTypeOnlyEdit(path, 'export { current } from "./service.js";', 'export { replacement, type Contract } from "./service.js";'), false);
});

test("inserting a standalone export type before a value is typecheck-only", async () => {
  const { isTypeOnlyEdit } = await import("./select-pr-test-files.mjs");
  const path = shared + "src/services/index.ts";
  const without = "export const kind = 'duel';\n";
  const withType = "export type Contract = string;\n" + without;
  assert.equal(isTypeOnlyEdit(path, without, withType), true);
  assert.equal(isTypeOnlyEdit(path, withType, without), true);
});

test("a console adapter comment runs its own tests and the exact fixed runtime smokes", async t => {
  const root = mkdtempSync(join(repo, ".ci-hub-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hub = shared + "src/observability/console-adapter.ts";
  const dedicated = shared + "tests/observability/adapter.test.ts";
  const unrelated = shared + "tests/services/unrelated.test.ts";
  const source = "export const adapter = console;";
  for (const [file, text] of Object.entries({
    [hub]: source + " // Adapter used by the app.",
    [dedicated]: 'import "../../src/observability/console-adapter.js";',
    [unrelated]: "export {};",
    [shared + "package.json"]: JSON.stringify({ name: "@demo/shared", scripts: { typecheck: "tsc" } }),
    [web + "package.json"]: JSON.stringify({ name: "@demo/web", scripts: { typecheck: "tsc" } }),
  })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  const { selectPullRequest } = await import("./select-pr-test-files.mjs");
  const output = await selectPullRequest(root, [hub], {
    readBase: () => source,
    discover: (_root, suite, select) => {
      assert.equal(suite, "shared");
      return select({ tests: [dedicated, unrelated] });
    },
  });
  assert.equal(output.engine, false);
  assert.equal(output.core, false);
  assert.equal(output.web_build, false);
  assert.deepEqual(JSON.parse(output.typecheck), ["shared", "web"]);
  assert.deepEqual(JSON.parse(output.web_files), ["tests/observability-migration.test.ts"]);
  assert.deepEqual(JSON.parse(output.duel_unit_files), ["tests/decision-clock-credit.test.ts", "tests/sort-response.test.ts"]);
  assert.deepEqual(JSON.parse(output.shared_files),
    ["tests/db/schema.test.ts", "tests/observability/adapter.test.ts", "tests/services/drafts.test.ts"]);
});
