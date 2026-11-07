import assert from "node:assert/strict";
import { test } from "node:test";
import { engineSources } from "./changed-layers.mjs";
import { selectApplicationTests } from "./select-engine-tests.mjs";

test("focused selection retains host lifecycle and recording gates and only dependent web engine tests", () => {
  const sources = {
    "packages/web/tests/dependent.test.ts": 'import "../../../duel-server/tests/support/cores.js"; import "@/lib/helper";',
    "packages/web/src/lib/helper.ts": 'import { service } from "@yugidraft/shared/services";',
    "packages/web/tests/unrelated.test.ts": 'import "../../../duel-server/tests/support/cores.js"; import "@yugidraft/shared/duels";',
    "packages/web/tests/unit.test.ts": 'import { service } from "@yugidraft/shared/services";',
    "packages/shared/src/services/index.ts": 'export { service } from "./matches.js";',
    "packages/shared/src/services/matches.ts": 'export const service = true;',
  };
  const exports = { "./services": "./dist/services/index.js", "./duels": "./dist/duels/index.js" };
  const result = selectApplicationTests(sources, ["packages/shared/src/services/matches.ts"], exports);
  assert.deepEqual(result.files, ["tests/host.test.ts", "tests/host-series.test.ts", "tests/draft-deck-legality.test.ts"]);
  assert.deepEqual(result.webFiles, ["tests/dependent.test.ts"]);
  assert.deepEqual(selectApplicationTests(sources, ["packages/shared/src/services/index.ts"], exports).webFiles, ["tests/dependent.test.ts"]);
  assert.deepEqual(selectApplicationTests(sources, ["packages/shared/src/remote/unused.ts"], exports).webFiles, []);
});

test("application selection follows every duel test root through host and suite helpers", () => {
  const sources = {
    "packages/duel-server/tests/host-deck-master-type.test.ts": 'import "../src/host.js";',
    "packages/duel-server/tests/host-live-idle.test.ts": 'import "../src/host.js";',
    "packages/duel-server/tests/host-owner-history-access.test.ts": 'import "../src/host.js";',
    "packages/duel-server/tests/host-replay-fork-real.test.ts": 'import "./host-replay-fork-real.suite.js";',
    "packages/duel-server/tests/host-replay-fork-real-part2.test.ts": 'import "./host-replay-fork-real.suite.js";',
    "packages/duel-server/tests/host-replay-fork-real.suite.ts": 'import "../src/host.js"; import "./support/cores.js";',
    "packages/duel-server/src/host.ts": 'import { createDuelSeriesService } from "@yugidraft/shared/services";',
    "packages/shared/src/services/index.ts": 'export * from "./duel-series.js"; export * from "./remote-unused.js";',
    "packages/shared/src/services/duel-series.ts": 'export const createDuelSeriesService = true;',
    "packages/shared/src/services/remote-unused.ts": 'export const unused = true;',
    "packages/duel-server/tests/unrelated.test.ts": 'import "./support/cores.js";',
    "packages/duel-server/tests/remote-unit.test.ts": 'import "@yugidraft/shared/services/remote-unused";',
  };
  const exports = { "./services": "./dist/services/index.js" };
  const selected = selectApplicationTests(sources, ["packages/shared/src/services/duel-series.ts"], exports);
  for (const file of Object.keys(sources).filter(file => /host-.*\.test\.ts$/.test(file))) {
    assert.ok(selected.files.includes(file.slice("packages/duel-server/".length)), file);
  }
  assert.equal(selected.files.includes("tests/unrelated.test.ts"), false);
  assert.equal(selected.files.some(file => file.endsWith(".suite.ts")), false);
  assert.equal(new Set(selected.files).size, selected.files.length);
  assert.deepEqual(selectApplicationTests(sources, ["packages/shared/src/services/remote-unused.ts"], exports), { files: [], webFiles: [] });
});

test("real duel-series-only input retains every reported host regression and both replay roots", () => {
  const { sources, exports } = engineSources();
  const { files } = selectApplicationTests(sources, ["packages/shared/src/services/duel-series.ts"], exports);
  for (const file of [
    "tests/host.test.ts", "tests/host-series.test.ts", "tests/draft-deck-legality.test.ts",
    "tests/host-deck-master-type.test.ts", "tests/host-live-idle.test.ts", "tests/host-owner-history-access.test.ts",
    "tests/host-replay-fork-real.test.ts", "tests/host-replay-fork-real-part2.test.ts",
  ]) assert.ok(files.includes(file), file);
  assert.deepEqual(selectApplicationTests(sources, ["packages/shared/src/services/remote-retention.ts"], exports),
    { files: [], webFiles: [] });
});

test("engine-imported application inputs keep the minimum gates without a discovered test caller", () => {
  const sources = {
    "packages/duel-server/src/host.ts": 'import "@yugidraft/shared/services/duel-series";',
    "packages/shared/src/services/duel-series.ts": 'export const series = true;',
  };
  assert.deepEqual(selectApplicationTests(sources, ["packages/shared/src/services/duel-series.ts"], {}).files,
    ["tests/host.test.ts", "tests/host-series.test.ts", "tests/draft-deck-legality.test.ts"]);
});
