import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { stackFixture } from "./stack-fixture.ts";

function runtimeFixture() {
  const fixture = stackFixture();
  writeFileSync(fixture.at("packages/e2e/stack/seed.mjs"), "export async function seedDatabase() {};");
  writeFileSync(fixture.at("packages/e2e/stack/manual-data.mjs"), "export const prepareManualData = (dir) => dir;");
  mkdirSync(fixture.at("data/duel-engine-next"), { recursive: true });
  writeFileSync(fixture.at("data/duel-engine-next/cards.cdb"), "fixture");
  const output = "packages/web/.next-e2e-2/standalone/packages/web";
  mkdirSync(fixture.at(output), { recursive: true });
  for (const [name, entry] of [["ws", "packages/ws/dist/server.js"], ["duel", "packages/duel-server/dist/server.js"], ["web", `${output}/server.js`]]) {
    writeFileSync(fixture.at(entry), `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(fixture.at(`${name}.ready`))}, JSON.stringify({ pid: process.pid, issuesDir: process.env.DUEL_ISSUES_DIR }));
      setInterval(() => {}, 1000);
    `);
  }
  return fixture;
}

test("supervisor claims its pid after preparation and removes it after shutdown", async () => {
  const fixture = runtimeFixture();
  const lock = fixture.at("packages/e2e/.stack-build-lock");
  const pidFile = fixture.at("packages/e2e/.stack-2/supervisor.pid");
  mkdirSync(lock);
  writeFileSync(`${lock}/pid`, String(process.pid));
  const child = spawn(process.execPath, [fixture.at("packages/e2e/stack/start.mjs")], {
    cwd: fixture.root, env: fixture.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (bytes) => output += bytes);
  child.stderr.on("data", (bytes) => output += bytes);
  const closed = new Promise((done) => child.once("close", done));
  try {
    let deadline = Date.now() + 4000;
    while (!output.includes("waiting for another web build") && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.match(output, /waiting for another web build/);
    assert.equal(existsSync(pidFile), false, "must wait for preparation before claiming a running stack");
    rmSync(lock, { recursive: true });
    deadline = Date.now() + 4000;
    while (!["ws", "duel", "web"].every((name) => existsSync(fixture.at(`${name}.ready`))) && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.ok(["ws", "duel", "web"].every((name) => existsSync(fixture.at(`${name}.ready`))), output);
    assert.equal(readFileSync(pidFile, "utf8"), String(child.pid));
    const duplicate = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/start.mjs")], {
      cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 4000,
    });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /supervisor.*running/);
    child.kill("SIGTERM");
    assert.equal(await closed, 0, output);
    assert.equal(existsSync(pidFile), false);
    for (const name of ["ws", "duel", "web"]) {
      const { pid } = JSON.parse(readFileSync(fixture.at(`${name}.ready`), "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  } finally {
    child.kill("SIGTERM");
    // Release only our test lock if an assertion failed while start was waiting.
    rmSync(lock, { recursive: true, force: true });
    await closed;
    fixture.cleanup();
  }
});

test("supervisor removes its pid when startup fails", () => {
  const fixture = runtimeFixture();
  writeFileSync(fixture.at("packages/e2e/stack/seed.mjs"), "export async function seedDatabase() { throw new Error('fixture seed failed'); }");
  try {
    const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/start.mjs")], {
      cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 4000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fixture seed failed/);
    assert.equal(existsSync(fixture.at("packages/e2e/.stack-2/supervisor.pid")), false);
    assert.equal(existsSync(fixture.at("packages/e2e/.stack-build-lock")), false);
  } finally { fixture.cleanup(); }
});
