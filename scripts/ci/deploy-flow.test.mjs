import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));
const value = (expression, inputs, github, vars = {}) => Function("inputs", "github", "vars", `return (${expression
  .replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(inputs, github, vars);

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
  assert.deepEqual(prod.jobs.deploy.concurrency, { group: "deploy-production", "cancel-in-progress": false });
  assert.equal(prod.concurrency, undefined, "ineligible workflow runs must not displace a queued successful deploy");
  assert.equal(prod.jobs.deploy.environment, "production");
  assert.equal(prod.on.workflow_dispatch.inputs.ref.default, "main");
  assert.equal(prod.on.workflow_dispatch.inputs.force.default, false);
  assert.equal(prod.on.workflow_dispatch.inputs.rollback.default, false);
  const steps = prod.jobs.deploy.steps;
  const save = steps.findIndex(step => step.name === "Save deployment activity guard");
  const target = steps.findIndex(step => step.name === "Checkout deploy ref");
  assert.ok(save >= 0 && save < target, "preserve the guard before target checkout replaces the source files");
  assert.match(steps[save].run, /cp scripts\/deployment\/check-prod-activity.py "\$RUNNER_TEMP\/check-prod-activity.py"/);
  const remote = steps.find(step => step.name === "Deploy over SSH").run;
  assert.match(remote, /"\$RUNNER_TEMP\/check-prod-activity.py" "\$VM_USER@\$VM_HOST:\$remote_guard"/);
  assert.match(remote, /--wait-seconds "\$remaining"/);
  assert.match(remote, /DEPLOY_LIVE_ONLY='\$DEPLOY_LIVE_ONLY'/);
  assert.equal(remote.match(/check_prod_activity(?:\n|; then)/g).length, 2);
  assert.match(remote, /idle_deadline - \$\(date \+%s\)/);
  assert.match(remote, /git merge-base --is-ancestor HEAD "\$DEPLOY_COMMIT"/);
  assert.match(remote, /Do not run compose up\. Run Deploy again\./);
});

test("automatic production deploys accept only a successful Test push on main and pin its SHA", () => {
  const job = workflow("deploy.yml").jobs.deploy;
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
  const job = workflow("deploy.yml").jobs.deploy;
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

test("staging push uses the exact pushed SHA with safe dispatch defaults", () => {
  const staging = workflow("deploy-staging.yml");
  assert.deepEqual(staging.on.push.branches, ["main"]);
  assert.equal(staging.jobs.staging.if, "github.ref == 'refs/heads/main' && (github.event_name != 'push' || vars.STAGING_AUTO_DEPLOY == '1')");
  for (const [event, ref, enabled, expected] of [
    ["push", "main", undefined, false], ["push", "main", "0", false], ["push", "main", "1", true],
    ["push", "feature", "1", false], ["workflow_dispatch", "main", undefined, true],
    ["workflow_dispatch", "feature", "1", false],
  ]) {
    assert.equal(value(staging.jobs.staging.if, {}, { event_name: event, ref: `refs/heads/${ref}` }, { STAGING_AUTO_DEPLOY: enabled }), expected);
  }
  const env = staging.jobs.staging.env;
  const pushed = { sha: "a".repeat(40) };
  assert.equal(value(env.INPUT_REF, {}, pushed), pushed.sha);
  assert.equal(value(env.INPUT_ACTION, {}, pushed), "deploy");
  assert.equal(value(env.INPUT_REFRESH_DB, {}, pushed), "false");
  const manual = { ref: "reviewed-branch", action: "stop", refresh_db: true };
  assert.equal(value(env.INPUT_REF, manual, pushed), manual.ref);
  assert.equal(value(env.INPUT_ACTION, manual, pushed), "stop");
  assert.equal(value(env.INPUT_REFRESH_DB, manual, pushed), "true");
});

test("manual staging refs cannot replace the workflow revision's remote safety entry script", () => {
  const job = workflow("deploy-staging.yml").jobs.staging;
  assert.equal(job.env.VM_SSH_PRIVATE_KEY, undefined);
  const steps = job.steps;
  assert.deepEqual(steps.filter(step => step.env?.VM_SSH_PRIVATE_KEY).map(step => step.name), ["Configure SSH key"]);
  const save = steps.findIndex(step => step.name === "Save staging deployment controls");
  const target = steps.findIndex(step => step.with?.ref === "${{ env.INPUT_REF }}");
  assert.ok(save >= 0 && save < target, "preserve staging controls before target checkout");
  assert.match(steps[save].run, /cp scripts\/staging\/remote-deploy.sh "\$RUNNER_TEMP\/staging-remote-deploy.sh"/);
  assert.match(steps[save].run, /cp scripts\/deployment\/check-prod-activity.py "\$RUNNER_TEMP\/staging-activity-guard.py"/);
  const transfer = steps.find(step => step.name === "Run on the VM").run;
  assert.match(transfer, /< "\$RUNNER_TEMP\/staging-remote-deploy.sh"/);
  assert.match(transfer, /STAGING_GUARD='\$remote_guard'/);
});

test("only manual staging dispatch can ignore production activity", () => {
  const staging = workflow("deploy-staging.yml");
  const input = staging.on.workflow_dispatch.inputs.ignore_prod_activity;
  assert.ok(input, "manual staging dispatch must provide ignore_prod_activity");
  assert.equal(input.type, "boolean");
  assert.equal(input.default, false);
  const expression = staging.jobs.staging.env.INPUT_IGNORE_PROD_ACTIVITY;
  for (const [event, enabled, expected] of [
    ["push", undefined, "false"], ["push", true, "false"],
    ["workflow_dispatch", undefined, "false"], ["workflow_dispatch", false, "false"],
    ["workflow_dispatch", true, "true"],
  ]) {
    assert.equal(value(expression, { ignore_prod_activity: enabled }, { event_name: event }), expected);
  }
  const steps = staging.jobs.staging.steps;
  assert.match(steps.find(step => step.name === "Check inputs and secrets").run,
    /check "ignore_prod_activity" "\$INPUT_IGNORE_PROD_ACTIVITY" '\^\(true\|false\)\$'/);
  assert.match(steps.find(step => step.name === "Run on the VM").run,
    /STAGING_IGNORE_PROD_ACTIVITY='\$INPUT_IGNORE_PROD_ACTIVITY'/);
});

test("selected production code runs only after its main ancestry check, without the SSH key", t => {
  const prod = workflow("deploy.yml");
  assert.equal(prod.jobs.deploy.env.VM_SSH_PRIVATE_KEY, undefined);
  const steps = prod.jobs.deploy.steps;
  const checkout = steps.findIndex(step => step.name === "Checkout deploy ref");
  assert.equal(steps[checkout].with["fetch-depth"], 0);
  const verify = steps[checkout + 1];
  assert.equal(verify.name, "Verify deploy ref is on main");
  assert.match(verify.run, /git fetch origin main && git merge-base --is-ancestor HEAD FETCH_HEAD/);
  const install = steps.find(step => step.name === "Install duel-engine build dependencies");
  const keyStep = steps.findIndex(step => step.name === "Configure SSH key");
  assert.ok(steps.indexOf(install) > checkout + 1 && keyStep > steps.indexOf(install));
  assert.deepEqual(steps.filter(step => step.env?.VM_SSH_PRIVATE_KEY).map(step => step.name), ["Configure SSH key"]);

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
  const end = remote.indexOf("# Preflight, before anything on the VM changes", start);
  assert.ok(start > 0 && end > start);
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
  const end = remote.indexOf("cd /opt/yugioh-bot", start);
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

test("staging warnings reach the step summary even when the VM step fails", t => {
  const steps = workflow("deploy-staging.yml").jobs.staging.steps;
  const transfer = steps.find(step => step.name === "Run on the VM");
  assert.match(transfer.run, /set -euo pipefail/);
  assert.match(transfer.run, /tee "\$RUNNER_TEMP\/staging-deploy.log"/);
  const report = steps.find(step => step.name === "Report staging result");
  assert.equal(report.if, "${{ always() }}");
  const dir = mkdtempSync(join(tmpdir(), "staging-summary-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, "summary.md");
  writeFileSync(join(dir, "staging-deploy.log"), "ordinary log\n::warning title=Staging skipped::skipping staging; production is active.\n");
  const result = spawnSync("bash", ["-e", "-c", report.run], { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: summary } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(summary, "utf8"), /Staging skipped.*production is active/);
});
