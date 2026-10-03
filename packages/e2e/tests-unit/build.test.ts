import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { isBuildFresh, withBuildLock, withPreservedFiles } from "../stack/build.mjs";
import { packageStandalone } from "../../web/scripts/package-standalone.mjs";

test("build freshness catches missing output and newer source/config/dependency files", () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-build-"));
  try {
    const source = resolve(root, "src/server.ts");
    const config = resolve(root, "tsconfig.json");
    const output = resolve(root, "dist/server.js");
    mkdirSync(resolve(root, "src"));
    mkdirSync(resolve(root, "dist"));
    writeFileSync(source, "source");
    writeFileSync(config, "{}");
    const inputs = [resolve(root, "src"), config];
    assert.equal(isBuildFresh(output, inputs), false);
    writeFileSync(output, "compiled");
    for (const file of [source, config]) utimesSync(file, 1, 1);
    utimesSync(output, 2, 2);
    assert.equal(isBuildFresh(output, inputs), true);
    utimesSync(config, 3, 3);
    assert.equal(isBuildFresh(output, inputs), false);
    utimesSync(config, 1, 1);
    utimesSync(source, 3, 3);
    assert.equal(isBuildFresh(output, inputs), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("web build lock excludes concurrent writers and releases after failure", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-build-lock-"));
  const directory = resolve(root, "lock");
  let active = 0;
  let peak = 0;
  try {
    await Promise.all([1, 2, 3].map(() => withBuildLock(directory, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((done) => setTimeout(done, 30));
      active--;
    })));
    assert.equal(peak, 1);
    await assert.rejects(withBuildLock(directory, () => { throw new Error("failed build"); }), /failed build/);
    await withBuildLock(directory, () => {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("web build lock recovers a dead holder's pid", () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-stale-lock-"));
  const directory = resolve(root, "lock");
  const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(exited.status, 0);
  assert.throws(() => process.kill(exited.pid, 0), { code: "ESRCH" });
  mkdirSync(directory);
  writeFileSync(resolve(directory, "pid"), String(exited.pid));
  try {
    const script = `
      import { withBuildLock } from ${JSON.stringify(new URL("../stack/build.mjs", import.meta.url).href)};
      import { readFileSync } from 'node:fs';
      await withBuildLock(${JSON.stringify(directory)}, () => {
        if (readFileSync(${JSON.stringify(resolve(directory, "pid"))}, 'utf8') !== String(process.pid)) throw new Error('wrong owner');
        console.log('recovered');
      });
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 2000 });
    assert.equal(result.status, 0, `stale lock was not recovered: ${result.error?.message ?? result.stderr}`);
    assert.match(result.stdout, /recovered/);
    assert.equal(existsSync(directory), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("web build lock waits beyond ten minutes while the holder is alive", () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-live-lock-"));
  const directory = resolve(root, "lock");
  mkdirSync(directory);
  writeFileSync(resolve(directory, "pid"), String(process.pid));
  try {
    const script = `
      import { withBuildLock } from ${JSON.stringify(new URL("../stack/build.mjs", import.meta.url).href)};
      import { rmSync } from 'node:fs';
      let clock = 0;
      Date.now = () => (clock += 11 * 60_000);
      setTimeout(() => rmSync(${JSON.stringify(directory)}, { recursive: true, force: true }), 150);
      await withBuildLock(${JSON.stringify(directory)}, () => console.log('waited'));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 2000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /waited/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("web build lock retains a bounded wait when the holder pid is missing", () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-missing-pid-"));
  const directory = resolve(root, "lock");
  mkdirSync(directory);
  try {
    const script = `
      import { withBuildLock } from ${JSON.stringify(new URL("../stack/build.mjs", import.meta.url).href)};
      let clock = 0;
      Date.now = () => (clock += 11 * 60_000);
      await withBuildLock(${JSON.stringify(directory)}, () => {});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 2000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Timed out waiting for web build lock/);
    assert.equal(existsSync(directory), true, "must not remove a lock with an unknown owner");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cancelling a lock waiter leaves the live holder's lock intact", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-cancel-lock-"));
  const directory = resolve(root, "lock");
  const controller = new AbortController();
  mkdirSync(directory);
  writeFileSync(resolve(directory, "pid"), String(process.pid));
  try {
    const waiting = withBuildLock(directory, () => assert.fail("cancelled waiter acquired lock"), { signal: controller.signal });
    controller.abort();
    await assert.rejects(waiting, { name: "AbortError" });
    assert.equal(readFileSync(resolve(directory, "pid"), "utf8"), String(process.pid));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("standalone packaging follows both default and slot output paths", async () => {
  const webRoot = mkdtempSync(resolve(tmpdir(), "e2e-package-"));
  try {
    mkdirSync(resolve(webRoot, "public"));
    writeFileSync(resolve(webRoot, "public/card.png"), "public asset");
    for (const distDir of [".next", ".next-e2e-2"]) {
      const standalone = resolve(webRoot, distDir, "standalone/packages/web");
      mkdirSync(standalone, { recursive: true });
      mkdirSync(resolve(webRoot, distDir, "static"));
      writeFileSync(resolve(standalone, "server.js"), "server");
      writeFileSync(resolve(webRoot, distDir, "static/client.js"), distDir);
      await packageStandalone({ webRoot, distDir });
      assert.equal(readFileSync(resolve(standalone, distDir, "static/client.js"), "utf8"), distDir);
      assert.equal(readFileSync(resolve(standalone, "public/card.png"), "utf8"), "public asset");
    }
  } finally { rmSync(webRoot, { recursive: true, force: true }); }
});

test("slot builds restore generated config even on failure without touching unchanged mtimes", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "e2e-preserve-"));
  const config = resolve(root, "tsconfig.json");
  const generated = resolve(root, "next-env.d.ts");
  try {
    writeFileSync(config, "original");
    utimesSync(config, 1, 1);
    await withPreservedFiles([config, generated], () => {});
    assert.equal(statSync(config).mtimeMs, 1000);
    await withPreservedFiles([config], () => {
      writeFileSync(config, "original");
      utimesSync(config, 2, 2);
    });
    assert.equal(statSync(config).mtimeMs, 1000, "identical-byte rewrites must retain the original mtime");
    await assert.rejects(withPreservedFiles([config, generated], () => {
      writeFileSync(config, "Next modified this");
      writeFileSync(generated, "new file");
      throw new Error("failed build");
    }), /failed build/);
    assert.equal(readFileSync(config, "utf8"), "original");
    assert.equal(statSync(config).mtimeMs, 1000, "restoring config must not stale other slots' stamps");
    assert.equal(existsSync(generated), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
