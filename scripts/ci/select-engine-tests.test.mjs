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

test("a deleted helper still selects tests with broken imports; a deleted test is not emitted", () => {
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

test("helper callers remain selected through production source and script modules", () => {
  const sources = {
    [prefix + "fuzz-n/known-issues.ts"]: "",
    ["packages/duel-server/scripts/lib/issue-registry.ts"]: 'import { issues } from "../../tests/fuzz-n/known-issues.js";',
    [prefix + "triage-nseat.test.ts"]: 'import { issues } from "../scripts/lib/issue-registry.js";',
    [prefix + "fuzz/rng.ts"]: "",
    ["packages/duel-server/scripts/lib/replay-source.ts"]: 'import { rng } from "../../tests/fuzz/rng.js";',
    [prefix + "triage.test.ts"]: 'import { replay } from "../scripts/lib/replay-source.js";',
    ["packages/shared/tests/unrelated.test.ts"]: "",
  };
  assert.deepEqual(selected([prefix + "fuzz-n/known-issues.ts"], sources), ["triage-nseat.test.ts"]);
  assert.deepEqual(selected([prefix + "fuzz/rng.ts"], sources), ["triage.test.ts"]);
});

test("scenario discovery selects catalog checks for edited, new and deleted modules", () => {
  const sources = {
    ["packages/duel-server/scripts/rule-coverage.ts"]: 'walk(join(root, "tests", "scenarios"));',
    [prefix + "scenarios/multiplayer/catalog.test.ts"]: 'import { loadScenarios } from "../../../scripts/rule-coverage.js";',
    [prefix + "scenarios/multiplayer/seats.ts"]: "",
  };
  for (const name of ["seats.ts", "new.ts", "deleted.ts"]) {
    assert.deepEqual(selected([prefix + "scenarios/multiplayer/" + name], sources), ["scenarios/multiplayer/catalog.test.ts"]);
  }
});

test("only PRs confined to tests get a narrow selection; source/patch/script changes stay full", () => {
  assert.deepEqual(changedLayers([prefix + "one.test.ts"], "pull_request"), { engine: true, golden: false, tests_only: true });
  for (const file of ["packages/duel-server/src/engine.ts", "packages/duel-server/domain-core/patches/0001.patch", "scripts/ci/run-engine-tests.mjs", "package-lock.json", ".github/workflows/test.yml"]) {
    assert.equal(changedLayers([prefix + "one.test.ts", file], "pull_request").tests_only, false);
  }
  for (const event of ["schedule", "workflow_dispatch"]) assert.deepEqual(changedLayers([], event), { engine: true, golden: true, tests_only: false });
  for (const event of ["pull_request", "push"]) assert.deepEqual(changedLayers(null, event), { engine: true, golden: true, tests_only: false });
  assert.deepEqual(changedLayers([prefix + "one.test.ts"], "push"), { engine: true, golden: false, tests_only: false });
  for (const event of ["pull_request", "push"]) {
    assert.deepEqual(changedLayers(["docs/readme.md"], event), { engine: false, golden: false, tests_only: false });
    assert.deepEqual(changedLayers(["packages/web/tests/duel.test.ts"], event), { engine: false, golden: false, tests_only: false });
    for (const file of ["packages/e2e/src/run.ts", "patches/ocgcore-wasm+0.1.2.patch", "package-lock.json", "docs/adr/0002-multiplayer-duel-rules.md"]) {
      assert.equal(changedLayers(["packages/web/src/app/page.tsx", file], event).engine, true, file);
    }
  }
  assert.equal(changedLayers([], "pull_request").tests_only, false);
});

test("PR selection retains main's reviewed non-engine paths; web-only changes skip the engine", () => {
  for (const file of ["packages/shared/tests/draft.test.ts", "packages/shared/src/services/cubes.ts", "scripts/seed.ts"]) {
    assert.deepEqual(changedLayers([file], "pull_request"), { engine: false, golden: false, tests_only: false });
  }
  for (const file of ["packages/web/src/components/ui/button.tsx", "packages/web/src/lib/utils.ts", "packages/web/e2e/duel.ts", "packages/web/src/components/duel/table.tsx"]) {
    assert.deepEqual(changedLayers([file], "pull_request"), { engine: false, golden: false, tests_only: false });
  }
  assert.equal(changedLayers(["packages/shared/src/services/duels.ts"], "pull_request").engine, true);
  assert.equal(changedLayers(["packages/shared/src/services/unknown.ts"], "pull_request").engine, true);
  assert.equal(changedLayers(["packages/shared/src/services/cubes.ts"], "push").engine, false);
  assert.equal(changedLayers(["packages/shared/src/services/duels.ts"], "push").engine, true);
});


test("golden runs only for native driver, core, overlay and data inputs", () => {
  const pkg = "packages/duel-server/";
  const inputs = [
    "domain-core/patches/0001.patch", "domain-core/multi-scripts/nested/c1.lua",
    "domain-core/pins.json", "scripts/native/nduel.cpp", "scripts/native/golden.tsv",
    "scripts/run-nduel.sh", "scripts/build-native-core.sh", "scripts/prepare-multi-core-tree.sh",
    "scripts/multi-core-common.sh", "scripts/prepare-data.ts",
  ].map((path) => pkg + path);
  const unrelated = [
    "packages/shared/src/services/duels.ts", "packages/e2e/src/run.ts",
    pkg + "src/host.ts", pkg + "tests/engine.test.ts", pkg + "scripts/update-engine-data.ts",
    pkg + "scripts/prepare-data.ts.bak", pkg + "domain-core/pins.json.bak",
    "scripts/ci/changed-layers.mjs", ".github/workflows/test.yml", "package-lock.json",
  ];
  for (const event of ["pull_request", "push"]) {
    for (const path of inputs) assert.equal(changedLayers([path], event).golden, true, path);
    for (const path of unrelated) assert.equal(changedLayers([path], event).golden, false, path);
    assert.equal(changedLayers([], event).golden, false);
    assert.equal(changedLayers([...unrelated, inputs[0]], event).golden, true);
  }
  assert.equal(changedLayers(unrelated, "workflow_dispatch").golden, true);
});
