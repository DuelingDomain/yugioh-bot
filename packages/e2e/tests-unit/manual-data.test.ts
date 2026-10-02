import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareManualData } from "../stack/manual-data.mjs";

test("manual bundle pins the verified local wrapper while preserving the core snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-manual-core-"));
  const source = join(dir, "snapshot");
  const output = join(dir, "runtime");
  const wrapper = join(dir, "wrapper.js");
  mkdirSync(source);
  writeFileSync(wrapper, "patched wrapper");
  const manifest = { sources: { corePackage: "fixture" }, integrity: { wrapper: "engine-branch-wrapper", standardWasm: "unchanged-core-hash", multiScripts: "overlay-hash" }, bundleVersion: "engine-branch-bundle" };
  const original = JSON.stringify(manifest);
  writeFileSync(join(source, "manifest.json"), original);
  writeFileSync(join(source, "ocgcore.multi.wasm"), "multi core bytes");
  mkdirSync(join(source, "multi-scripts"));
  writeFileSync(join(source, "multi-scripts", "rules.lua"), "snapshot rules");
  try {
    const runtime = prepareManualData(source, { outputDirectory: output, wrapperPath: wrapper, verifyWrapper: () => {} });
    assert.equal(runtime, output);
    assert.equal(readFileSync(join(source, "manifest.json"), "utf8"), original);
    assert.equal(realpathSync(join(runtime, "ocgcore.multi.wasm")), join(source, "ocgcore.multi.wasm"));
    assert.equal(readFileSync(join(runtime, "multi-scripts", "rules.lua"), "utf8"), "snapshot rules");
    const pinned = JSON.parse(readFileSync(join(runtime, "manifest.json"), "utf8"));
    const hash = createHash("sha256").update("patched wrapper").digest("hex");
    assert.equal(pinned.integrity.wrapper, hash);
    assert.equal(pinned.integrity.standardWasm, "unchanged-core-hash");
    assert.equal(pinned.integrity.multiScripts, "overlay-hash");
    const version = createHash("sha256").update(JSON.stringify({ sources: manifest.sources, integrity: { wrapper: hash, standardWasm: "unchanged-core-hash" } })).digest("hex");
    assert.equal(pinned.bundleVersion, version);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("manual bundle refuses to repin a wrapper that fails patch verification", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-manual-bad-wrapper-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ integrity: { wrapper: "different" } }));
  writeFileSync(join(dir, "wrapper.js"), "unverified wrapper");
  try {
    assert.throws(() => prepareManualData(dir, { outputDirectory: join(dir, "runtime"), wrapperPath: join(dir, "wrapper.js"), verifyWrapper: () => { throw new Error("patch verification failed"); } }), /patch verification failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
