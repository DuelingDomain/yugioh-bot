import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("an empty dependent web selection exits without falling back to the whole web suite", () => {
  const result = spawnSync(process.execPath, [new URL("./run-engine-tests.mjs", import.meta.url).pathname, "web", "1/1"], {
    encoding: "utf8", env: { ...process.env, CI_TEST_FILES: "[]", PATH: "/no-npm-available" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /falling back/);
});

test("dependent web runs require an explicit selection", () => {
  const result = spawnSync(process.execPath, [new URL("./run-engine-tests.mjs", import.meta.url).pathname, "web", "1/1"], {
    encoding: "utf8", env: { ...process.env, CI_TEST_FILES: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicit file selection/);
});
