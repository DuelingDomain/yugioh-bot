import assert from "node:assert/strict";
import { test } from "node:test";
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
