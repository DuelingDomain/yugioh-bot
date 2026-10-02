import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("report CLI selects the slot folder and preserves explicit paths and options", () => {
  const bin = mkdtempSync(resolve(tmpdir(), "e2e-report-bin-"));
  const e2eRoot = fileURLToPath(new URL("../", import.meta.url));
  try {
    // Observe CLI arguments without launching an HTTP report server.
    const npm = resolve(bin, "npm");
    writeFileSync(npm, "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n");
    chmodSync(npm, 0o755);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("E2E_")) delete env[key];
    const run = (args: string[]) => {
      const result = spawnSync(process.execPath, ["stack/report.mjs", ...args], {
        cwd: e2eRoot, env: { ...env, E2E_SLOT: "2", PATH: `${bin}${delimiter}${process.env.PATH}` }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).slice(5);
    };
    const folder = resolve(e2eRoot, ".stack-2/playwright-report");
    assert.deepEqual(run([]), [folder]);
    assert.deepEqual(run(["/path/to/old-report"]), ["/path/to/old-report"]);
    assert.deepEqual(run(["--host", "127.0.0.1", "--port", "9324"]), [folder, "--host", "127.0.0.1", "--port", "9324"]);
  } finally { rmSync(bin, { recursive: true, force: true }); }
});
