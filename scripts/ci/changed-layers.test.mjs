import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { changedLayers } from "./changed-layers.mjs";

const script = new URL("./changed-layers.mjs", import.meta.url).pathname;
const noEngine = { engine: false, golden: false, tests_only: false };
const allLayers = { engine: true, golden: true, tests_only: false };

test("bot-only and web-only pushes skip the engine layers", () => {
  for (const files of [["packages/bot/src/index.ts"], ["packages/web/src/app/page.tsx"], []]) {
    assert.deepEqual(changedLayers(files, "push"), noEngine);
  }
});

test("every engine input still enables the full engine suites on push", () => {
  const inputs = [
    "packages/duel-server/src/engine.ts",
    "packages/duel-server/scripts/prepare-data.ts",
    "packages/duel-server/tests/engine.test.ts",
    "packages/duel-server/legacy-1v1/expected-sha256.txt",
    "packages/duel-server/domain-core/src/field.cpp",
    "packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm",
    "packages/shared/src/duels/banlist.ts",
    "packages/shared/src/services/duels.ts",
    "packages/shared/src/services/duels-history.ts",
    "packages/shared/src/services/replay-fork.ts",
    "packages/shared/src/db/schema.ts",
    // The host now imports services that PRs historically exempted.
    "packages/shared/src/services/bug-reports.ts",
    "packages/shared/src/services/drafts.ts",
    "packages/shared/src/future-engine-dependency.ts",
    "packages/shared/package.json",
    "packages/e2e/src/duel.ts",
    "data/duel-engine/pins.json",
    "data/duel-engine-next/cards.cdb",
    "patches/ocgcore-wasm+0.1.2.patch",
    "scripts/ci/build-core.sh",
    "scripts/ci/publish-engine-data.mjs",
    "scripts/deployment/prepare-runtime-data.sh",
    ".github/actions/restore-engine-bundle/action.yml",
    ".github/actions/prepare-production-bundle/action.yml",
    ".github/actions/build-production-image/action.yml",
    ".github/actions/setup-ci-node/action.yml",
    ".github/workflows/test.yml",
    ".github/workflows/engine-data-update.yml",
    ".github/workflows/deploy.yml",
    ".github/workflows/future.yml",
    "package.json",
    "package-lock.json",
    "turbo.json",
    "tsconfig.json",
    "tsconfig.base.json",
    ".nvmrc",
    "Dockerfile",
    "docs/adr/0002-multiplayer-duel-rules.md",
    "docs/specs/multiplayer-rule-coverage.md",
  ];
  for (const file of inputs) {
    const layers = changedLayers([file], "push");
    assert.equal(layers.engine, true, file);
    assert.equal(layers.tests_only, false, `push must not narrow tests: ${file}`);
  }
});

test("PR path exemptions and tests-only selection stay unchanged", () => {
  for (const file of [
    "packages/bot/src/index.ts", "packages/web/src/app/page.tsx",
    "packages/shared/tests/duels.test.ts", "packages/shared/scripts/README.md",
    "packages/shared/src/maintenance/repair-ratings.ts",
    ...["bug-reports", "card-images", "cubes", "deal", "draft-access", "draft-decks", "draft-tournament", "drafts", "guild-settings", "live-now", "players", "tournament-registrations"]
      .map(name => `packages/shared/src/services/${name}.ts`),
    "scripts/seed.ts", "scripts/generate-draft-catalog-snapshot.ts", "scripts/data/draft-catalog-legendary.json",
    "Dockerfile", ".github/workflows/deploy.yml", "data/duel-engine/pins.json",
  ]) assert.deepEqual(changedLayers([file], "pull_request"), noEngine, file);

  assert.deepEqual(changedLayers(["packages/duel-server/tests/engine.test.ts"], "pull_request"), {
    engine: true, golden: false, tests_only: true,
  });
  assert.deepEqual(changedLayers(["packages/duel-server/src/engine.ts"], "pull_request"), {
    engine: true, golden: false, tests_only: false,
  });
  assert.deepEqual(changedLayers(["packages/duel-server/domain-core/pins.json"], "pull_request"), allLayers);
});

test("missing diffs and manual/scheduled events still run every layer", () => {
  for (const event of ["push", "pull_request", "workflow_dispatch", "schedule"]) {
    assert.deepEqual(changedLayers(null, event), allLayers);
  }
  for (const event of ["workflow_dispatch", "schedule"]) assert.deepEqual(changedLayers([], event), allLayers);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "changed-layers-"));
  // Retries cover a late write into .git after the last command.
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  // No detached background gc or maintenance, which can still write into .git during cleanup.
  git("config", "gc.auto", "0");
  git("config", "maintenance.auto", "false");
  git("config", "user.name", "CI tests");
  git("config", "user.email", "ci@example.invalid");
  const commit = (file) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `${file}\n`);
    git("add", ".");
    git("commit", "-m", file);
    return git("rev-parse", "HEAD");
  };
  const base = commit("README.md");
  const run = (before, after, extra = {}) => {
    const output = join(root, "outputs");
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, EVENT: "push", PUSH_BEFORE: before, PUSH_AFTER: after, GITHUB_OUTPUT: output, ...extra },
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => line.split("=")));
  };
  return { root, git, commit, base, run };
}

test("the CLI uses the whole pushed range, not just the last commit", t => {
  const f = fixture(t);
  const bot = f.commit("packages/bot/src/index.ts");
  assert.equal(f.run(f.base, bot).engine, "false");
  const web = f.commit("packages/web/src/app/page.tsx");
  assert.equal(f.run(bot, web).engine, "false");
  f.commit("packages/duel-server/src/engine.ts");
  const tip = f.commit("packages/web/src/app/other.tsx");
  const result = f.run(web, tip);
  assert.equal(result.engine, "true");
  assert.equal(result.tests_only, "false");
  assert.equal(result.base, web);
  assert.equal(result.head, tip);
});

test("a merge push compares to before (the first parent), not the PR merge base", t => {
  const f = fixture(t);
  f.git("checkout", "-b", "web", f.base);
  f.commit("packages/web/src/app/page.tsx");
  f.git("checkout", "main");
  const before = f.commit("packages/duel-server/src/engine.ts");
  f.git("merge", "--no-ff", "web", "-m", "Merge web");
  const head = f.git("rev-parse", "HEAD");
  assert.equal(f.git("rev-parse", "HEAD^1"), before);
  assert.equal(f.run(before, head).engine, "false");

  f.git("checkout", "-b", "engine");
  f.commit("packages/duel-server/src/worker.ts");
  f.git("checkout", "main");
  f.git("merge", "--no-ff", "engine", "-m", "Merge engine");
  assert.equal(f.run(head, f.git("rev-parse", "HEAD")).engine, "true");
});

test("deleted or renamed engine files still require every engine suite", t => {
  const f = fixture(t);
  const before = f.commit("packages/duel-server/src/engine.ts");
  f.git("mv", "packages/duel-server/src/engine.ts", "engine-moved.txt");
  f.git("commit", "-m", "Move engine file out of engine paths");
  assert.equal(f.run(before, f.git("rev-parse", "HEAD")).engine, "true");
});

test("zero, missing, unavailable and non-ancestor push bases fail open to every layer", t => {
  const f = fixture(t);
  const head = f.commit("packages/web/src/app/page.tsx");
  f.git("checkout", "-b", "diverged", f.base);
  const other = f.commit("packages/bot/src/index.ts");
  for (const before of ["", "0".repeat(40), "f".repeat(40), other]) {
    const result = f.run(before, head);
    assert.equal(result.engine, "true", before);
    assert.equal(result.golden, "true", before);
    assert.equal(result.tests_only, "false", before);
  }
});

test("a failed git diff enables every layer", t => {
  const f = fixture(t);
  const head = f.commit("packages/web/src/app/page.tsx");
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), '#!/bin/sh\n[ "$1" != diff ]\n', { mode: 0o755 });
  const result = f.run(f.base, head, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(result.engine, "true");
  assert.equal(result.golden, "true");
});
