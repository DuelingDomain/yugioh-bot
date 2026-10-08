// Copy CI build outputs into an already prepared base bundle, with checked build provenance.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const bundle = process.argv[2];
if (!bundle) throw new Error("usage: node package-deploy-multi-cores.mjs <prepared-bundle-directory>");
const coreRoot = join(root, "packages/duel-server/domain-core");
const pins = JSON.parse(readFileSync(join(coreRoot, "pins.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const patches = readdirSync(join(coreRoot, "patches")).filter((name) => /^\d{4}-.*\.patch$/.test(name)).sort();
const seriesHash = hash(Buffer.concat(patches.map((name) => readFileSync(join(coreRoot, "patches", name)))));
const domainLayer = hash(readFileSync(join(coreRoot, "src/apply-domain-multi.mjs")));
const deployedBy = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

// Validate both before copying either. Cache restores must include build metadata.
const cores = ["multi", "multi-domain"].map((mode) => {
  const stem = `ocgcore.${mode}`;
  const info = JSON.parse(readFileSync(join(coreRoot, "dist", `${stem}-build-info.json`), "utf8"));
  assert.match(info.builderCommit ?? "", /^[0-9a-f]{40}$/, `${stem} builderCommit is missing or invalid`);
  assert.equal(info.ygoproCore, pins.ygoproCore.commit);
  assert.equal(info.ocgcoreWasm, pins.ocgcoreWasm.ref);
  assert.equal(info.lua, pins.lua.commit);
  assert.equal(info.emscripten, "4.0.9");
  assert.equal(info.patches, patches.length);
  assert.equal(info.luaFixedSeed, 0, "deploy must not use LUA_FIXED_SEED");
  assert.equal(info.applyDomain, mode === "multi-domain" ? 1 : undefined);
  assert.equal(info.domainMulti, mode === "multi-domain" ? domainLayer : undefined);
  const path = join(coreRoot, "dist", `${stem}.sync.wasm`);
  const bytes = readFileSync(path);
  assert.ok(WebAssembly.validate(bytes), `${stem} is not a valid wasm module`);
  return { stem, path, sha: hash(bytes), info };
});

for (const { stem, path, sha, info } of cores) {
  copyFileSync(path, join(bundle, `${stem}.wasm`));
  writeFileSync(join(bundle, `${stem}.sha256`), `${sha}  ${stem}.wasm\n`);
  writeFileSync(join(bundle, `${stem}.SOURCE`), [
    `tag=deploy-${deployedBy.slice(0, 12)}`,
    `builtBy=${info.builderCommit}`,
    `deployedBy=${deployedBy}`,
    `sha256=${sha}`,
    "capabilities=ffa4-facing-extra-zones,tag-facing-extra-zones",
    `patches=${patches.length}`,
    `seriesSha256=${seriesHash}`,
    `ygoproCore=${info.ygoproCore}`,
    `ocgcoreWasm=${info.ocgcoreWasm}`,
    `lua=${info.lua}`,
    `emsdk=${pins.emscripten.image}@${pins.emscripten.digest}`,
    ...(info.domainMulti ? [`domainMulti=${info.domainMulti}`] : []),
    "note=production build; full patch series; no LUA_FIXED_SEED",
    "",
  ].join("\n"));
  console.log(`${stem}.wasm sha256 ${sha} (${patches.length} patches, builtBy=${info.builderCommit} deployedBy=${deployedBy})`);
}
