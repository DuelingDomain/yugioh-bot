import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("Domain trap cores invalidate on Domain source and full-series patch edits", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-core-key-"));
  try {
    const write = (file, text) => {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    write("packages/duel-server/domain-core/src/domain_master.cpp", "domain v1");
    write("packages/duel-server/domain-core/patches/0003-seats.patch", "seats v1");
    write("packages/duel-server/domain-core/expected-sha256.txt", "binary pin v1");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    const key = (target) => execFileSync(process.execPath, [new URL("./core-cache-key.mjs", import.meta.url).pathname, target], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: join(root, "outputs") },
    }).trim();
    const before = key("multi-domain-trap");
    assert.match(before, /^duel-engine-core-v1-multi-domain-trap-/);
    const trap = key("multi-trap");
    const reference = key("multi-ref");
    write("packages/duel-server/domain-core/src/domain_master.cpp", "domain v2");
    assert.notEqual(key("multi-domain-trap"), before);
    assert.equal(key("multi-trap"), trap);
    const changedDomain = key("multi-domain-trap");
    write("packages/duel-server/domain-core/patches/0003-seats.patch", "seats v2");
    assert.notEqual(key("multi-domain-trap"), changedDomain);
    assert.notEqual(key("multi-trap"), trap);
    assert.equal(key("multi-ref"), reference);
    const beforePinEdit = key("multi-domain-trap");
    write("packages/duel-server/domain-core/expected-sha256.txt", "binary pin v2");
    assert.notEqual(key("multi-domain-trap"), beforePinEdit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
