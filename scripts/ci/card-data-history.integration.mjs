/** Run with Node 22: node scripts/ci/card-data-history.integration.mjs
 * Exercises the real publisher, pin patch, history files, commits and push leases
 * against a disposable local bare remote. Only GitHub PR operations are simulated.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishEngineData, readPinsFromSource, PIN_FILE, BOT } from "./publish-engine-data.mjs";
import { HISTORY_FILE } from "./engine-data-history.mjs";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "card-data-history-integration-"));
const cwd = join(root, "checkout"), remote = join(root, "remote.git"), artifactDir = join(root, "artifact");
const coreFiles = ["packages/duel-server/domain-core/pins.json", "packages/duel-server/legacy-1v1/domain-core/pins.json"];
const baseFiles = [PIN_FILE, ...coreFiles, HISTORY_FILE];
const url = "https://github.com/DuelingDomain/yugioh-bot/pull/999999";
const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
const env = { ...process.env, UPDATE_ARTIFACT_DIR: artifactDir, GH_REPO: "DuelingDomain/yugioh-bot", HAS_PR_TOKEN: "true" };
let openPr = false, pushes = 0;
const run = (command, args, options) => {
  if (command === "gh") {
    if (args[0] === "pr" && args[1] === "list") return openPr ? url : "";
    if (args[0] === "pr" && args[1] === "create") { openPr = true; return url; }
    if (args[0] === "api") return "engine-data\n";
    return "";
  }
  if (args[0] === "push" && ++pushes === 2) throw new Error("Simulated network failure on second push");
  return execFileSync(command, args, { ...options, encoding: "utf8", stdio: "pipe" });
};

try {
  mkdirSync(cwd); mkdirSync(artifactDir);
  git("init", "--bare", remote); git("init", "-b", "main");
  git("config", "user.name", BOT.name); git("config", "user.email", BOT.email);
  git("remote", "add", "origin", remote);
  for (const path of baseFiles) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), readFileSync(join(sourceRoot, path)));
  }
  git("add", "."); git("commit", "-qm", "real source files"); git("push", "origin", "main");
  const baseSha = git("rev-parse", "HEAD").trim();
  const originalHistory = JSON.parse(readFileSync(join(cwd, HISTORY_FILE), "utf8"));
  const originalPins = readPinsFromSource(readFileSync(join(cwd, PIN_FILE), "utf8"));
  function candidate(character) {
    git("switch", "main");
    const next = Object.fromEntries(Object.keys(originalPins).map(key => [key, character.repeat(40)]));
    for (const path of [PIN_FILE, ...coreFiles]) {
      let source = git("show", `${baseSha}:${path}`);
      for (const [key, pin] of Object.entries(originalPins)) source = source.replaceAll(pin, next[key]);
      writeFileSync(join(cwd, path), source);
    }
    const files = [PIN_FILE, ...coreFiles];
    const metadata = { changed: true, baseSha, next, files,
      relevance: { newCards: 2, changedCards: 7, removedCards: 1, changedScripts: ["official/c89631139.lua", "utility.lua"] },
      cardChanges: { comparisonAvailable: true, added: [{ name: "Integration set", code: "INT", cards: [
        { name: "Blue-Eyes White Dragon", code: 89631139, prerelease: false },
        { name: "Integration preview with a long card name <script>alert(1)</script>", code: 100000001, prerelease: true },
      ] }] } };
    writeFileSync(join(artifactDir, "update.patch"), git("diff", "--binary"));
    git("restore", "--", ...files);
    writeFileSync(join(artifactDir, "update.json"), JSON.stringify(metadata));
    writeFileSync(join(artifactDir, "pr-body.md"), "Integration update report\n");
    return metadata;
  }
  candidate(originalPins.scripts[0] === "a" ? "b" : "a");
  const historyAtHead = () => JSON.parse(git("show", `origin/chore/engine-data-update:${HISTORY_FILE}`));
  await assert.rejects(publishEngineData({ cwd, env, run }), /Simulated network failure/);
  assert.deepEqual(historyAtHead(), originalHistory, "failed second push leaves the remote pin commit intact");
  git("switch", "main");
  const pinOnlyHead = git("rev-parse", "origin/chore/engine-data-update").trim();
  assert.equal((await publishEngineData({ cwd, env, run })).status, "published");
  assert.equal(pushes, 3, "a retry repairs missing history even when PR pins already match");
  assert.equal(git("rev-parse", "HEAD^").trim(), pinOnlyHead, "repair preserves the published pin commit");
  assert.equal(git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim(), HISTORY_FILE);
  const first = historyAtHead();
  assert.equal(first.length, originalHistory.length + 1);
  assert.deepEqual(first.slice(1), originalHistory, "backfill survives publication");
  assert.deepEqual(first[0].pullRequest, { number: 999999, url });
  assert.deepEqual(first[0].counts, { newCards: 2, changedCards: 7, removedCards: 1, changedScripts: 2, newSetCodes: 1 });
  assert.equal(first[0].newCards[1].prerelease, true);
  assert.equal(first[0].newCards[1].setCode, "INT");
  assert.equal(git("status", "--porcelain").trim(), "");
  // A new run replaces this still-open PR's snapshot rather than duplicating it.
  const metadata = candidate("c");
  metadata.relevance.changedCards = 9;
  writeFileSync(join(artifactDir, "update.json"), JSON.stringify(metadata));
  const beforeUpdate = pushes;
  assert.equal((await publishEngineData({ cwd, env, run })).status, "published");
  assert.equal(pushes - beforeUpdate, 1, "existing PR history is included in the pin commit");
  assert.equal(historyAtHead().length, first.length);
  assert.equal(historyAtHead()[0].counts.changedCards, 9);
  assert.equal(git("log", "-1", "--format=%an <%ae>").trim(), `${BOT.name} <${BOT.email}>`);
  // A branch made by the old publisher may not contain a history file at all.
  git("rm", "--", HISTORY_FILE); git("commit", "-qm", "simulate legacy pin-only tree");
  git("push", "origin", "HEAD:refs/heads/chore/engine-data-update");
  candidate("c");
  const beforeLegacy = pushes;
  assert.equal((await publishEngineData({ cwd, env, run, log: () => {} })).reason, "identical-pins");
  assert.equal(pushes, beforeLegacy, "legacy PRs retain their existing identical-pins behavior");
  // History is not a candidate-writable patch path, even though the publisher writes it.
  candidate("d");
  writeFileSync(join(cwd, HISTORY_FILE), "[]\n");
  writeFileSync(join(artifactDir, "update.patch"), readFileSync(join(artifactDir, "update.patch"), "utf8") + git("diff", "--binary", "--", HISTORY_FILE));
  git("restore", "--", HISTORY_FILE);
  const beforeReject = pushes;
  await assert.rejects(publishEngineData({ cwd, env, run }), /allowlist/);
  assert.equal(pushes, beforeReject);
  assert.equal(git("status", "--porcelain").trim(), "");
  // The existing human-commit guard must still protect a reviewed update branch.
  git("switch", "--detach", "origin/chore/engine-data-update");
  git("-c", "user.name=Human", "-c", "user.email=human@example.invalid", "commit", "--allow-empty", "-qm", "reviewed edits");
  git("push", "origin", "HEAD:refs/heads/chore/engine-data-update");
  candidate("e");
  assert.equal((await publishEngineData({ cwd, env, run, log: () => {} })).reason, "human-commits");
  assert.equal(pushes, beforeReject);
  if (process.env.HISTORY_INTEGRATION_OUTPUT) writeFileSync(process.env.HISTORY_INTEGRATION_OUTPUT, JSON.stringify(first, null, 2) + "\n");
  console.log("PASS: real-file publication, failed-push repair, exact PR link, counts/card fields, backfill retention, replacement, patch rejection and human-commit protection");
} finally {
  rmSync(root, { recursive: true, force: true });
}
