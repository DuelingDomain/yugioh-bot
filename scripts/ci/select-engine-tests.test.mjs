import assert from "node:assert/strict";
import { test } from "node:test";
import { selectTests } from "./select-engine-tests.mjs";

const duel = "packages/duel-server/";
const shared = "packages/shared/";
const web = "packages/web/";

test("a change to an engine module reaches pinned, surrender, legacy and web callers", () => {
  const file = duel + "src/engine.ts";
  const sources = {
    [file]: "export const round = 1;",
    [duel + "tests/pinned.test.ts"]: 'import "../src/engine.js";',
    [duel + "tests/host-surrender-eot.test.ts"]: 'import "../src/engine.js";',
    [duel + "tests/legacy-main/engine.test.ts"]: 'import "../../src/engine.js";',
    [web + "tests/duel.test.ts"]: 'import "../../duel-server/src/engine.js";',
    [duel + "tests/unrelated.test.ts"]: 'import "./support/cores.js";',
  };
  assert.deepEqual(selectTests(sources, [file]), [
    duel + "tests/host-surrender-eot.test.ts", duel + "tests/legacy-main/engine.test.ts",
    duel + "tests/pinned.test.ts", web + "tests/duel.test.ts",
  ]);
});

test("engine selection follows shared exports and web aliases", () => {
  const file = shared + "src/duels/rule.ts";
  const sources = {
    [shared + "src/duels/index.ts"]: 'export * from "./rule.js";',
    [file]: "export const rule = true;",
    [duel + "tests/rule.test.ts"]: 'import("@yugidraft/shared/duels");',
    [web + "src/lib/duel.ts"]: 'import "@yugidraft/shared/duels";',
    [web + "tests/duel.test.ts"]: 'import "@/lib/duel";',
  };
  const exports = { "./duels": { source: "./src/duels/index.ts" } };
  assert.deepEqual(selectTests(sources, [file], exports), [duel + "tests/rule.test.ts", web + "tests/duel.test.ts"]);
});

test("engine graph does not fan out from an observability hub in a mixed change", () => {
  const hub = shared + "src/observability/console-adapter.ts";
  const file = duel + "src/engine.ts";
  const sources = {
    [hub]: "export const changed = true;",
    [file]: "export const round = 1;",
    [duel + "tests/engine.test.ts"]: 'import "../src/engine.js";',
    [duel + "tests/multi-scripts-table.test.ts"]: 'import "@yugidraft/shared/observability/console-adapter";',
    [duel + "tests/host-surrender-eot.test.ts"]: 'import "@yugidraft/shared/observability/console-adapter";',
  };
  const exports = { "./observability/console-adapter": "./dist/observability/console-adapter.js" };
  assert.deepEqual(selectTests(sources, [hub, file], exports), [duel + "tests/engine.test.ts"]);
});

test("engine graph stops when a changed dependency is reached through a hub", () => {
  const file = duel + "src/engine.ts";
  const sources = {
    [file]: "export const round = 1;",
    [duel + "src/config.ts"]: 'import "./engine.js";',
    [duel + "tests/config-consumer.test.ts"]: 'import "../src/config.js";',
  };
  assert.deepEqual(selectTests(sources, [file]), []);
});

test("engine graph retains deleted helper and changed snapshot readers", () => {
  const deleted = duel + "tests/helpers/engine.ts";
  const snapshot = duel + "tests/__snapshots__/state.test.ts.snap";
  const sources = {
    [duel + "tests/engine.test.ts"]: 'import "./helpers/engine.js";',
    [duel + "tests/state.test.ts"]: "export {};",
  };
  assert.deepEqual(selectTests(sources, [deleted, snapshot]), [duel + "tests/engine.test.ts", duel + "tests/state.test.ts"]);
});
