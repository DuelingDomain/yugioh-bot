import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const script = new URL("./build-core.sh", import.meta.url).pathname;
const fixture = (callback) => {
  const root = mkdtempSync(join(tmpdir(), "ci-core-verify-"));
  try {
    const write = (file, text, options) => {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text, options);
    };
    write("bin/docker", '#!/bin/sh\ntouch docker-called\nexit 99\n', { mode: 0o755 });
    const pins = JSON.stringify({ emscripten: { image: "test-image", digest: "sha256:test" } });
    write("packages/duel-server/domain-core/pins.json", pins);
    write("packages/duel-server/legacy-1v1/domain-core/pins.json", pins);
    write("packages/duel-server/scripts/check-legacy-pin.sh", "");
    copyFileSync(new URL("../../packages/duel-server/scripts/check-legacy-pin.sh", import.meta.url), join(root, "packages/duel-server/scripts/check-legacy-pin.sh"));
    const verify = (target) => spawnSync("bash", [script, target, "--verify-only"], {
      cwd: root, encoding: "utf8", env: { ...process.env, CI_CORE_OUTPUT: "ci-core", PATH: `${join(root, "bin")}:${process.env.PATH}` },
    });
    callback({ root, write, verify });
    assert.equal(existsSync(join(root, "docker-called")), false, "cache verification must not start Docker");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("restored Domain and multiplayer cores must match the checked-in binary pins", () => fixture(({ root, write, verify }) => {
  const targets = ["domain", "multi", "multi-domain"];
  write("packages/duel-server/domain-core/expected-sha256.txt", targets.map((target) => `${hash("expected wasm")}  ocgcore.${target}.sync.wasm`).join("\n") + "\n");
  for (const target of targets) {
    const wasm = `ci-core/${target}/dist/ocgcore.${target}.sync.wasm`;
    write(`ci-core/${target}/bundle/manifest.json`, "{}");
    write(wasm, "expected wasm");
    if (target === "domain") write("ci-core/domain/bundle/ocgcore.domain.wasm", "expected wasm");
    assert.equal(verify(target).status, 0);
    assert.equal(readFileSync(join(root, `ci-core/${target}/bundle/manifest.json`), "utf8"), "{}");
    write(wasm, "stale wasm");
    const mismatch = verify(target);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /sha256.*expected/i);
    if (target === "domain") {
      write(wasm, "expected wasm");
      write("ci-core/domain/bundle/ocgcore.domain.wasm", "stale bundle wasm");
      const staleBundle = verify(target);
      assert.equal(staleBundle.status, 1);
      assert.match(staleBundle.stderr, /bundle.*match/i);
    }
  }
}));

test("restored legacy cores and Lua must match main's expected-sha256 file", () => fixture(({ write, verify }) => {
  const wasm = "ci-core/legacy-domain/bundle/ocgcore.domain.legacy.wasm";
  const lua = "ci-core/legacy-domain/bundle/card-scripts/domain.legacy.lua";
  write("ci-core/legacy-domain/dist/placeholder", "");
  write(wasm, "legacy wasm");
  write(lua, "legacy lua");
  write("packages/duel-server/legacy-1v1/expected-sha256.txt", `${hash("legacy wasm")}  ocgcore.domain.legacy.wasm\n${hash("legacy lua")}  card-scripts/domain.legacy.lua\n`);
  assert.equal(verify("legacy-domain").status, 0);
  write(wasm, "stale wasm");
  const mismatch = verify("legacy-domain");
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /sha256.*expected/i);
  write(wasm, "legacy wasm");
  write(lua, "stale lua");
  assert.equal(verify("legacy-domain").status, 1);
}));

test("unpinned targets still require a nonempty core and report the missing binary pin", () => fixture(({ write, verify }) => {
  write("packages/duel-server/domain-core/expected-sha256.txt", "");
  for (const target of ["standard", "multi-ref", "multi-ref-domain", "multi-trap", "multi-domain-trap"]) {
    write(`ci-core/${target}/bundle/manifest.json`, "{}");
    const wasm = `ci-core/${target}/dist/ocgcore.${target}.sync.wasm`;
    write(wasm, "wasm without a fixed binary pin");
    if (target === "standard") write("ci-core/standard/bundle/ocgcore.standard.wasm", "wasm without a fixed binary pin");
    const checked = verify(target);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /no.*sha256 pin/i);
    write(wasm, "");
    const empty = verify(target);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /missing or empty/i);
  }
}));

test("CI binary pins preserve main's documented hashes", () => {
  const pins = readFileSync(new URL("../../packages/duel-server/domain-core/expected-sha256.txt", import.meta.url), "utf8");
  const docs = readFileSync(new URL("../../docs/deployment/staging.md", import.meta.url), "utf8");
  const labels = { domain: "Domain 1v1 (unchanged)", multi: "Standard multiplayer", "multi-domain": "Domain multiplayer" };
  for (const [target, label] of Object.entries(labels)) {
    const line = docs.split("\n").find((line) => line.startsWith(`| ${label} |`));
    const sha = line.match(/[a-f0-9]{64}/)[0];
    assert.ok(pins.includes(`${sha}  ocgcore.${target}.sync.wasm`));
  }
});
