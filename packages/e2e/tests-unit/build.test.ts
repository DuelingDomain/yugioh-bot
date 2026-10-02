import assert from "node:assert/strict";
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
