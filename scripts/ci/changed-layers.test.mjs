import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { changedLayers as classify, selectionOutputs } from "./changed-layers.mjs";
import { duelTestFiles } from "./duel-test-files.mjs";
import { engineMatrix } from "./engine-test-plan.mjs";
import { areas, areaFor, isHub, workspaces } from "./test-areas.mjs";

const script = new URL("./changed-layers.mjs", import.meta.url).pathname;
const repo = fileURLToPath(new URL("../../", import.meta.url));
const pr = files => classify(files, "pull_request");
const engine = "packages/duel-server/";
const shared = "packages/shared/";

test("runtime engine PRs use the compact matrix and full non-PR runs retain the release matrix", () => {
  assert.deepEqual(JSON.parse(selectionOutputs(pr([engine + "src/engine.ts"])).engine_matrix), engineMatrix(true));
  assert.deepEqual(JSON.parse(selectionOutputs(pr([engine + "tests/legacy-main/engine.test.ts"])).engine_matrix), engineMatrix(false));
  for (const event of ["push", "schedule", "workflow_dispatch"]) {
    const output = selectionOutputs(classify([engine + "src/engine.ts"], event), {}, event);
    assert.deepEqual(JSON.parse(output.engine_matrix), engineMatrix(false));
  }
});

const areaCases = [
  ["web route", "packages/web/app/api/demo/route.ts", "web", "web"],
  ["web site", "site/src/main.ts", "web", "web"],
  ["WS", "packages/ws/src/events.ts", "ws", "ws"],
  ["worker", "packages/worker/src/timers.ts", "worker", "worker"],
  ["bot", "packages/bot/src/runtime/registry.ts", "bot", "bot"],
  ["vision", "packages/vision/src/face-state.ts", "vision", "vision"],
  ["E2E", "packages/e2e/helpers/auth.ts", "e2e", "e2e"],
  ["shared services", shared + "src/services/duel-series.ts", "shared_services", "shared"],
  ["shared Remote", shared + "src/remote/unused.ts", "shared_services", "shared"],
  ["shared database schema", shared + "src/db/schema.ts", "shared_db", "shared"],
  ["duel host", engine + "src/host.ts", "duel_host", "duel_unit"],
  ["duel HTTP", engine + "src/server.ts", "duel_host", "duel_unit"],
  ["engine code", engine + "src/engine.ts", "engine", "engine"],
  ["new-card smoke worker", engine + "scripts/new-card-smoke-worker.ts", "engine", "engine"],
  ["new-card smoke pool", engine + "scripts/lib/new-card-smoke-pool.ts", "engine", "engine"],
  ["core process limits", engine + "src/script-errors.ts", "engine", "engine"],
  ["engine package scripts", engine + "package.json", "engine", "core"],
  ["shared duel rules", shared + "src/duels/opening.ts", "engine", "engine"],
  ["core C++", engine + "domain-core/src/field.cpp", "engine", "core"],
  ["core Lua overlay", engine + "domain-core/multi-scripts/c123.lua", "engine", "golden"],
  ["legacy core", engine + "legacy-1v1/domain-core/src/field.cpp", "engine", "core"],
  ["card script patches", engine + "card-script-patches/c123.lua", "engine", "core"],
  ["effects", "scripts/effects/tag-cards.ts", "effects", "effects"],
  ["CI", "scripts/ci/run-engine-tests.mjs", "ci", "ci_scripts"],
  ["deploy", "Dockerfile", "deploy", "prod_build"],
  ["rule coverage doc", "docs/specs/multiplayer-rule-coverage.md", "engine", "engine"],
  ["core pins doc", "docs/engine/core-pins.md", "ci", "ci_scripts"],
];

for (const [name, path, owner, flag] of areaCases) {
  test(`${name} belongs to ${owner} and selects ${flag}`, () => {
    assert.equal(areaFor(path), owner);
    const layers = pr([path]);
    assert.equal(layers[flag], true);
    assert.equal(layers.engine, owner === "engine");
  });
}

test("ordinary documentation requires detection only", () => {
  const layers = pr(["README.md", "docs/adr/0003-duel-test-layers.md", engine + "domain-core/proposals/demo.md"]);
  assert.equal(layers.docs_only, true);
  assert.equal(layers.engine, false);
  assert.deepEqual(layers.typecheck, []);
});

test("native and differential selection is confined to direct core inputs", () => {
  for (const file of ["src/engine.ts", "src/host.ts", "src/worker.ts", "domain-core/README.md", "tests/fuzz-n/isolated.ts"]) {
    assert.equal(pr([engine + file]).core, false, file);
  }
  for (const file of ["domain-core/pins.json", "tests/differential/helper.ts", "tests/fuzz/regressions.test.ts", "tests/support/cores.ts", "tests/support/shard.ts", "scripts/build-standard-core.sh"]) {
    const layers = pr([engine + file]);
    assert.equal(layers.engine, true, file);
    assert.equal(layers.core, true, file);
    assert.deepEqual(layers.engine_diff, [], file);
  }
});

test("every golden input selects native and differential as well", () => {
  for (const file of ["card-script-patches/a.lua", "domain-core/patches/01.patch", "domain-core/multi-scripts/a.lua", "domain-core/pins.json", "scripts/run-nduel.sh", "scripts/native/nduel.cpp", "scripts/prepare-data.ts"]) {
    const result = pr([engine + file]);
    assert.equal(result.golden, true, file);
    assert.equal(result.core, true, file);
  }
});

test("workspace manifests and Vitest configs have different fallback scopes", () => {
  const manifest = pr(["packages/web/package.json"]);
  assert.equal(manifest.web, true);
  assert.equal(manifest.shared, false);
  assert.equal(manifest.engine, false);
  for (const file of ["package-lock.json", "package.json", "tsconfig.base.json", "turbo.json", ".nvmrc", "patches/a.patch", engine + "vitest.legacy.config.ts"]) {
    const layers = pr([file]);
    for (const flag of ["full", "engine", "core", "golden", "effects", "prod_build", ...Object.keys(workspaces)]) {
      assert.equal(layers[flag], true, `${file}: ${flag}`);
    }
  }
});

test("workflow and CI checks use the fixed smokes even for engine wiring", () => {
  for (const file of [".github/workflows/test.yml", ".github/actions/setup-ci-node/action.yml", "scripts/ci/build-core.sh", "scripts/ci/unit-test-plan.mjs", "scripts/ci/test-timings/shared.json", "scripts/ci/publish-effect-tags.mjs"]) {
    const layers = pr([file]);
    const output = selectionOutputs(layers);
    for (const flag of ["engine", "core", "golden", "web_build", "effects"]) assert.equal(layers[flag], false, file);
    assert.equal(layers.ci_scripts, true, file);
    assert.equal(layers.checks_only, true, file);
    for (const suite of Object.keys(workspaces)) assert.ok(JSON.parse(output[suite + "_files"]).length <= 2, suite);
    assert.equal(JSON.parse(output.effect_smoke).length, 1);
  }
});

test("global inputs win over narrower changes and CI wiring does not erase engine selection", () => {
  assert.equal(pr([".github/workflows/test.yml", "package-lock.json"]).full, true);
  const layers = pr([".github/workflows/test.yml", engine + "src/engine.ts"]);
  assert.equal(layers.engine, true);
  assert.equal(layers.core, false);
  assert.deepEqual(layers.engine_diff, [engine + "src/engine.ts"]);
  assert.equal(layers.ci_scripts, true);
});

test("engine source and test ownership come from direct paths and the real duel inventory", () => {
  const inventory = duelTestFiles();
  const duelEngineTests = new Set(inventory.engine.map(file => engine + file));
  for (const [list, expected] of [[inventory.engine, true], [inventory.unit, false]]) {
    for (const file of list.filter(file => areaFor(engine + file) === "duel_host").slice(0, 10)) {
      const layers = classify([engine + file], "pull_request", { duelEngineTests });
      assert.equal(layers.engine, expected, file);
      assert.equal(layers.tests_only, true, file);
    }
  }
});

test("WS typecheck edges add worker and duel-server without widening WS runtime selection", () => {
  const file = "packages/ws/src/events.ts";
  const layers = pr([file]);
  assert.deepEqual(layers.typecheck, ["duel-server", "worker", "ws"]);
  assert.deepEqual(layers.routes.worker.consumers, [file]);
  assert.equal(layers.worker, false);
});

test("a web route requests the web build and E2E typecheck without selecting other test areas", () => {
  const layers = pr(["packages/web/app/api/demo/route.ts"]);
  assert.equal(layers.web_build, true);
  assert.deepEqual(layers.typecheck, ["duel-server", "e2e", "vision", "web"]);
  for (const key of ["bot", "worker", "ws", "shared", "duel_unit", "engine"]) assert.equal(layers[key], false, key);
});

test("hub paths opt into all workspace typechecks without launching the engine or web build", () => {
  for (const file of [shared + "src/observability/console-adapter.ts", shared + "src/util/eastern-time.ts", shared + "src/analytics/events.ts", engine + "src/config.ts", "packages/web/src/lib/env.ts", "packages/ws/src/instrument.ts"]) {
    assert.equal(isHub(file), true, file);
    const layers = pr([file]);
    assert.equal(layers.engine, false);
    assert.equal(layers.web_build, false);
    assert.deepEqual(layers.typecheck, ["bot", "duel-server", "e2e", "shared", "vision", "web", "worker", "ws"]);
  }
});

test("shared database contents have a dedicated suite and bounded consumer smokes", () => {
  const layers = pr([shared + "src/db/schema.ts"]);
  assert.equal(layers.engine, false);
  assert.equal(layers.web_build, false);
  assert.deepEqual(layers.routes.shared.owned, [shared + "src/db/schema.ts"]);
  assert.deepEqual(layers.routes.web.consumers, []);
  assert.ok(layers.smoke.web.length);
});

test("generated data readers receive explicit coverage", () => {
  for (const file of ["packages/shared/data/staples/usage.json", "packages/shared/data/effects/tags.jsonl.gz"]) {
    const out = selectionOutputs(pr([file]));
    assert.ok(JSON.parse(out.web_files).includes("tests/effect-startup.integration.test.ts"));
    assert.ok(JSON.parse(out.shared_files).includes("tests/effect-artifact.integration.test.ts"));
    assert.ok(JSON.parse(out.duel_unit_files).includes("tests/host-deck-suggestions.integration.test.ts"));
    assert.equal(out.web_build, false);
  }
});

test("full gates ignore the diff and select all release suites", () => {
  for (const event of ["push", "schedule", "workflow_dispatch"]) {
    for (const files of [null, [], ["README.md"], ["packages/web/src/page.tsx"], [engine + "src/engine.ts"]]) {
      const layers = classify(files, event);
      for (const key of ["full", "engine", "core", "golden", "effects", "prod_build", ...Object.keys(workspaces)]) {
        assert.equal(layers[key], true, `${event}: ${key}`);
      }
      assert.deepEqual(layers.engine_diff, []);
      assert.deepEqual(layers.smoke, {});
    }
  }
});

test("every fixed smoke exists, and no duel smoke needs a core", () => {
  const unit = new Set(duelTestFiles().unit);
  const { smoke } = pr(["scripts/ci/test-areas.mjs"]);
  for (const [suite, files] of Object.entries(smoke)) {
    for (const file of files) {
      assert.doesNotThrow(() => readFileSync(join(repo, workspaces[suite] ? `packages/${workspaces[suite]}/${file}` : file), "utf8"));
      if (suite === "duel_unit") assert.ok(unit.has(file), file);
    }
  }
  assert.ok(areas.engine.smoke.duel_unit.length);
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
      env: { ...process.env, EVENT: "pull_request", BASE: before, HEAD: after, PR_NUMBER: "", RUNNER_TEMP: root, GITHUB_OUTPUT: output, ...extra },
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => line.split("=")));
  };
  return { root, git, commit, base, run };
}

test("local PR detection scans the whole range, including old names", t => {
  const f = fixture(t);
  const moved = engine + "src/engine.ts";
  f.commit(moved);
  const tip = f.commit("packages/web/app/page.tsx");
  const all = f.run(f.base, tip);
  assert.equal(all.engine, "true");
  assert.equal(all.web, "true");
  f.git("mv", moved, "old-engine.txt");
  f.git("commit", "-m", "Move engine input");
  assert.equal(f.run(tip, f.git("rev-parse", "HEAD")).engine, "true");
});

test("a web-only merge still runs all suites on main", t => {
  const f = fixture(t);
  f.git("checkout", "-b", "web", f.base);
  f.commit("packages/web/src/app/page.tsx");
  f.git("checkout", "main");
  const before = f.commit(engine + "src/engine.ts");
  f.git("merge", "--no-ff", "web", "-m", "Merge web");
  const head = f.git("rev-parse", "HEAD");
  assert.equal(f.git("rev-parse", "HEAD^1"), before);
  const result = f.run(before, head, { EVENT: "push" });
  assert.equal(result.engine, "true");
  assert.equal(result.core, "true");
});

test("renamed or deleted core inputs retain both native and differential checks", t => {
  const f = fixture(t);
  const old = engine + "domain-core/patches/0001-core.patch";
  const base = f.commit(old);
  f.git("rm", old);
  f.git("commit", "-m", "Drop core patch");
  const result = f.run(base, f.git("rev-parse", "HEAD"));
  assert.equal(result.engine, "true");
  assert.equal(result.core, "true");
  assert.equal(result.golden, "true");
});

test("a zero, missing or unavailable PR base selects full coverage", t => {
  const f = fixture(t);
  const head = f.commit("packages/web/src/app/page.tsx");
  for (const base of ["", "0".repeat(40), "f".repeat(40)]) {
    const result = f.run(base, head);
    assert.equal(result.full, "true", base);
    assert.equal(result.core, "true", base);
  }
});

test("a failed git diff selects all groups", t => {
  const f = fixture(t);
  const head = f.commit("packages/web/src/app/page.tsx");
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), '#!/bin/sh\n[ "$1" != diff ]\n', { mode: 0o755 });
  assert.equal(f.run(f.base, head, { PATH: `${bin}:${process.env.PATH}` }).full, "true");
});

test("service barrel edits do not need a base API lookup for engine ownership", t => {
  const f = fixture(t);
  const head = f.commit(shared + "src/services/index.ts");
  const result = f.run(f.base, head);
  assert.equal(result.engine, "false");
  assert.equal(result.shared, "true");
  assert.equal(result.scan, "true");
  assert.equal(result.core, "false");
});

test("the first PR detection step works without npm dependencies", t => {
  const f = fixture(t);
  const dir = join(f.root, "scripts/ci");
  mkdirSync(join(dir, "test-timings"), { recursive: true });
  for (const file of ["changed-layers.mjs", "test-areas.mjs", "engine-test-plan.mjs", "engine-test-times.json",
    "unit-test-plan.mjs", "web-test-plan.mjs", "test-shards.mjs", "test-timings/shared.json", "test-timings/duel-unit.json",
    "test-timings/web.json"]) {
    copyFileSync(new URL(file, import.meta.url), join(dir, file));
  }
  const head = f.commit(shared + "src/services/duel-series.ts");
  const output = join(f.root, "outputs");
  const result = spawnSync(process.execPath, [join(dir, "changed-layers.mjs")], {
    cwd: f.root, encoding: "utf8",
    env: { ...process.env, EVENT: "pull_request", BASE: f.base, HEAD: head, PR_NUMBER: "", RUNNER_TEMP: f.root, GITHUB_OUTPUT: output },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, "utf8"), /^engine=false$/m);
  assert.match(readFileSync(output, "utf8"), /^scan=true$/m);
});

test("generated Remote tables and their encoder retain explicit engine ownership", () => {
  for (const file of ["packages/shared/src/remote/card-behaviour.ts", "packages/web/src/lib/remote/card-behaviour-data.json", "packages/web/src/lib/remote/card-logic-data.json"]) {
    assert.equal(pr([file]).engine, true, file);
  }
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

test("a web test that imports the cores helper directly owns an engine input", () => {
  const file = "packages/web/tests/components/ars-magna-real-engine.test.tsx";
  const layers = classify([file], "pull_request", { webEngineTests: new Set([file]) });
  assert.equal(layers.engine, true);
  assert.equal(layers.core, false);
  assert.equal(layers.web, true);
  assert.equal(layers.duel_unit, false);
  assert.deepEqual(layers.engine_diff, [file]);
});

test("type-only effects script edits typecheck the effects project without running effects tests", () => {
  const file = "scripts/effects/batch-client.ts";
  const output = selectionOutputs(classify([file], "pull_request", { typeOnly: new Set([file]) }));
  assert.equal(output.effect_types, true);
  assert.equal(output.effects, false);
  assert.equal(output.effect_smoke, "");
  assert.equal(output.engine, false);
});
