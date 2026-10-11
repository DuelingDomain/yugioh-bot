import assert from "node:assert/strict";
import { test } from "node:test";
import { smokeCommitStatus } from "./new-card-smoke-status.mjs";

const url = "https://github.com/owner/repo/actions/runs/1";
test("the dispatch bridge holds the exact report context pending before smoke", () => {
  assert.deepEqual(smokeCommitStatus("pending", undefined, url), {
    state: "pending", context: "New card engine smoke report", target_url: url,
    description: "Real-engine smoke is running for new and changed cards",
  });
});
test("the dispatch bridge succeeds only when the aggregate report succeeds", () => {
  assert.equal(smokeCommitStatus("final", "success", url).state, "success");
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    assert.equal(smokeCommitStatus("final", result, url).state, "failure");
  }
  assert.throws(() => smokeCommitStatus("other", "success", url), /phase/);
});
