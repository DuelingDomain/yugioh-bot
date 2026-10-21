import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { parse } from "yaml";

const root = new URL("../../", import.meta.url);
const prepare = new URL("scripts/deployment/prepare-runtime-data.sh", root);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "runtime-data-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, "data");
  const bin = join(dir, "bin");
  const log = join(dir, "commands.log");
  mkdirSync(data);
  mkdirSync(bin);
  const chown = join(bin, "chown");
  writeFileSync(chown, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG"\nif [ "${TEST_CHOWN_FAIL:-0}" = 1 ]; then echo "chown: fixture ownership failure" >&2; exit 1; fi\n');
  chmodSync(chown, 0o755);
  return { dir, data, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log } };
}

function ownershipCalls(f, entries = []) {
  return [`-h 1000:1000 ${f.data}`, ...entries.map(entry => `-h -R -P 1000:1000 ${join(f.data, entry)}`)];
}

test("production runtime targets use node, including the inherited bundled duel target", () => {
  const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
  const users = new Map();
  let stage;
  for (const line of dockerfile.split("\n")) {
    const from = /^FROM (\S+) AS (\S+)/i.exec(line);
    if (from) {
      stage = from[2];
      users.set(stage, users.get(from[1]) ?? "root");
    }
    const user = /^USER (\S+)/i.exec(line);
    if (user) users.set(stage, user[1]);
  }
  for (const name of ["ws", "duel", "duel-bundled", "web", "worker", "bot"]) {
    assert.equal(users.get(name), "node", name);
  }
});

test("production Compose retains only Caddy's bind capability and uses the image runtime user", () => {
  const result = spawnSync("docker", ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml", "config", "--format", "json"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, UID: "0", GID: "0", SITE_DOMAIN: "localhost", WEB_URL: "http://localhost", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "test", CLERK_SECRET_KEY: "test", WS_INTERNAL_SECRET: "test", DUEL_INTERNAL_SECRET: "test", DISCORD_GUILD_ID: "test" },
  });
  assert.equal(result.status, 0, result.stderr);
  const { services } = JSON.parse(result.stdout);
  assert.equal(services.duel.environment.DUEL_REPORT_DIR, "/app/data/duel-reports");
  assert.equal(services.worker.environment.WORKER_HEALTH_PATH, "/tmp/yugidraft-worker-health.json");
  assert.equal(Number(services.worker.mem_limit), 384 * 1024 * 1024);
  assert.equal(services.worker.environment.NODE_OPTIONS, "--max-old-space-size=256");
  assert.equal(services.caddy.entrypoint ?? null, null);
  assert.equal(services.caddy.command ?? null, null);
  assert.equal(services.caddy.init ?? false, false);
  assert.ok(!services.caddy.volumes.some(volume => volume.target.includes("vps-health")));
  assert.ok(!services.worker.volumes.some(volume => volume.target.includes("vps-health")));
  for (const [name, service] of Object.entries(services)) {
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"], name);
    assert.deepEqual(service.cap_drop, ["ALL"], name);
    assert.deepEqual(service.cap_add ?? [], name === "caddy" ? ["NET_BIND_SERVICE"] : [], name);
    if (name !== "caddy") assert.ok(service.user === undefined || service.user === "node" || service.user === "1000:1000", name);
  }
});

test("runtime data preparation permits SQLite WAL and cache writes without changing modes", t => {
  const f = fixture(t);
  const dbPath = join(f.data, "bot.sqlite");
  const db = new Database(dbPath);
  db.exec("create table checks (value text)");
  db.close();
  mkdirSync(join(f.data, "duel-engine"));
  const engine = join(f.data, "duel-engine", "manifest.json");
  writeFileSync(engine, "{}");
  chmodSync(engine, 0o600);
  chmodSync(dbPath, 0o600);
  chmodSync(f.data, 0o700);
  const result = spawnSync("sh", ["-c", 'umask 077; sh "$1" "$2"', "prepare", prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const writer = new Database(dbPath);
  try {
    writer.pragma("journal_mode = WAL");
    writer.exec("insert into checks values ('written')");
    assert.equal(writer.prepare("select value from checks").pluck().get(), "written");
    assert.ok(existsSync(`${dbPath}-wal`));
  } finally { writer.close(); }
  for (const path of ["card-images/card.jpg", "duel-engine/runtime.json", "duel-reports/report.json"]) {
    writeFileSync(join(f.data, path), "written");
  }
  writeFileSync(engine, '{"updated":true}');
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), ownershipCalls(f, ["bot.sqlite", "card-images", "duel-engine", "duel-reports", "ops-reports"]));
  assert.equal(statSync(f.data).mode & 0o777, 0o700);
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
});

test("runtime data preparation includes private operations reports and preserves existing modes", t => {
  const f = fixture(t);
  for (const path of ["card-images", "duel-engine", "duel-reports", "ops-reports"]) mkdirSync(join(f.data, path), { mode: 0o700 });
  const files = ["bot.sqlite", "bot.sqlite-wal", "bot.sqlite-shm", "card-images/card.jpg", "duel-engine/manifest.json", "ops-reports/report.json"];
  const modes = [0o600, 0o600, 0o600, 0o400, 0o444, 0o600];
  files.forEach((path, i) => {
    writeFileSync(join(f.data, path), "existing");
    chmodSync(join(f.data, path), modes[i]);
  });
  const result = spawnSync("sh", [prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  files.forEach((path, i) => assert.equal(statSync(join(f.data, path)).mode & 0o777, modes[i], path));
  assert.equal(statSync(join(f.data, "ops-reports")).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), ownershipCalls(f, ["bot.sqlite", "bot.sqlite-shm", "bot.sqlite-wal", "card-images", "duel-engine", "duel-reports", "ops-reports"]));
  writeFileSync(join(f.data, "ops-reports/new-report.json"), "new report");
});

test("runtime data preparation creates private operations reports on a fresh directory", t => {
  const f = fixture(t);
  const result = spawnSync("sh", [prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(join(f.data, "ops-reports")).mode & 0o777, 0o700);
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), ownershipCalls(f, ["card-images", "duel-engine", "duel-reports", "ops-reports"]));
});

test("runtime data preparation is repeatable and leaves unrelated data alone", t => {
  const f = fixture(t);
  const files = ["bot.sqlite", "bot.sqlite-wal", "bot.sqlite-shm"];
  for (const file of files) writeFileSync(join(f.data, file), file);
  const privateDir = join(f.data, "pre-restore");
  mkdirSync(privateDir, { mode: 0o700 });
  writeFileSync(join(privateDir, "bot.sqlite"), "previous");
  for (let i = 0; i < 2; i++) {
    const result = spawnSync("sh", [prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const file of files) assert.equal(readFileSync(join(f.data, file), "utf8"), file);
  assert.equal(statSync(privateDir).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(privateDir, "bot.sqlite"), "utf8"), "previous");
  const expected = ownershipCalls(f, ["bot.sqlite", "bot.sqlite-shm", "bot.sqlite-wal", "card-images", "duel-engine", "duel-reports", "ops-reports"]);
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), [...expected, ...expected]);
});

for (const entry of ["data", "bot.sqlite", "bot.sqlite-wal", "bot.sqlite-shm", "card-images", "duel-engine", "duel-reports", "ops-reports"]) {
  for (const dangling of [false, true]) {
    test(`runtime data preparation refuses ${dangling ? "dangling " : ""}symlinked ${entry}`, t => {
      const f = fixture(t);
      const target = join(f.dir, "outside");
      if (!dangling) mkdirSync(target, { mode: 0o700 });
      const path = entry === "data" ? f.data : join(f.data, entry);
      if (entry === "data") rmSync(f.data, { recursive: true });
      symlinkSync(target, path);
      for (let i = 0; i < 2; i++) {
        const result = spawnSync("sh", [prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /symlink/i);
        assert.ok(lstatSync(path).isSymbolicLink());
      }
      if (!dangling) assert.equal(statSync(target).mode & 0o777, 0o700);
      assert.ok(!existsSync(f.log), "symlinks must be rejected before any ownership changes");
    });
  }
}

test("runtime data preparation requests physical traversal for directories containing nested symlinks", t => {
  const f = fixture(t);
  const images = join(f.data, "card-images");
  mkdirSync(images);
  symlinkSync("/proc/version", join(images, "version"));
  symlinkSync("/proc", join(images, "system"));
  const before = statSync("/proc/version");
  for (let i = 0; i < 2; i++) {
    const result = spawnSync("sh", [prepare.pathname, f.data], { env: f.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(statSync("/proc/version").uid, before.uid);
  assert.equal(statSync("/proc/version").gid, before.gid);
  assert.ok(lstatSync(join(images, "system")).isSymbolicLink());
  const expected = ownershipCalls(f, ["card-images", "duel-engine", "duel-reports", "ops-reports"]);
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), [...expected, ...expected]);
});

test("runtime data preparation refuses a symlinked data directory with trailing slashes", t => {
  const f = fixture(t);
  const target = join(f.dir, "outside");
  mkdirSync(target);
  rmSync(f.data, { recursive: true });
  symlinkSync(target, f.data);
  const result = spawnSync("sh", [prepare.pathname, `${f.data}///`], { env: f.env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink/i);
  assert.ok(!existsSync(join(target, "card-images")));
});

test("web image preparation gives node a writable Next cache while leaving app files alone", t => {
  const f = fixture(t);
  const app = join(f.dir, "app");
  mkdirSync(join(app, "packages/web/.next"), { recursive: true });
  const server = join(app, "packages/web/server.js");
  writeFileSync(server, "read only");
  chmodSync(server, 0o444);
  const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8").replaceAll("\\\n", " ");
  const web = dockerfile.slice(dockerfile.indexOf("FROM node:22-bookworm-slim AS web\n"), dockerfile.indexOf("FROM node:22-bookworm-slim AS worker\n"));
  const commands = web.split("\n").filter(line => line.startsWith("RUN ")).map(line => line.slice(4).replaceAll("/app", app).replaceAll("node:node", "1000:1000"));
  const result = spawnSync("sh", ["-ec", commands.join("\n")], { env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(app, "packages/web/.next/cache/entry.json"), "cached");
  assert.equal(statSync(server).mode & 0o777, 0o444);
  const calls = readFileSync(f.log, "utf8").trim().split("\n");
  assert.ok(calls.some(call => call.endsWith(`1000:1000 ${app}/packages/web/.next/cache`)));
  assert.ok(calls.every(call => call.endsWith(`${app}/data`) || call.endsWith(`${app}/packages/web/.next/cache`)));
});

test("production carries the workflow revision's runtime helper through artifacts and SSH for older refs", t => {
  const f = fixture(t);
  const workflow = parse(readFileSync(new URL(".github/workflows/deploy.yml", root), "utf8"));
  const { prepare, deploy } = workflow.jobs;
  const saved = join(f.dir, "controls");
  const release = join(saved, "release");
  mkdirSync(release, { recursive: true });
  const env = { ...f.env, RUNNER_TEMP: saved, GITHUB_STEP_SUMMARY: join(f.dir, "summary.md"), TEST_REMOTE_ENTRY: join(f.dir, "remote.sh"), TEST_SAVED_HELPER: join(saved, "prepare-runtime-data.sh"), TEST_DATA: f.data,
    DEPLOY_COMMIT: "a".repeat(40), VM_PORT: "22", VM_USER: "root", VM_HOST: "localhost", DEPLOY_FORCE: "false", DEPLOY_ROLLBACK: "true", DEPLOY_WAIT_SECONDS: "0", DEPLOY_LIVE_ONLY: "false", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_test" };
  const save = prepare.steps.find(step => step.name === "Save deployment activity guard");
  const preserved = spawnSync("sh", ["-ec", save.run], { cwd: root, env, encoding: "utf8" });
  assert.equal(preserved.status, 0, preserved.stderr);
  const expectedHelper = readFileSync(new URL("scripts/deployment/prepare-runtime-data.sh", root), "utf8");
  mkdirSync(join(saved, "deploy-bundle"));
  const bundle = spawnSync("tar", ["-C", join(saved, "deploy-bundle"), "-czf", join(saved, "deploy-bundle.tar.gz"), "."], { encoding: "utf8" });
  assert.equal(bundle.status, 0, bundle.stderr);
  // Carry only the files declared in the real release artifact, then discard prepare's workspace.
  const upload = prepare.steps.find(step => step.name === "Upload verified release controls and bundle");
  for (const path of upload.with.path.trim().split("\n")) {
    const source = path.replace("${{ runner.temp }}", saved);
    writeFileSync(join(release, source.split("/").at(-1)), readFileSync(source));
    rmSync(source);
  }
  mkdirSync(join(saved, "image-digests"));
  for (const service of ["duel", "web", "worker", "ws"]) {
    writeFileSync(join(saved, "image-digests", `${service}.digest`), `${service} sha256:${"b".repeat(64)}\n`);
  }
  const transfer = deploy.steps.find(step => step.name === "Prepare deployment transfer");
  const restored = spawnSync("sh", ["-ec", transfer.run], { cwd: f.dir, env, encoding: "utf8" });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(readFileSync(env.TEST_SAVED_HELPER, "utf8"), expectedHelper);
  assert.ok(!existsSync(join(f.dir, "scripts/deployment/prepare-runtime-data.sh")), "selected checkout predates the helper");
  writeFileSync(join(f.dir, "bin/ssh"), `#!/bin/sh
for arg do command=$arg; done
case "$command" in
  *" sh -s") cat >/dev/null; command=\${command%sh -s}; exec sh -c "$command sh '$TEST_REMOTE_ENTRY'" ;;
  *) exec sh -c "$command" ;;
esac
`);
  writeFileSync(join(f.dir, "bin/scp"), '#!/bin/sh\nprevious=\nfor arg do source=$previous; previous=$arg; done\ncp "$source" "${previous#*:}"\n');
  for (const name of ["ssh", "scp"]) chmodSync(join(f.dir, `bin/${name}`), 0o755);
  writeFileSync(env.TEST_REMOTE_ENTRY, 'set -eu\nhelper=$DEPLOY_RUNTIME_PREPARE\n[ -f "$helper" ]\ncmp "$helper" "$TEST_SAVED_HELPER"\nsh "$helper" "$TEST_DATA"\necho "$helper" > "$RUNNER_TEMP/received-helper"\n');
  const ssh = deploy.steps.find(step => step.name === "Deploy over SSH");
  const result = spawnSync("bash", ["-ec", ssh.run], { cwd: f.dir, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(f.data, "ops-reports")), "the transferred helper runs on the older checkout");
  assert.ok(!existsSync(readFileSync(join(saved, "received-helper"), "utf8").trim()), "transferred helper must be cleaned up");
});

for (const user of [undefined, "1000"]) {
  test(`development Compose permits cache writes with ${user ? "explicit" : "default"} uid and gid`, () => {
    const env = { ...process.env, SITE_DOMAIN: "localhost", WEB_URL: "http://localhost", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "test", CLERK_SECRET_KEY: "test", WS_INTERNAL_SECRET: "test", DUEL_INTERNAL_SECRET: "test", DISCORD_GUILD_ID: "test" };
    delete env.UID;
    delete env.GID;
    if (user) Object.assign(env, { UID: user, GID: user });
    const result = spawnSync("docker", ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml", "-f", "docker-compose.override.yml", "config", "--format", "json"], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const { services } = JSON.parse(result.stdout);
    for (const name of ["web", "ws", "duel", "worker"]) {
      assert.equal(services[name].user, user ? "1000:1000" : "0:0", name);
      assert.deepEqual(services[name].cap_drop ?? [], [], name);
      assert.deepEqual(services[name].security_opt ?? [], [], name);
    }
    assert.deepEqual(services.caddy.cap_drop, ["ALL"]);
    assert.deepEqual(services.caddy.security_opt, ["no-new-privileges:true"]);
  });
}
