import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSmokePull } from "./new-card-smoke-context.mjs";

const repository = "owner/repo";
const headSha = "a".repeat(40), baseSha = "b".repeat(40);
const pull = { number: 7, state: "open", head: { ref: "chore/engine-data-update", sha: headSha, repo: { full_name: repository } },
  base: { sha: baseSha, repo: { full_name: repository } } };
const noLookup = () => { throw new Error("Unexpected API request"); };

test("bot PR synchronize uses exact base/head SHAs, including human overlay commits", async () => {
  assert.deepEqual(await selectSmokePull({ pull_request: pull, action: "synchronize" }, "pull_request", repository, "merge-sha", noLookup),
    { repository, number: 7, baseSha, headSha });
});
test("other PRs, fork branches and main/nightly dispatch never select a PR", async () => {
  for (const other of [{ ...pull, head: { ...pull.head, ref: "feature" } },
    { ...pull, head: { ...pull.head, repo: { full_name: "fork/repo" } } }]) {
    assert.equal(await selectSmokePull({ pull_request: other }, "pull_request", repository, headSha, noLookup), undefined);
  }
  for (const event of [{ ref: "refs/heads/main", inputs: { new_card_smoke: "true" } },
    { ref: "refs/heads/chore/engine-data-update", inputs: { new_card_smoke: "false" } }]) {
    assert.equal(await selectSmokePull(event, "workflow_dispatch", repository, headSha, noLookup), undefined);
  }
  assert.equal(await selectSmokePull({}, "schedule", repository, headSha, noLookup), undefined);
});
test("explicit bot dispatch resolves the open PR at the dispatched commit", async () => {
  const event = { ref: "refs/heads/chore/engine-data-update", inputs: { new_card_smoke: "true" } };
  assert.deepEqual(await selectSmokePull(event, "workflow_dispatch", repository, headSha, async () => [pull]),
    { repository, number: 7, baseSha, headSha });
  await assert.rejects(selectSmokePull(event, "workflow_dispatch", repository, "c".repeat(40), async () => [pull]), /open.*PR.*commit/i);
});
test("invalid PR metadata fails before any Git ref is used", async () => {
  await assert.rejects(selectSmokePull({ pull_request: { ...pull, base: { ...pull.base, sha: "bad" } } },
    "pull_request", repository, headSha, noLookup), /SHA/);
});
