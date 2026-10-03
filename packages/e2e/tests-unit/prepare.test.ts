import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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
