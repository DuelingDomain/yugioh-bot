import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { changedLayers as classify, engineSharedFiles } from "./changed-layers.mjs";

// Existing engine assertions remain focused on the engine contract.
const changedLayers = (files, event) => {
  const { engine, golden, tests_only } = classify(files, event);
  return { engine, golden, tests_only };
};

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
    "packages/shared/src/services/replay-forks.ts",
    "packages/shared/src/db/schema.ts",
    // The host now imports services that PRs historically exempted.
    "packages/shared/src/services/bug-reports.ts",
    "packages/shared/src/services/drafts.ts",
    "packages/shared/package.json",
    "data/duel-engine/pins.json",
    "data/duel-engine-next/cards.cdb",
    "patches/ocgcore-wasm+0.1.2.patch",
    "scripts/ci/build-core.sh",
    "scripts/ci/publish-engine-data.mjs",
    ".github/actions/restore-engine-bundle/action.yml",
    ".github/actions/prepare-production-bundle/action.yml",
    ".github/actions/setup-ci-node/action.yml",
    ".github/workflows/test.yml",
    "package.json",
    "package-lock.json",
    "turbo.json",
    "tsconfig.json",
    "tsconfig.base.json",
    ".nvmrc",
  ];
  for (const file of inputs) {
    const layers = changedLayers([file], "push");
    assert.equal(layers.engine, true, file);
    assert.equal(layers.tests_only, false, `push must not narrow tests: ${file}`);
  }
});

test("PRs and main use the same import-aware engine rule", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of [
      "packages/bot/src/index.ts", "packages/web/src/app/page.tsx",
      "packages/e2e/src/duel.ts", "packages/shared/tests/duels.test.ts",
      "packages/shared/src/maintenance/repair-ratings.ts", "packages/shared/src/util/eastern-time.ts",
      "packages/shared/src/future-unused-module.ts", "packages/shared/data/staples/usage.json",
      "packages/shared/data/effects/tags.json", "packages/duel-server/domain-core/proposals/future.md",
      "scripts/effects/tag.ts", "scripts/staples/update.ts", "scripts/deployment/prepare-runtime-data.sh",
      "scripts/ci/publish-images.mjs", "Dockerfile",
      "packages/duel-server/README.md",
    ]) assert.deepEqual(changedLayers([file], event), noEngine, `${event}: ${file}`);
    for (const file of ["packages/shared/src/services/duels.ts", "packages/shared/src/services/drafts.ts",
      "packages/shared/src/db/schema.ts", "packages/shared/src/cards/effects/artifact.ts",
      "packages/shared/src/duels/settings.ts", "packages/duel-server/scripts/install-engine-bundle.sh",
      "scripts/ci/build-core.sh", "scripts/ci/publish-engine-data.mjs", "scripts/native/checks/run.sh",
      "docs/adr/0002-multiplayer-duel-rules.md", "docs/specs/multiplayer-rule-coverage.md",
    ]) assert.equal(changedLayers([file], event).engine, true, `${event}: ${file}`);
  }
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

test("TS-only engine PRs and main pushes skip native and differential core checks", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of [
      "packages/duel-server/src/engine.ts", "packages/duel-server/tests/engine.test.ts",
      "packages/shared/src/duels/settings.ts", "packages/shared/src/services/duels.ts",
      "data/duel-engine-next/cards.cdb",
      "tsconfig.json", "turbo.json", ".github/workflows/deploy.yml",
      ".github/actions/setup-ci-node/action.yml", ".github/actions/prepare-production-bundle/action.yml",
      "packages/duel-server/domain-core/proposals/core.cpp", "packages/duel-server/domain-core/patches/README.md",
    ]) {
      const result = classify([file], event);
      assert.equal(result.core, false, `${event}: ${file}`);
    }
    assert.equal(classify(["packages/duel-server/src/engine.ts"], event).engine, true, event);
  }
});

test("every golden input selects the native core job that runs golden checks", () => {
  const inputs = [
    ".github/workflows/test.yml",
    "scripts/ci/changed-layers.mjs",
    "packages/duel-server/card-script-patches/c123.lua",
    "packages/duel-server/domain-core/patches/0001-core.patch",
    "packages/duel-server/domain-core/multi-scripts/c123.lua",
    "packages/duel-server/domain-core/pins.json",
    "packages/duel-server/scripts/native/nduel.cpp",
    "packages/duel-server/scripts/native/checks/checks.tsv",
    "packages/duel-server/scripts/run-nduel.sh",
    "packages/duel-server/scripts/build-native-core.sh",
    "packages/duel-server/scripts/prepare-multi-core-tree.sh",
    "packages/duel-server/scripts/multi-core-common.sh",
    "packages/duel-server/scripts/prepare-data.ts",
    "packages/duel-server/scripts/released-card-data.ts",
    "packages/duel-server/scripts/card-script-patches.ts",
  ];
  for (const event of ["pull_request", "push"]) {
    for (const file of inputs) {
      const result = classify([file], event);
      assert.equal(result.golden, true, `${event}: ${file}`);
      assert.equal(result.core, true, `${event}: golden checks need the native job: ${file}`);
      assert.equal(result.engine, true, `${event}: native checks need the engine bundle: ${file}`);
    }
  }
});

test("differential tests and their helpers select both core checks", () => {
  const inputs = [
    "packages/duel-server/tests/differential/differential.test.ts",
    "packages/duel-server/tests/differential/differential-extended.test.ts",
    "packages/duel-server/tests/differential/helpers/future-helper.ts",
    "packages/duel-server/tests/fuzz/generators.ts",
    "packages/duel-server/tests/fuzz/helpers/future-helper.ts",
    "packages/duel-server/tests/support/cores.ts",
    "packages/duel-server/tests/support/shard.ts",
    "packages/duel-server/tests/support/setup.ts",
  ];
  for (const event of ["pull_request", "push"]) {
    for (const file of inputs) {
      const result = classify([file], event);
      assert.equal(result.core, true, `${event}: ${file}`);
      assert.equal(result.engine, true, `${event}: ${file}`);
      assert.equal(result.golden, false, `${event}: ${file}`);
      assert.equal(result.tests_only, event === "pull_request", `${event}: ${file}`);
    }
  }
});

test("differential job control files select both core checks", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of [
      "scripts/ci/run-engine-tests.mjs",
      "scripts/ci/engine-test-plan.mjs",
      "packages/duel-server/vitest.config.ts",
    ]) {
      const result = classify([file], event);
      assert.equal(result.core, true, `${event}: ${file}`);
      assert.equal(result.engine, true, `${event}: ${file}`);
      assert.equal(result.golden, false, `${event}: ${file}`);
      assert.equal(result.tests_only, false, `${event}: ${file}`);
    }
  }
});

test("core sources, pins, patches, native tooling and build inputs select both core checks", () => {
  const inputs = [
    "packages/duel-server/domain-core/src/field.cpp",
    "packages/duel-server/domain-core/src/apply-core-fixes.mjs",
    "packages/duel-server/domain-core/lua/domain.lua",
    "packages/duel-server/domain-core/patches/0001-core.patch",
    "packages/duel-server/domain-core/pins.json",
    "packages/duel-server/domain-core/expected-sha256.txt",
    "packages/duel-server/legacy-1v1/domain-core/src/domain_master.cpp",
    "packages/duel-server/legacy-1v1/domain-core/lua/domain.lua",
    "packages/duel-server/legacy-1v1/domain-core/pins.json",
    "packages/duel-server/legacy-1v1/expected-sha256.txt",
    "packages/duel-server/legacy-1v1/scripts/build-domain-core.sh",
    "packages/duel-server/scripts/build-domain-core.ts",
    "packages/duel-server/scripts/build-domain-core.sh",
    "packages/duel-server/scripts/build-standard-core.sh",
    "packages/duel-server/scripts/build-multi-core.sh",
    "packages/duel-server/scripts/build-native-core.sh",
    "packages/duel-server/scripts/multi-core-common.sh",
    "packages/duel-server/scripts/prepare-multi-core-tree.sh",
    "packages/duel-server/scripts/check-legacy-pin.sh",
    "packages/duel-server/scripts/run-nduel.sh",
    "packages/duel-server/scripts/native/checks/run.sh",
    "packages/duel-server/scripts/native/checks/checks.tsv",
    "packages/duel-server/scripts/native/checks/zones.cpp",
    "scripts/native/checks/run.sh",
    "patches/ocgcore-wasm+0.1.2.patch",
    "scripts/ci/build-core.sh", "scripts/ci/parallel-emxx.py", "scripts/ci/bin/em++",
    "scripts/ci/core-cache-key.mjs", "scripts/ci/assemble-core-bundle.mjs", "scripts/ci/changed-layers.mjs",
    ".github/workflows/test.yml", ".github/actions/restore-engine-bundle/action.yml",
    "packages/duel-server/package.json",
    "package.json", "package-lock.json", ".nvmrc",
  ];
  for (const event of ["pull_request", "push"]) {
    for (const file of inputs) {
      const result = classify(["packages/duel-server/src/engine.ts", file, "README.md"], event);
      assert.equal(result.core, true, `${event}: ${file}`);
      assert.equal(classify([file], event).engine, true, `${event}: core checks need the engine bundle`);
      assert.equal(result.tests_only, false, `${event}: ${file}`);
    }
  }
});

test("core checks always run nightly, manually and when the diff is unavailable", () => {
  for (const event of ["pull_request", "push", "schedule", "workflow_dispatch"]) {
    assert.equal(classify(null, event).core, true, event);
  }
  for (const event of ["schedule", "workflow_dispatch"]) {
    for (const files of [[], ["packages/duel-server/src/engine.ts"]]) assert.equal(classify(files, event).core, true, event);
  }
  for (const event of ["pull_request", "push"]) {
    for (const files of [[], ["README.md"], ["packages/web/src/app/page.tsx"]]) assert.equal(classify(files, event).core, false, event);
  }
});

test("Docker inputs select release safety script checks", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of ["Dockerfile", ".dockerignore"]) {
      const result = classify([file], event);
      assert.equal(result.ci_scripts, true, `${event}: ${file}`);
      assert.equal(result.prod_build, true, `${event}: ${file}`);
      assert.equal(result.engine, false, `${event}: ${file}`);
    }
  }
});

test("documentation used as test inputs selects its checks", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of ["docs/adr/0002-multiplayer-duel-rules.md", "docs/specs/multiplayer-rule-coverage.md"]) {
      const result = classify([file, "README.md"], event);
      assert.equal(result.engine, true, `${event}: ${file}`);
      assert.equal(result.docs_only, false, `${event}: ${file}`);
      assert.equal(result.tests_only, false, `${event}: ${file}`);
      assert.equal(result.ci_scripts, false, `${event}: ${file}`);
      assert.equal(result.web, false, `${event}: ${file}`);
    }
    const result = classify(["docs/engine/core-pins.md", "README.md"], event);
    assert.equal(result.ci_scripts, true, event);
    assert.equal(result.docs_only, false, event);
    assert.equal(result.engine, false, event);
    assert.equal(result.web, false, event);
  }
});

test("marketing site code selects web while ordinary documentation skips checks", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of ["site/public/app.js", "site/public/analytics.js", "site/public/index.html"]) {
      const result = classify([file], event);
      assert.equal(result.web, true, `${event}: ${file}`);
      assert.equal(result.docs_only, false, `${event}: ${file}`);
      for (const group of ["engine", "ci_scripts", "effects", "duel_unit", "e2e"]) {
        assert.equal(result[group], false, `${event}: ${file}: ${group}`);
      }
    }
    for (const file of ["site/README.md", "docs/architecture/diagram.svg", "docs/deployment/engine-data-updates.md", "README.md"]) {
      const result = classify([file], event);
      assert.equal(result.docs_only, true, `${event}: ${file}`);
      assert.equal(result.web, false, `${event}: ${file}`);
      assert.equal(result.engine, false, `${event}: ${file}`);
    }
  }
});

test("shared graph follows export aliases, barrels, relative and dynamic imports, including deleted files", () => {
  const files = engineSharedFiles({
    "packages/duel-server/src/host.ts": 'import { service } from "@yugidraft/shared/services"; import("@yugidraft/shared/lazy");',
    "packages/shared/src/services/index.ts": 'export * from "./duels.js";',
    "packages/shared/src/services/duels.ts": 'import type { Schema } from "../db/schema.js";',
    "packages/shared/src/unused.ts": 'export const unused = true;',
  }, { "./services": { default: "./dist/services/index.js" }, "./lazy": { source: "./src/lazy.ts" } });
  for (const file of ["services/index.ts", "services/duels.ts", "db/schema.ts", "lazy.ts"]) {
    assert.ok(files.has("packages/shared/src/" + file), file);
  }
  assert.equal(files.has("packages/shared/src/unused.ts"), false);
});

test("shared graph starts from duel tests and follows their test-only imports", () => {
  const files = engineSharedFiles({
    "packages/duel-server/tests/host.test.ts": 'import { fixture } from "@yugidraft/shared/test-only";',
    "packages/shared/src/test-only/index.ts": 'export * from "../deleted.js";',
    "packages/shared/src/unused.ts": 'export const unused = true;',
  }, { "./test-only": { source: "./src/test-only/index.ts" } });
  assert.ok(files.has("packages/shared/src/test-only/index.ts"));
  assert.ok(files.has("packages/shared/src/deleted.ts"));
  assert.equal(files.has("packages/shared/src/unused.ts"), false);
});

test("shared source imported only by duel tests selects engine checks", () => {
  for (const event of ["pull_request", "push"]) {
    assert.equal(classify(["packages/shared/src/ws/index.ts"], event).engine, true, event);
  }
});

for (const [file, groups, engine] of [
  ["packages/shared/tests/helpers/recording-observability.mjs", ["shared", "duel_unit"], false],
  ["packages/shared/tests/helpers/future-helper.ts", ["shared", "duel_unit"], false],
  ["packages/web/src/components/duel/table/seat-state.ts", ["web", "e2e"], true],
  ["packages/e2e/stack/start.mjs", ["e2e", "duel_unit"], false],
  ["packages/duel-server/card-block-list.json", ["duel_unit", "web"], true],
  ["scripts/ci/publish-engine-data.mjs", ["duel_unit", "ci_scripts"], true],
]) {
  test(`test-only cross-package dependency selects its callers: ${file}`, () => {
    for (const event of ["pull_request", "push"]) {
      const result = classify([file], event);
      for (const group of groups) assert.equal(result[group], true, `${event}: ${group}`);
      assert.equal(result.engine, engine, event);
      assert.equal(result.tests_only, false, event);
    }
  });
}

test("shared duel source selects the effect protocol that imports its barrel", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of ["packages/shared/src/duels/index.ts", "packages/shared/src/duels/settings.ts", "packages/shared/src/duels/future-module.ts"]) {
      assert.equal(classify([file], event).effects, true, `${event}: ${file}`);
    }
  }
});

test("per-area groups skip docs and unrelated packages, and shared source selects consumers", () => {
  const areas = ["web", "bot", "ws", "worker", "shared", "duel_unit", "e2e", "ci_scripts"];
  for (const event of ["pull_request", "push"]) {
    for (const [files, expected] of [
      [["README.md", "docs/adr/rules.md", "packages/duel-server/domain-core/proposals/README.md"], []],
      [["packages/web/src/app/page.tsx"], ["web", "e2e"]],
      [["packages/bot/src/index.ts"], ["bot"]],
      [["packages/ws/src/server.ts"], ["ws", "worker"]],
      [["packages/worker/src/index.ts"], ["worker"]],
      [["packages/e2e/helpers/duel.ts"], ["e2e"]],
      [["packages/shared/tests/duels.test.ts"], ["shared"]],
      [["packages/shared/data/staples/usage.json"], ["web", "shared", "duel_unit"]],
      [["packages/shared/data/effects/tags.jsonl.gz"], ["web", "shared", "duel_unit"]],
      [["packages/shared/src/util/eastern-time.ts"], areas.filter(area => area !== "ci_scripts")],
      [["scripts/ci/test-workflow.test.mjs"], ["ci_scripts"]],
      [["scripts/deployment/deploy.ts"], ["ci_scripts"]],
      [["docker-compose.yml"], []],
      [["unknown-tool.config"], areas],
      [["package-lock.json"], areas],
      [["turbo.json"], areas],
      [["tsconfig.json"], areas],
      [[".github/workflows/deploy.yml"], areas],
    ]) {
      const result = classify(files, event);
      assert.deepEqual(areas.filter(area => result[area]).sort(), [...expected].sort(), `${event}: ${files}`);
      assert.equal(result.docs_only, files.every(file => file.endsWith(".md")));
    }
  }
  assert.equal(classify(["packages/shared/data/staples/usage.json", "README.md"], "pull_request").data_only, true);
  for (const files of [["README.md"], ["packages/shared/data/unknown/input.json"], ["packages/shared/data/effects/tags.jsonl.gz", "packages/bot/src/index.ts"]]) assert.equal(classify(files, "pull_request").data_only, false);
  for (const event of ["pull_request", "push", "schedule", "workflow_dispatch"]) {
    const result = classify(null, event);
    for (const area of areas) assert.equal(result[area], true, `${event}: ${area}`);
    assert.equal(result.docs_only, false);
  }
});

test("effect protocol and production smoke follow only their own input paths", () => {
  for (const event of ["pull_request", "push"]) {
    for (const file of ["packages/web/src/app/page.tsx", "packages/bot/src/index.ts", "packages/shared/data/staples/usage.json", "README.md", "scripts/ci/publish-images.mjs"]) {
      const result = classify([file], event);
      assert.equal(result.effects, false, file);
      assert.equal(result.prod_build, false, file);
    }
    for (const file of ["scripts/effects/tag.ts", "scripts/ci/publish-effect-tags.mjs", "packages/shared/src/cards/effects/artifact.ts", "packages/shared/data/effects/tags.jsonl.gz"]) assert.equal(classify([file], event).effects, true, file);
    for (const file of ["Dockerfile", ".dockerignore", ".github/actions/build-production-image/action.yml", ".github/actions/prepare-production-bundle/action.yml", "packages/duel-server/scripts/install-engine-bundle.sh", "packages/duel-server/domain-core/pins.json", "packages/duel-server/scripts/prepare-data.ts", "packages/shared/src/duels/settings.ts", "packages/duel-server/src/card-script-source.ts", "packages/duel-server/src/card-name-search.ts", "packages/duel-server/src/card-script-patches.ts"]) assert.equal(classify([file], event).prod_build, true, file);
    for (const file of ["package-lock.json", "tsconfig.json", ".github/workflows/test.yml"]) {
      const result = classify([file], event);
      assert.equal(result.effects, true, file);
      assert.equal(result.prod_build, true, file);
    }
  }
  for (const event of ["schedule", "workflow_dispatch"]) {
    assert.equal(classify([], event).effects, true);
    assert.equal(classify([], event).prod_build, true);
  }
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
  assert.equal(result.core, "false");
  assert.equal(result.tests_only, "false");
  assert.equal(result.base, web);
  assert.equal(result.head, tip);
});

test("push ranges and renamed or deleted core inputs keep both core checks selected", t => {
  const f = fixture(t);
  f.commit("packages/duel-server/domain-core/patches/0001-core.patch");
  const tip = f.commit("packages/duel-server/src/engine.ts");
  assert.equal(f.run(f.base, tip).core, "true");
  f.git("mv", "packages/duel-server/domain-core/patches/0001-core.patch", "old-core.txt");
  f.git("commit", "-m", "Move core patch out of core paths");
  assert.equal(f.run(tip, f.git("rev-parse", "HEAD")).core, "true");
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
    assert.equal(result.core, "true", before);
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
  assert.equal(result.core, "true");
  assert.equal(result.golden, "true");
});

test("PR API pages include both sides of renames and fail open on errors or capped lists", t => {
  const f = fixture(t);
  const head = f.commit("packages/web/src/app/page.tsx");
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), '#!/bin/sh\n[ "$API_FAIL" != 1 ] || exit 1\nprintf "%s" "$PR_FILES"\n', { mode: 0o755 });
  const env = { EVENT: "pull_request", BASE: f.base, HEAD: head, PR_NUMBER: "1", GITHUB_REPOSITORY: "fixture/repo", PATH: `${bin}:${process.env.PATH}` };
  const pages = [[{ filename: "README.md" }], [{ filename: "docs/moved.md", previous_filename: "packages/duel-server/src/engine.ts" }]];
  const renamed = f.run(f.base, head, { ...env, PR_FILES: JSON.stringify(pages) });
  assert.equal(renamed.engine, "true");
  assert.equal(renamed.core, "false");
  assert.equal(renamed.docs_only, "false");
  const coreRename = [[{ filename: "docs/old-core.md", previous_filename: "packages/duel-server/domain-core/src/field.cpp" }]];
  assert.equal(f.run(f.base, head, { ...env, PR_FILES: JSON.stringify(coreRename) }).core, "true");
  assert.equal(f.run(f.base, head, { ...env, PR_FILES: '[[{"filename":"README.md"}]]' }).docs_only, "true");
  for (const extra of [{ API_FAIL: "1" }, { PR_FILES: "invalid JSON" }, { PR_FILES: JSON.stringify([Array.from({ length: 3000 }, () => ({ filename: "README.md" }))]) }]) {
    const result = f.run(f.base, head, { ...env, ...extra });
    for (const flag of ["engine", "core", "web", "shared", "ci_scripts", "effects", "prod_build"]) assert.equal(result[flag], "true", flag);
  }
});
