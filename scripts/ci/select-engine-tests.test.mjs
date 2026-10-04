import assert from "node:assert/strict";
import { test } from "node:test";
import { changedLayers } from "./changed-layers.mjs";
import { selectTests } from "./select-engine-tests.mjs";

const prefix = "packages/duel-server/tests/";
const files = {
  [prefix + "one.test.ts"]: 'import { value } from "./support/outer.js";',
  [prefix + "two.test.ts"]: 'import { value } from "./support/inner.js";',
  [prefix + "other.test.ts"]: 'import { value } from "../src/engine.js";',
  [prefix + "support/outer.ts"]: 'export { value } from "./inner.js";',
  [prefix + "support/inner.ts"]: 'export const value = 1;',
  [prefix + "support/setup.ts"]: "",
  [prefix + "scenarios/battle.test.ts"]: 'import { scenarios } from "./cases/battle.js";',
  [prefix + "scenarios/cases/battle.ts"]: "export const scenarios = [];",
  [prefix + "scenarios/registry.test.ts"]: 'import { loadAllScenarios } from "../support/registry.js";',
  [prefix + "support/registry.ts"]: 'const directory = new URL("../scenarios/cases/", import.meta.url);',
  [prefix + "fixture.test.ts"]: 'const file = new URL("./fixtures/board.lua", import.meta.url); const text = "board.txt";',
  [prefix + "support/fixtures/internal.fixture.test.ts"]: "",
};
const selected = (paths, sources = files) => selectTests(sources, paths).map((file) => file.slice(prefix.length));

test("a test edit runs that file; a helper edit includes transitive dependents", () => {
  assert.deepEqual(selected([prefix + "one.test.ts"]), ["one.test.ts"]);
  assert.deepEqual(selected([prefix + "support/inner.ts"]), ["one.test.ts", "two.test.ts"]);
});

test("scenario edits include the shim and the dynamic registry; a new family includes the registry", () => {
  assert.deepEqual(selected([prefix + "scenarios/cases/battle.ts"]), ["scenarios/battle.test.ts", "scenarios/registry.test.ts"]);
  assert.deepEqual(selected([prefix + "scenarios/cases/new.ts"]), ["scenarios/registry.test.ts"]);
});

test("a deleted helper still selects tests with broken imports; a deleted test never becomes a full run", () => {
  const sources = { ...files };
  delete sources[prefix + "support/inner.ts"];
  assert.deepEqual(selected([prefix + "support/inner.ts"], sources), ["one.test.ts", "two.test.ts"]);
  assert.deepEqual(selected([prefix + "deleted.test.ts"]), []);
});

test("fixture edits select file readers; support fixture child tests remain excluded", () => {
  assert.deepEqual(selected([prefix + "fixtures/board.lua"]), ["fixture.test.ts"]);
  assert.deepEqual(selected([prefix + "fixtures/board.txt"]), ["fixture.test.ts"]);
  assert.deepEqual(selected([prefix + "support/fixtures/internal.fixture.test.ts"]), []);
});

test("snapshot edits select the owning test file", () => {
  assert.deepEqual(selected([prefix + "__snapshots__/one.test.ts.snap"]), ["one.test.ts"]);
});

test("setup changes select all tests, as setup runs before every file", () => {
  assert.equal(selected([prefix + "support/setup.ts"]).length, 6);
});

test("child Vitest fixture edits select the parent runner", () => {
  const sources = {
    [prefix + "support/cores.test.ts"]: 'const config = "tests/support/fixtures/vitest.config.ts";',
    [prefix + "support/fixtures/vitest.config.ts"]: 'export default { test: { include: ["*.fixture.test.ts"] } };',
    [prefix + "support/fixtures/missing-core.fixture.test.ts"]: "",
  };
  assert.deepEqual(selected([prefix + "support/fixtures/missing-core.fixture.test.ts"], sources), ["support/cores.test.ts"]);
  assert.deepEqual(selected([prefix + "support/fixtures/new.fixture.test.ts"], sources), ["support/cores.test.ts"]);
});

test("duel helpers also select web test dependents across packages", () => {
  const sources = {
    [prefix + "material-count-fixture.ts"]: "",
    ["packages/web/tests/components/material-count.test.ts"]: 'import { value } from "../../../duel-server/tests/material-count-fixture.js";',
    ["packages/web/tests/components/other.test.ts"]: "",
  };
  assert.deepEqual(selectTests(sources, [prefix + "material-count-fixture.ts"]), ["packages/web/tests/components/material-count.test.ts"]);
});

test("only PRs confined to tests get a narrow selection; source/patch/script changes stay full", () => {
  assert.deepEqual(changedLayers([prefix + "one.test.ts"], "pull_request"), { engine: true, web_engine: true, tests_only: true });
  for (const file of ["packages/duel-server/src/engine.ts", "packages/duel-server/domain-core/patches/0001.patch", "scripts/ci/run-engine-tests.mjs", "package-lock.json", ".github/workflows/test.yml"]) {
    assert.equal(changedLayers([prefix + "one.test.ts", file], "pull_request").tests_only, false);
  }
  for (const event of ["push", "schedule", "workflow_dispatch"]) assert.deepEqual(changedLayers([], event), { engine: true, web_engine: true, tests_only: false });
  assert.deepEqual(changedLayers(["docs/readme.md"], "pull_request"), { engine: false, web_engine: false, tests_only: false });
  assert.deepEqual(changedLayers(["packages/web/tests/duel.test.ts"], "pull_request"), { engine: false, web_engine: true, tests_only: false });
  assert.equal(changedLayers([], "pull_request").tests_only, false);
});
