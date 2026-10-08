import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../../.github/workflows/engine-data-update.yml", import.meta.url), "utf8"));
const job = workflow.jobs["prod-errors"];
const capture = job.steps.find(step => step.run);
test("prod credentials are isolated from checkout/install and optional failures cannot block publication", () => {
  assert.deepEqual(job.permissions, {});
  assert.ok(job.steps.every(step => !/checkout|setup-node/.test(step.uses ?? "")));
  assert.match(capture.run, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(capture.run, /ssh-keyscan|select .*from|\.env/);
  assert.equal(workflow.jobs.prepare.needs, "prod-errors");
  assert.equal(workflow.jobs.prepare.if, "${{ !cancelled() }}");
  assert.equal(workflow.jobs.prepare.steps.find(step => step.name === "Download optional production snapshot")["continue-on-error"], true);
  assert.match(workflow.jobs.publish.if, /always\(\).*needs\.prepare\.result == 'success'/);
});

test("production export requires its dedicated forced-command key", () => {
  assert.doesNotMatch(JSON.stringify(capture.env), /VM_SSH_PRIVATE_KEY/);
  assert.equal(capture.env.ENGINE_DATA_PROD_SSH_PRIVATE_KEY, "${{ secrets.ENGINE_DATA_PROD_SSH_PRIVATE_KEY }}");
  assert.deepEqual(runCapture({ dedicatedKey: false }).snapshot, { available: false });
});

function runCapture({ configured = true, failure = false, oversized = false, dedicatedKey = true, payload } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "prod-export-test-"));
  try {
    const response = join(dir, "response.json"), calls = join(dir, "calls.txt");
    writeFileSync(response, payload ?? (oversized ? "x".repeat(70000) : '{"available":true,"cards":[]}'));
    writeFileSync(join(dir, "ssh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FAKE_CALLS"\nif [ "$FAKE_FAIL" = 1 ]; then echo "private diagnostic" >&2; exit 1; fi\ncat "$FAKE_RESPONSE"\n', { mode: 0o700 });
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", capture.run], { encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, VM_HOST: "vm.example.com", VM_USER: "root", VM_PORT: "22",
        VM_SSH_PRIVATE_KEY: "unrestricted deploy key", ENGINE_DATA_PROD_SSH_PRIVATE_KEY: dedicatedKey ? "fake test key" : "", VM_SSH_KNOWN_HOSTS: configured ? "fake pinned host" : "",
        FAKE_RESPONSE: response, FAKE_CALLS: calls, FAKE_FAIL: failure ? "1" : "0" } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
    assert.ok(!readdirSync(dir).some(name => name.startsWith("prod-error-ssh.")), "temporary credentials removed");
    return { snapshot: JSON.parse(readFileSync(join(dir, "prod-script-errors.json"), "utf8")),
      args: readdirSync(dir).includes("calls.txt") ? readFileSync(calls, "utf8") : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("missing credentials, SSH failures and oversize exports degrade without leaking diagnostics", () => {
  const absent = runCapture({ configured: false }); assert.deepEqual(absent.snapshot, { available: false }); assert.equal(absent.args, null);
  assert.deepEqual(runCapture({ failure: true }).snapshot, { available: false });
  assert.deepEqual(runCapture({ oversized: true }).snapshot, { available: false });
});
test("SSH uses only the fixed deployed export command", () => {
  const result = runCapture(); assert.deepEqual(result.snapshot, { available: true, cards: [] });
  assert.ok(result.args.endsWith("sh /opt/yugioh-bot/scripts/prod-script-errors.sh\n"));
});
test("the VM wrapper selects production by labels and invokes only the compiled read-only export", () => {
  const dir = mkdtempSync(join(tmpdir(), "prod-wrapper-test-"));
  try {
    writeFileSync(join(dir, "docker"), `#!/bin/sh
if [ "$1" = ps ]; then
  printf '%s\\n' "$@" > "$FAKE_CALLS"
  printf '%s\\n' "abc123"
else
  [ "$1" = exec ] && [ "$2" = abc123 ] && [ "$3" = node ] && [ "$4" = --max-old-space-size=32 ] && [ "$5" = --max-semi-space-size=2 ] && [ "$6" = /app/packages/duel-server/dist/prod-script-errors.js ] || exit 1
  printf '%s\\n' '{"available":true,"cards":[]}'
fi
`, { mode: 0o700 });
    const calls = join(dir, "calls.txt");
    const result = spawnSync("sh", [new URL("../prod-script-errors.sh", import.meta.url).pathname], { encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_CALLS: calls } });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { available: true, cards: [] });
    const filters = readFileSync(calls, "utf8");
    assert.match(filters, /project\.working_dir=\/opt\/yugioh-bot/); assert.match(filters, /compose\.service=duel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("public artifacts retain only validated fields from the bounded remote output", () => {
  const card = { code: 10, name: "Card", distinctDuels: 2, errorCount: 3, autoBlocked: true, scriptHash: "a".repeat(64), engineKind: "multi-normal", helperScripts: ["proc_x.lua", "utility.lua"] };
  const result = runCapture({ payload: JSON.stringify({ available: true, privatePlayer: "secret", cards: [{ ...card, privateDiagnostic: "Lua text" }] }) });
  assert.deepEqual(result.snapshot, { available: true, cards: [card] });
  for (const payload of ["not JSON", "null", JSON.stringify({ available: true, cards: [null] }),
    JSON.stringify({ available: true, cards: [{ ...card, errorCount: -1 }] }),
    JSON.stringify({ available: true, cards: [{ ...card, name: "x".repeat(201) }] }),
    JSON.stringify({ available: true, cards: [{ ...card, engineKind: "unknown" }] }),
    JSON.stringify({ available: true, cards: [{ ...card, helperScripts: ["../private.lua"] }] }),
    JSON.stringify({ available: true, cards: [{ ...card, helperScripts: ["c10.lua"] }] }),
    JSON.stringify({ available: true, cards: [{ ...card, helperScripts: "utility.lua" }] }),
    JSON.stringify({ available: true, cards: Array(101).fill(card) })]) {
    assert.deepEqual(runCapture({ payload }).snapshot, { available: false });
  }
});
