import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"));
const value = (expression, inputs, github) => Function("inputs", "github", `return (${expression
  .replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`)(inputs, github);

test("production dispatch is manual and retains workflow safety when an older main SHA is selected", () => {
  const prod = workflow("deploy.yml");
  assert.deepEqual(Object.keys(prod.on), ["workflow_dispatch"]);
  assert.equal(prod.on.workflow_dispatch.inputs.ref.default, "main");
  assert.equal(prod.on.workflow_dispatch.inputs.force.default, false);
  const steps = prod.jobs.deploy.steps;
  const save = steps.findIndex(step => step.name === "Save deployment activity guard");
  const target = steps.findIndex(step => step.with?.ref === "${{ inputs.ref }}");
  assert.ok(save >= 0 && save < target, "preserve the guard before target checkout replaces the source files");
  assert.match(steps[save].run, /cp scripts\/deployment\/check-prod-activity.py "\$RUNNER_TEMP\/check-prod-activity.py"/);
  const remote = steps.find(step => step.name === "Deploy over SSH").run;
  assert.match(remote, /"\$RUNNER_TEMP\/check-prod-activity.py" "\$VM_USER@\$VM_HOST:\$remote_guard"/);
  assert.equal(remote.match(/python3 "\$DEPLOY_GUARD"/g).length, 2);
});

test("staging push uses the exact pushed SHA with safe dispatch defaults", () => {
  const staging = workflow("deploy-staging.yml");
  assert.deepEqual(staging.on.push.branches, ["main"]);
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
  const steps = workflow("deploy-staging.yml").jobs.staging.steps;
  const save = steps.findIndex(step => step.name === "Save staging deployment controls");
  const target = steps.findIndex(step => step.with?.ref === "${{ env.INPUT_REF }}");
  assert.ok(save >= 0 && save < target, "preserve staging controls before target checkout");
  assert.match(steps[save].run, /cp scripts\/staging\/remote-deploy.sh "\$RUNNER_TEMP\/staging-remote-deploy.sh"/);
  const transfer = steps.find(step => step.name === "Run on the VM").run;
  assert.match(transfer, /< "\$RUNNER_TEMP\/staging-remote-deploy.sh"/);
});
