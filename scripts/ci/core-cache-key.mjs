import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";

const target = process.argv[2];
const pkg = "packages/duel-server/";
const inputs = ["scripts/ci/core-cache-key.mjs", "scripts/ci/build-core.sh", "scripts/ci/parallel-emxx.py", "scripts/ci/bin/em++", pkg + "domain-core/pins.json", "patches/ocgcore-wasm+0.1.2.patch", "package-lock.json"];
if (target !== "legacy-domain") inputs.push(pkg + "domain-core/expected-sha256.txt");
if (target === "legacy-domain") inputs.push(pkg + "legacy-1v1/");
else if (target === "standard" || target === "domain") {
  inputs.push(pkg + `scripts/build-${target}-core.sh`, pkg + "domain-core/src/apply-core-fixes.mjs");
  if (target === "domain") inputs.push(pkg + "domain-core/src/apply-domain-patch.mjs", pkg + "domain-core/src/domain_master.cpp", pkg + "domain-core/src/domain_master.h", pkg + "domain-core/lua/");
} else if (["multi", "multi-domain", "multi-ref", "multi-ref-domain", "multi-trap", "multi-domain-trap"].includes(target)) {
  inputs.push(pkg + "scripts/build-multi-core.sh", pkg + "scripts/prepare-multi-core-tree.sh", pkg + "scripts/multi-core-common.sh");
  inputs.push(...(target.startsWith("multi-ref") ? [pkg + "domain-core/patches/0001-*.patch", pkg + "domain-core/patches/0002-*.patch"] : [pkg + "domain-core/patches/*.patch"]));
  if (target.includes("domain")) inputs.push(pkg + "domain-core/src/");
} else throw new Error(`unknown core target: ${target}`);
const files = execFileSync("git", ["ls-files", "-z", "--", ...inputs], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
const hash = createHash("sha256");
for (const file of files) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
const key = `duel-engine-core-v1-${target}-${hash.digest("hex")}`;
console.log(key);
appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`);
