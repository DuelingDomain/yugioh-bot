import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("web build lock recovers an interrupted stale-lock recovery", () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-dead-recovery-"));
  const directory = resolve(root, "lock");
  const exited = spawnSync(process.execPath, ["-e", ""]);
  for (const lock of [directory, `${directory}.recovery`]) {
    mkdirSync(lock);
    writeFileSync(resolve(lock, "pid"), String(exited.pid));
  }
  try {
    const script = `
      const { withBuildLock } = await import(${JSON.stringify(new URL("../stack/build.mjs", import.meta.url).href)});
      await withBuildLock(${JSON.stringify(directory)}, () => console.log('recovered'));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 2000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /recovered/);
    assert.deepEqual(readdirSync(root), [], "recovery locks and detached directories must be cleaned up");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stale-lock recovery remains exclusive across processes during deletion", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-recovery-race-"));
  const directory = resolve(root, "lock");
  const exited = spawnSync(process.execPath, ["-e", ""]);
  mkdirSync(directory);
  writeFileSync(resolve(directory, "pid"), String(exited.pid));
  const children: ReturnType<typeof spawn>[] = [];
  const results: Promise<{ code: number | null; output: string }>[] = [];
  const run = (name: string, pause: boolean) => {
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const directory = ${JSON.stringify(directory)};
      const originalRemove = fs.rmSync;
      const originalRename = fs.renameSync;
      let paused = false;
      function pauseBeforeRemoval(path) {
        if (${pause} && path === directory && !paused) {
          paused = true;
          fs.writeFileSync(${JSON.stringify(resolve(root, "before-delete"))}, 'ready');
          while (!fs.existsSync(${JSON.stringify(resolve(root, "continue-delete"))})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      fs.rmSync = function(path, options) {
        pauseBeforeRemoval(path);
        return originalRemove(path, options);
      };
      fs.renameSync = function(from, to) {
        pauseBeforeRemoval(from);
        return originalRename(from, to);
      };
      syncBuiltinESMExports();
      const { withBuildLock } = await import(${JSON.stringify(new URL("../stack/build.mjs", import.meta.url).href)});
      await withBuildLock(directory, async () => {
        if (fs.existsSync(${JSON.stringify(resolve(root, name === "first" ? "second.active" : "first.active"))})) throw new Error('overlapping builds');
        fs.writeFileSync(${JSON.stringify(resolve(root, `${name}.active`))}, 'active');
        await new Promise(done => setTimeout(done, 500));
        fs.rmSync(${JSON.stringify(resolve(root, `${name}.active`))});
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let output = "";
    child.stdout!.on("data", (bytes) => output += bytes);
    child.stderr!.on("data", (bytes) => output += bytes);
    results.push(new Promise((done) => child.once("close", (code) => done({ code, output }))));
  };
  try {
    run("first", true);
    const deadline = Date.now() + 4000;
    while (!existsSync(resolve(root, "before-delete")) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(resolve(root, "before-delete")), "first waiter did not reach stale removal");
    run("second", false);
    // Give the second waiter time to acquire the lock if recovery is unprotected.
    await delay(200);
    writeFileSync(resolve(root, "continue-delete"), "continue");
    const completed = await Promise.race([
      Promise.all(results),
      delay(5000, undefined, { ref: false }).then(() => { throw new Error("recovery waiters did not complete"); }),
    ]);
    for (const result of completed) assert.equal(result.code, 0, result.output);
    assert.equal(existsSync(directory), false);
  } finally {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(results);
    rmSync(root, { recursive: true, force: true });
  }
});
