import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));
const value = (expression, inputs, github, vars = {}, needs = {}, cancelled = () => false) =>
  Function("inputs", "github", "vars", "needs", "cancelled", `return (${expression
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(inputs, github, vars, needs, cancelled);

test("staging deployment is removed while production guard and smoke tests remain", () => {
  for (const file of [".github/workflows/deploy-staging.yml", "docker-compose.staging.yml", "Caddyfile.staging", "scripts/staging"]) {
    assert.equal(existsSync(new URL(`../../${file}`, import.meta.url)), false, `${file} must be removed`);
  }
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  assert.doesNotMatch(remote, /staging/i);
  assert.match(remote, /flock -w 900 9/);
  const shared = readFileSync(new URL("../deployment/deploy.test.ts", import.meta.url), "utf8");
  assert.match(shared, /production activity guard with the application schema/);
  assert.match(shared, /anonymous auth health checks/);
  assert.doesNotMatch(shared, /staging/i);
  const ci = workflow("test.yml").jobs["unit-packages"].steps;
  assert.equal(ci.find(step => step.name === "Deployment script tests").run, "npx vitest run scripts/deployment/deploy.test.ts");
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function history(t) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-ref-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source");
  const runner = join(dir, "runner");
  git(dir, "init", source);
  git(source, "symbolic-ref", "HEAD", "refs/heads/main");
  git(source, "config", "user.name", "Deploy test");
  git(source, "config", "user.email", "deploy-test@example.invalid");
  git(source, "commit", "--allow-empty", "-m", "main base");
  const base = git(source, "rev-parse", "HEAD");
  git(source, "switch", "-c", "unreviewed");
  git(source, "commit", "--allow-empty", "-m", "unreviewed code");
  const unreviewed = git(source, "rev-parse", "HEAD");
  git(source, "switch", "main");
  git(source, "commit", "--allow-empty", "-m", "main release");
  const release = git(source, "rev-parse", "HEAD");
  git(dir, "clone", source, runner);
  return { dir, runner, base, unreviewed, release };
}

test("production follows successful main push tests and retains manual rollback safety", () => {
  const prod = workflow("deploy.yml");
  assert.deepEqual(prod.on.workflow_run, { workflows: ["Test"], types: ["completed"], branches: ["main"] });
  assert.deepEqual(prod.concurrency, { group: "deploy-production", "cancel-in-progress": false, queue: "max" });
  for (const job of Object.values(prod.jobs)) assert.equal(job.concurrency, undefined);
  assert.equal(prod.jobs.deploy.environment, "production");
  assert.equal(prod.on.workflow_dispatch.inputs.ref.default, "main");
  assert.equal(prod.on.workflow_dispatch.inputs.force.default, false);
  assert.equal(prod.on.workflow_dispatch.inputs.rollback.default, false);
  const steps = prod.jobs.prepare.steps;
  const save = steps.findIndex(step => step.name === "Save deployment activity guard");
  const target = steps.findIndex(step => step.name === "Checkout deploy ref");
  assert.ok(save >= 0 && save < target, "preserve the guard before target checkout replaces the source files");
  assert.match(steps[save].run, /cp scripts\/deployment\/check-prod-activity.py "\$RUNNER_TEMP\/check-prod-activity.py"/);
  const remote = prod.jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  assert.match(remote, /"\$RUNNER_TEMP\/check-prod-activity.py" "\$VM_USER@\$VM_HOST:\$remote_guard"/);
  assert.match(remote, /--wait-seconds "\$remaining"/);
  assert.match(remote, /DEPLOY_LIVE_ONLY='\$DEPLOY_LIVE_ONLY'/);
  assert.equal(remote.match(/check_prod_activity(?:\n|; then)/g).length, 2);
  assert.match(remote, /idle_deadline - \$\(date \+%s\)/);
  assert.match(remote, /git merge-base --is-ancestor HEAD "\$DEPLOY_COMMIT"/);
  assert.match(remote, /Do not run compose up\. Run Deploy again\./);
});

test("automatic production deploys accept only a successful Test push on main and pin its SHA", () => {
  const job = workflow("deploy.yml").jobs.prepare;
  const sha = "a".repeat(40);
  const automatic = { event_name: "workflow_run", ref: "refs/heads/main", sha: "b".repeat(40),
    event: { workflow_run: { event: "push", conclusion: "success", head_branch: "main", head_sha: sha } } };
  assert.equal(value(job.if, {}, automatic), true);
  assert.equal(value(job.env.DEPLOY_REF, { ref: "main" }, automatic), sha);
  assert.equal(value(job.env.DEPLOY_FORCE, { force: true }, automatic), "false");
  assert.equal(value(job.env.DEPLOY_ROLLBACK, { rollback: true }, automatic), "false");
  assert.equal(value(job.env.DEPLOY_WAIT_SECONDS, {}, automatic), "3600");
  assert.equal(value(job.env.DEPLOY_LIVE_ONLY, {}, automatic), "true");
  for (const field of ["event", "conclusion", "head_branch"]) {
    for (const invalid of field === "conclusion" ? ["failure", "cancelled", "skipped", null] : ["pull_request", "schedule", "workflow_dispatch", "feature"]) {
      const github = { ...automatic, event: { workflow_run: { ...automatic.event.workflow_run, [field]: invalid } } };
      assert.equal(value(job.if, {}, github), false, `${field}=${invalid}`);
    }
  }
  const manual = { event_name: "workflow_dispatch", ref: "refs/heads/main", event: {} };
  assert.equal(value(job.if, {}, manual), true);
  assert.equal(value(job.env.DEPLOY_REF, { ref: sha }, manual), sha);
  assert.equal(value(job.env.DEPLOY_FORCE, { force: true }, manual), "true");
  assert.equal(value(job.env.DEPLOY_ROLLBACK, { rollback: true }, manual), "true");
  assert.equal(value(job.env.DEPLOY_WAIT_SECONDS, {}, manual), "0");
  assert.equal(value(job.env.DEPLOY_LIVE_ONLY, {}, manual), "false");
  assert.equal(value(job.if, {}, { ...manual, ref: "refs/heads/feature" }), false);
  assert.equal(job.steps.find(step => step.name === "Checkout deploy ref").with.ref, "${{ env.DEPLOY_REF }}");
});

test("manual production refs require a successful push Test for that exact commit", t => {
  const job = workflow("deploy.yml").jobs.prepare;
  assert.equal(workflow("deploy.yml").permissions.actions, "read");
  const steps = job.steps;
  const verify = steps.find(step => step.name === "Verify manual deploy commit passed Test");
  assert.ok(verify);
  assert.match(verify.if, /workflow_dispatch/);
  assert.ok(steps.indexOf(verify) > steps.findIndex(step => step.name === "Record checked-out deploy commit"));
  assert.ok(steps.indexOf(verify) < steps.findIndex(step => step.name === "Compute bundle cache key"));
  const dir = mkdtempSync(join(tmpdir(), "manual-test-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gh = join(dir, "gh");
  writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$*" > "$TEST_LOG"\nprintf "%s\\n" "$TEST_RESULT"\n');
  chmodSync(gh, 0o755);
  const sha = "a".repeat(40);
  for (const [count, expected] of [["0", 1], ["1", 0]]) {
    const result = spawnSync("bash", ["-e", "-c", verify.run], { encoding: "utf8", env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_LOG: join(dir, "args"), TEST_RESULT: count,
      DEPLOY_COMMIT: sha, GITHUB_REPOSITORY: "DuelingDomain/yugioh-bot",
    } });
    assert.equal(result.status, expected, result.stderr);
    assert.match(readFileSync(join(dir, "args"), "utf8"), new RegExp(`head_sha=${sha}`));
    assert.match(readFileSync(join(dir, "args"), "utf8"), /event=push.*status=success/);
  }
});


test("selected production code runs only after its main ancestry check, without the SSH key", t => {
  const prod = workflow("deploy.yml");
  assert.equal(prod.jobs.deploy.env.VM_SSH_PRIVATE_KEY, undefined);
  const steps = prod.jobs.prepare.steps;
  const checkout = steps.findIndex(step => step.name === "Checkout deploy ref");
  assert.equal(steps[checkout].with["fetch-depth"], 0);
  const verify = steps[checkout + 1];
  assert.equal(verify.name, "Verify deploy ref is on main");
  assert.match(verify.run, /git fetch origin main && git merge-base --is-ancestor HEAD FETCH_HEAD/);
  const install = steps.find(step => step.name === "Install duel-engine build dependencies");
  assert.ok(steps.indexOf(install) > checkout + 1);
  assert.deepEqual(steps.filter(step => step.env?.VM_SSH_PRIVATE_KEY), []);
  assert.deepEqual(prod.jobs.deploy.steps.filter(step => step.env?.VM_SSH_PRIVATE_KEY).map(step => step.name), ["Configure SSH key"]);
  assert.deepEqual(prod.jobs.deploy.needs, ["prepare", "build"]);

  const { dir, runner, base, unreviewed, release } = history(t);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "build.log");
  for (const name of ["npm", "npx"]) {
    const path = join(bin, name);
    writeFileSync(path, '#!/bin/sh\n[ -z "${VM_SSH_PRIVATE_KEY+x}" ] || exit 99\necho "$*" >> "$TEST_LOG"\n');
    chmodSync(path, 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log };
  delete env.VM_SSH_PRIVATE_KEY;
  const runSelectedBuild = () => spawnSync("bash", ["-e", "-c", `${verify.run}\n${install.run}`], { cwd: runner, env, encoding: "utf8" });
  git(runner, "checkout", unreviewed);
  const refused = runSelectedBuild();
  assert.notEqual(refused.status, 0, refused.stderr);
  assert.equal(existsSync(log), false, "refused code must not reach npm or npx");
  for (const commit of [base, release]) {
    git(runner, "checkout", commit);
    const accepted = runSelectedBuild();
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(readFileSync(log, "utf8"), /rebuild better-sqlite3/);
    rmSync(log);
  }
});

test("VM refuses older or diverged production commits unless rollback is explicit", t => {
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  const start = remote.indexOf('git fetch origin "$DEPLOY_COMMIT"');
  const end = remote.indexOf("# Ancestry checks are complete", start);
  assert.ok(start > 0 && end > start);
  assert.ok(remote.indexOf('git merge-base --is-ancestor HEAD') < remote.search(/^\s*check_prod_activity$/m),
    "refuse older commits before waiting for activity");
  const { runner, base, unreviewed, release } = history(t);
  const run = (current, target, rollback) => {
    git(runner, "checkout", current);
    const result = spawnSync("sh", ["-e", "-c", remote.slice(start, end)], {
      cwd: runner, encoding: "utf8", env: { ...process.env, DEPLOY_COMMIT: target, DEPLOY_ROLLBACK: rollback },
    });
    assert.equal(git(runner, "rev-parse", "HEAD"), current, "ancestry checks must not change the checkout");
    return result;
  };
  for (const current of [release, unreviewed]) {
    const refused = run(current, base, "false");
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Set rollback=true/);
    const rollback = run(current, base, "true");
    assert.equal(rollback.status, 0, rollback.stderr);
  }
  assert.equal(run(base, release, "false").status, 0);
  assert.equal(run(release, release, "false").status, 0);
  assert.notEqual(run(base, unreviewed, "true").status, 0, "rollback must still require a main commit");
});

test("second production guard refusal stops the deploy and gives recovery instructions", t => {
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  const start = remote.indexOf('if ! check_prod_activity');
  const end = remote.indexOf("# Retire the bot container", start);
  assert.ok(start > 0 && end > start);
  const dir = mkdtempSync(join(tmpdir(), "second-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guard = join(dir, "refuse.py");
  writeFileSync(guard, "raise SystemExit(1)\n");
  const result = spawnSync("sh", ["-e", "-c", `check_prod_activity() { python3 "$DEPLOY_GUARD"; }\n${remote.slice(start, end)}\necho reached-service-stop`], {
    encoding: "utf8", env: { ...process.env, DEPLOY_GUARD: guard, DEPLOY_FORCE: "false" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Do not run compose up\. Run Deploy again\./);
  assert.doesNotMatch(result.stdout, /reached-service-stop/);
});

test("both production checks block automatic deploys only on live games and keep the full manual guard", t => {
  const job = workflow("deploy.yml").jobs.deploy;
  const remote = job.steps.find(step => step.name === "Deploy over SSH").run;
  const start = remote.indexOf("idle_deadline=$((");
  const end = remote.indexOf("# Preflight, before anything on the VM changes", start);
  const second = remote.indexOf("if ! check_prod_activity");
  const stop = remote.indexOf("# Retire the bot container", second);
  assert.ok(start > 0 && end > start && second > end && stop > second);
  const dir = mkdtempSync(join(tmpdir(), "live-only-guard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, "bot.sqlite");
  const guard = new URL("../deployment/check-prod-activity.py", import.meta.url).pathname;
  const fixture = `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.executescript("""
        create table duels (status text, opening_json text);
        create table drafts (status text);
        create table tournaments (id integer, status text);
        create table tournament_matches (tournament_id integer, round_number integer, status text);
        create table duel_series (status text);
        insert into tournaments values (1, 'active');
        insert into tournament_matches values (1, 1, 'open'), (1, 2, 'open'), (1, 3, 'open'), (1, 4, 'pending_approval');
        insert into duel_series values ('between_games');
    """)
    if sys.argv[2]:
        db.execute("insert into " + sys.argv[2] + " (status) values ('active')")
`;
  const firstCheck = remote.slice(start, end).replace("/opt/yugioh-bot/data/bot.sqlite", '"$TEST_DATABASE"');
  for (const [event, liveTable, startsDuringBuild, expected] of [
    ["workflow_run", "", false, 0],
    ["workflow_dispatch", "", false, 1],
    ["workflow_run", "duels", false, 1],
    ["workflow_run", "drafts", false, 1],
    ["workflow_run", "duels", true, 1],
    ["workflow_run", "drafts", true, 1],
  ]) {
    rmSync(database, { force: true });
    const setup = spawnSync("python3", ["-c", fixture, database, startsDuringBuild ? "" : liveTable], { encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    const beginGame = startsDuringBuild ? `python3 - "$TEST_DATABASE" "${liveTable}" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("insert into " + sys.argv[2] + " (status) values ('active')")
PY
` : "";
    const result = spawnSync("sh", ["-e", "-c", `${firstCheck}\necho reached-build\n${beginGame}\n${remote.slice(second, stop)}\necho reached-service-stop`], {
      encoding: "utf8", env: {
        ...process.env, TEST_DATABASE: database, DEPLOY_GUARD: guard, DEPLOY_FORCE: "false", DEPLOY_WAIT_SECONDS: "0",
        DEPLOY_LIVE_ONLY: value(job.env.DEPLOY_LIVE_ONLY, {}, { event_name: event }),
      },
    });
    const context = `${event} ${liveTable} startsDuringBuild=${startsDuringBuild}: ${result.stderr}`;
    assert.equal(result.status, expected, context);
    if (expected === 0) {
      assert.match(result.stdout, /reached-service-stop/, context);
      assert.equal(result.stdout.match(/not blocking: tournament_rounds=4 series=1/g)?.length, 2, context);
    } else {
      assert.doesNotMatch(result.stdout, /reached-service-stop/, context);
      if (startsDuringBuild) {
        assert.match(result.stdout, /reached-build/, context);
        assert.match(result.stderr, /Do not run compose up\. Run Deploy again\./, context);
      } else {
        assert.doesNotMatch(result.stdout, /reached-build/, context);
      }
    }
  }
});


test("release images build on native ARM64 with separate registry caches before SSH deployment", () => {
  const { prepare, build, deploy } = workflow("deploy.yml").jobs;
  assert.equal(build.needs, "prepare");
  assert.equal(build["runs-on"], "ubuntu-24.04-arm");
  assert.deepEqual(build.permissions, { contents: "read", packages: "write" });
  assert.deepEqual(build.strategy.matrix.include, [
    { service: "duel", target: "duel-bundled" }, { service: "web", target: "web" },
    { service: "worker", target: "worker" }, { service: "ws", target: "ws" },
  ]);
  const push = build.steps.find(step => step.name === "Build and push runtime image");
  assert.equal(push.with.platforms, "linux/arm64");
  assert.equal(push.with.push, true);
  assert.equal(push.with.tags, "${{ env.IMAGE }}:${{ env.DEPLOY_COMMIT }}");
  assert.match(push.with["cache-to"], /type=registry,.*:buildcache,mode=max/);
  assert.match(push.with["build-contexts"], /engine=/);
  assert.match(build.steps.find(step => step.name === "Save Next.js cache for the next source revision").with.tags, /:nextcache$/);
  assert.ok(prepare.steps.every(step => !step.run?.includes("ssh ")));
  assert.equal(deploy.env.DEPLOY_COMMIT, "${{ needs.prepare.outputs.commit }}");
  assert.equal(build.if, "needs.prepare.outputs.rollback != 'true'");
  assert.match(deploy.if, /needs.prepare.outputs.rollback == 'true'.*needs.build.result == 'skipped'/s);
});

test("production pulls before backup and keeps the drain, migration and health-check sequence without builds", () => {
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  assert.doesNotMatch(remote, /docker (?:build|buildx build)|docker compose[^\n]* (?:build|--build)\b/);
  const ordered = [
    'DUEL_PREFLIGHT=1', 'sh "$DEPLOY_IMAGES" pull',
    '"$release_dir/images.jsonl"', '"$release_dir/online"', 'sh "$DEPLOY_IMAGES" promote',
    'service.pop("build", None)', 'if ! check_prod_activity', '# Retire the bot container', 'stop web duel worker ws',
    '"$release_dir/drained"', 'if ! DUEL_BUNDLE_SRC=', 'run --rm --no-deps --pull never worker',
    'down --remove-orphans', 'up -d --no-build ws duel web worker caddy',
    'running restarts=0', 'running 0 healthy', '/api/auth/session', 'sh "$DEPLOY_IMAGES" prune',
  ];
  let previous = -1;
  for (const marker of ordered) {
    const position = remote.indexOf(marker);
    assert.ok(position > previous, `${marker} must follow the previous safety step`);
    previous = position;
  }
  assert.match(remote, /flock -w 900 9/);
  assert.match(remote, /preserve_previous_image "\$service" "\$image_id" "yugioh-bot-\$service:prev"/);
});

test("deploy accepts an intentional skipped rollback build but rejects failed or cancelled builds", () => {
  const expression = workflow("deploy.yml").jobs.deploy.if;
  const github = { event_name: "workflow_dispatch", ref: "refs/heads/main" };
  for (const [prepareResult, buildResult, rollback, cancelled, expected] of [
    ["success", "success", "false", false, true], ["success", "skipped", "true", false, true],
    ["success", "skipped", "false", false, false], ["success", "failure", "true", false, false],
    ["failure", "skipped", "true", false, false], ["success", "success", "false", true, false],
  ]) {
    const needs = { prepare: { result: prepareResult, outputs: { rollback } }, build: { result: buildResult } };
    assert.equal(value(expression, {}, github, {}, needs, () => cancelled), expected);
  }
});

test("runtime Compose uses pulled local images even for an older build-only checkout", () => {
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  const transform = remote.match(/config --format json \| python3 -c '([\s\S]*?)' > "\$runtime_compose"/)[1];
  const config = { name: "yugioh-bot", services: { caddy: { image: "caddy:2-alpine" } } };
  for (const service of ["duel", "web", "worker", "ws"]) {
    config.services[service] = { build: { context: "/opt/yugioh-bot", target: service },
      volumes: [{ source: "/opt/yugioh-bot/data", target: "/app/data", type: "bind" }] };
  }
  const result = spawnSync("python3", ["-c", transform], { input: JSON.stringify(config), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const runtime = JSON.parse(result.stdout);
  assert.equal(runtime.name, config.name);
  assert.equal(runtime.services.caddy.image, "caddy:2-alpine");
  for (const service of ["duel", "web", "worker", "ws"]) {
    assert.equal(runtime.services[service].build, undefined);
    assert.equal(runtime.services[service].image, `yugioh-bot-${service}:latest`);
    assert.deepEqual(runtime.services[service].volumes, config.services[service].volumes);
  }
});


test("runtime Compose comparison checks dollar values before any service stops", t => {
  const remote = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Deploy over SSH").run;
  const comparison = remote.match(/python3 - "\$runtime_compose" "\$resolved_compose" <<'PY'\n([\s\S]*?)\n\s*PY/);
  assert.ok(comparison, "compare resolved Compose models before stopping services");
  assert.ok(remote.indexOf(comparison[0]) < remote.indexOf('docker stop'));
  for (const line of remote.split('\n').filter(line => line.includes('docker compose -f "$runtime_compose"'))) {
    assert.match(line, /--project-directory \/opt\/yugioh-bot/);
  }
  const dir = mkdtempSync(join(tmpdir(), "compose-roundtrip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = { name: "review-fixture", services: { web: {
    image: "example:latest", environment: { VALUE: "${REVIEW_VALUE}" },
    command: ["sh", "-c", "echo $$VALUE"], healthcheck: { test: ["CMD-SHELL", "echo $$VALUE"] },
  } } };
  const source = join(dir, "source.json");
  const runtime = join(dir, "runtime.json");
  const resolved = join(dir, "resolved.json");
  const values = join(dir, "runtime-values.conf");
  // Synthetic dotenv input only. No repository or owner .env file is opened.
  writeFileSync(values, "REVIEW_VALUE='secret$UNSET-value$$literal'\n");
  fixture.services.web.build = { context: dir, target: "web" };
  writeFileSync(source, JSON.stringify(fixture));
  const env = { ...process.env, DOCKER_HOST: "unix:///nonexistent-review-daemon" };
  delete env.REVIEW_VALUE;
  const compose = file => spawnSync('docker',
    ['compose', '--env-file', values, '--project-directory', dir, '-f', file, 'config', '--format', 'json'],
    { cwd: dir, env, encoding: 'utf8' });
  const before = compose(source);
  assert.equal(before.status, 0, "daemon-free Compose config must succeed");
  const transform = remote.match(/config --format json \| python3 -c '([\s\S]*?)' > "\$runtime_compose"/)[1];
  const transformed = spawnSync('python3', ['-c', transform], { input: before.stdout, encoding: 'utf8' });
  assert.equal(transformed.status, 0, "runtime transform must succeed");
  writeFileSync(runtime, transformed.stdout);
  const after = compose(runtime);
  assert.equal(after.status, 0, "Compose re-read must succeed");
  writeFileSync(resolved, after.stdout);
  const compare = () => spawnSync('python3', ['-', runtime, resolved], { input: comparison[1], encoding: 'utf8' });
  assert.equal(compare().status, 0, 'dollar values must survive the local Compose parser');
  const changed = JSON.parse(after.stdout);
  changed.services.web.environment.VALUE = 'changed$private';
  writeFileSync(resolved, JSON.stringify(changed));
  const refused = compare();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /runtime Compose configuration changed/);
  assert.doesNotMatch(refused.stderr + refused.stdout, /secret|private/);
});


test("build digests are recorded and transferred for immutable pull and promotion", () => {
  const { build, deploy } = workflow("deploy.yml").jobs;
  const push = build.steps.find(step => step.name === "Build and push runtime image");
  assert.equal(push.id, "runtime-image");
  const record = build.steps.find(step => step.name === "Record runtime image digest");
  assert.equal(record.env.IMAGE_DIGEST, "${{ steps.runtime-image.outputs.digest }}");
  assert.ok(build.steps.some(step => step.with?.name === "production-image-${{ matrix.service }}-${{ env.DEPLOY_COMMIT }}"));
  const remote = deploy.steps.find(step => step.name === "Deploy over SSH").run;
  assert.match(remote, /sh "\$DEPLOY_IMAGES" pull "\$DEPLOY_COMMIT" "\$DEPLOY_IMAGE_REFS"/);
  assert.match(remote, /sh "\$DEPLOY_IMAGES" promote "\$DEPLOY_COMMIT" "\$DEPLOY_IMAGE_REFS"/);
  assert.match(remote, /cp "\$DEPLOY_IMAGE_REFS" "\$release_dir\/image-digests"/);
});


test("rollback resolves the retained tag to one ARM64 digest before SSH", t => {
  const resolve = workflow("deploy.yml").jobs.deploy.steps.find(step => step.name === "Resolve retained rollback digests");
  const parser = resolve.run.match(/<<'PY'\n([\s\S]*?)\nPY/)[1];
  const dir = mkdtempSync(join(tmpdir(), "rollback-manifest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "manifest.json");
  const digest = `sha256:${'b'.repeat(64)}`;
  const arm = { Descriptor: { digest, platform: { os: "linux", architecture: "arm64" } } };
  for (const fixture of [arm, [arm, { Descriptor: { digest: "ignored", platform: { os: "unknown", architecture: "unknown" } } }]]) {
    writeFileSync(file, JSON.stringify(fixture));
    const result = spawnSync("python3", ["-", file], { input: parser, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), digest);
  }
  writeFileSync(file, JSON.stringify([arm, arm]));
  assert.notEqual(spawnSync("python3", ["-", file], { input: parser }).status, 0);
});


test("deployment actions use commit pins and image builds disable attestations", () => {
  for (const name of ["deploy.yml", "ghcr-cleanup.yml"]) {
    for (const job of Object.values(workflow(name).jobs)) for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
      if (step.name === "Build and push runtime image" || step.name === "Save Next.js cache for the next source revision") {
        assert.equal(step.with.provenance, false);
        assert.equal(step.with.sbom, false);
      }
    }
  }
});
