import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { stackFixture } from "./stack-fixture.ts";

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`prepare restores configuration and releases the lock on ${signal}`, async () => {
    const fixture = stackFixture();
    const child = spawn(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
      cwd: fixture.root, env: { ...fixture.env, FIXTURE_BLOCK_BUILD: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (bytes) => output += bytes);
    child.stderr.on("data", (bytes) => output += bytes);
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => child.once("close", (code, signal) => done({ code, signal })));
    let buildPid: number | undefined;
    let descendantPid: number | undefined;
    try {
      const deadline = Date.now() + 4000;
      while (!existsSync(fixture.at("build-child.pid")) && child.exitCode === null && Date.now() < deadline) await delay(20);
      assert.ok(existsSync(fixture.at("build-child.pid")), output);
      buildPid = Number(readFileSync(fixture.at("build-started"), "utf8"));
      descendantPid = Number(readFileSync(fixture.at("build-child.pid"), "utf8"));
      assert.equal(readFileSync(fixture.at("packages/web/tsconfig.json"), "utf8"), "Next changed config");
      child.kill(signal);
      const result = await Promise.race([closed, delay(6000, undefined, { ref: false }).then(() => { throw new Error("prepare did not stop"); })]);
      assert.equal(existsSync(fixture.at("packages/e2e/.stack-build-lock")), false, "interrupted prepare must release its lock");
      assert.equal(readFileSync(fixture.at("packages/web/next-env.d.ts"), "utf8"), "original Next types");
      assert.equal(readFileSync(fixture.at("packages/web/tsconfig.json"), "utf8"), "original config");
      assert.equal(statSync(fixture.at("packages/web/tsconfig.json")).mtimeMs, 1000);
      assert.equal(result.code, signal === "SIGINT" ? 130 : 143, output);
      assert.equal(existsSync(fixture.at("packages/web/.next-e2e-2/standalone/packages/web/.e2e-build.json")), false);
      // Allow the OS to reap children after the forwarded signal.
      for (let attempt = 0; attempt < 50; attempt++) {
        try { process.kill(descendantPid, 0); } catch { break; }
        await delay(20);
      }
      assert.throws(() => process.kill(descendantPid!, 0), { code: "ESRCH" });
    } finally {
      child.kill("SIGKILL");
      for (const pid of [buildPid, descendantPid]) if (pid !== undefined) {
        try { process.kill(pid, "SIGKILL"); } catch { /* Already stopped. */ }
      }
      await closed;
      fixture.cleanup();
    }
  });
}

for (const entry of ["prepare", "manual"]) {
  test(`${entry} refuses a running slot before invoking any build`, () => {
    const fixture = stackFixture();
    mkdirSync(fixture.at("packages/e2e/.stack-2"));
    writeFileSync(fixture.at("packages/e2e/.stack-2/supervisor.pid"), String(process.pid));
    try {
      const result = spawnSync(process.execPath, [fixture.at(`packages/e2e/stack/${entry}.mjs`)], {
        cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 4000,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /supervisor.*running|running.*supervisor/);
      assert.equal(existsSync(fixture.at("commands.jsonl")), false);
      assert.equal(readFileSync(fixture.at("packages/web/tsconfig.json"), "utf8"), "original config");
    } finally { fixture.cleanup(); }
  });
}

test("prepare refuses occupied ports even without a local supervisor pid", async () => {
  const fixture = stackFixture();
  const listener = net.createServer();
  await new Promise<void>((done) => listener.listen(0, done));
  const port = (listener.address() as net.AddressInfo).port;
  try {
    const child = spawn(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
      cwd: fixture.root, env: { ...fixture.env, E2E_WEB_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (bytes) => stderr += bytes);
    const code = await new Promise((done) => child.once("close", done));
    assert.notEqual(code, 0);
    assert.match(stderr, new RegExp(`Port ${port} is already in use`));
    assert.equal(existsSync(fixture.at("commands.jsonl")), false);
  } finally {
    await new Promise<void>((done) => listener.close(() => done()));
    fixture.cleanup();
  }
});

for (const [name, entry] of [["ws", "server.js"], ["duel-server", "server.js"], ["worker", "index.js"]]) {
  test(`parallel prepare rejects stale ${name} dist instead of rebuilding it`, () => {
    const fixture = stackFixture();
    utimesSync(fixture.at(`packages/${name}/dist/${entry}`), 0, 0);
    try {
      const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
        cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 4000,
      });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`packages/${name}/dist is stale. Build it once before starting parallel slots.`), result.stderr);
      assert.equal(existsSync(fixture.at("commands.jsonl")), false);
    } finally { fixture.cleanup(); }
  });
}

test("forced parallel prepare rebuilds only slot web output with webpack", () => {
  const fixture = stackFixture();
  try {
    const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
      cwd: fixture.root, env: { ...fixture.env, E2E_FORCE_BUILD: "1" }, encoding: "utf8", timeout: 4000,
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(fixture.at("commands.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(commands, [
      ["exec", "--workspace=packages/web", "--", "next", "build", "--webpack"],
      ["run", "package:standalone", "--workspace=packages/web"],
    ]);
    assert.equal(readFileSync(fixture.at("packages/web/tsconfig.json"), "utf8"), "original config");
    assert.deepEqual(JSON.parse(readFileSync(fixture.at("web-build-env.json"), "utf8")), {
      e2eAuth: "1", clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    });
    const stamp = JSON.parse(readFileSync(fixture.at("packages/web/.next-e2e-2/standalone/packages/web/.e2e-build.json"), "utf8"));
    assert.equal(stamp.e2eAuth, true);
    assert.equal(stamp.clerkPublishableKey, "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k");
  } finally { fixture.cleanup(); }
});

for (const stamp of [
  { wsUrl: "http://localhost:0", builtAt: Date.now() + 60000 },
  { wsUrl: "http://localhost:0", builtAt: Date.now() + 60000, e2eAuth: false, clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" },
  { wsUrl: "http://localhost:0", builtAt: Date.now() + 60000, e2eAuth: true, clerkPublishableKey: "another-key" },
]) {
  test(`prepare rebuilds a fresh web output with incompatible auth stamp: ${JSON.stringify(stamp)}`, () => {
    const fixture = stackFixture();
    const output = "packages/web/.next-e2e-2/standalone/packages/web";
    mkdirSync(fixture.at(output), { recursive: true });
    writeFileSync(fixture.at(`${output}/server.js`), "server");
    writeFileSync(fixture.at(`${output}/.e2e-build.json`), JSON.stringify(stamp));
    try {
      const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
        cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 4000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(fixture.at("web-build-env.json")), "incompatible auth build must be rebuilt even when all inputs are older");
      const current = JSON.parse(readFileSync(fixture.at(`${output}/.e2e-build.json`), "utf8"));
      assert.equal(current.e2eAuth, true);
      assert.equal(current.clerkPublishableKey, "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k");
    } finally { fixture.cleanup(); }
  });
}

test("unset prepare still builds stale services and uses the ordinary web build", () => {
  const fixture = stackFixture();
  utimesSync(fixture.at("packages/ws/dist/server.js"), 0, 0);
  utimesSync(fixture.at("packages/duel-server/dist/server.js"), 0, 0);
  utimesSync(fixture.at("packages/worker/dist/index.js"), 0, 0);
  const { E2E_SLOT, ...env } = fixture.env;
  try {
    const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/prepare.mjs")], {
      cwd: fixture.root, env, encoding: "utf8", timeout: 4000,
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(fixture.at("commands.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(commands, [
      ["run", "build", "--workspace=packages/ws"],
      ["run", "build", "--workspace=packages/duel-server"],
      ["run", "build", "--workspace=packages/worker"],
      ["run", "build", "--workspace=packages/web"],
    ]);
  } finally { fixture.cleanup(); }
});
