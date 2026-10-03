// Materialize a branch-local engine snapshot without changing either donor.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "./env.mjs";
import { prepareManualData, verifyInstalledWrapper } from "./manual-data.mjs";
import { verifyEngineBundle } from "../../duel-server/dist/engine-bundle.js";

const [sourceArg, legacyArg] = process.argv.slice(2);
if (!sourceArg || !legacyArg) throw new Error("Usage: node stack/refresh-snapshot.mjs <source-snapshot> <legacy-engine-bundle>");
const source = resolve(sourceArg);
const legacy = resolve(legacyArg);
const target = join(repoRoot, "data/duel-engine-snap");
if (existsSync(target)) throw new Error(`Stop the slots and move the old snapshot aside before refreshing ${target}`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legacyRoot = join(repoRoot, "packages/duel-server/legacy-1v1");
const pins = readFileSync(join(legacyRoot, "expected-sha256.txt"), "utf8").trim().split("\n");
for (const line of pins) {
  const [expected, file] = line.trim().split(/\s+/);
  if (hash(readFileSync(join(legacy, file))) !== expected) throw new Error(`Legacy file ${file} does not match expected-sha256.txt`);
}
verifyInstalledWrapper();
mkdirSync(join(repoRoot, "data"), { recursive: true });
const temporary = mkdtempSync(join(repoRoot, "data/.snapshot-refresh-"));
try {
  // This existing tool verifies the checked-in wrapper patch and derives its manifest.
  // Its temporary directory links are never used as the final snapshot's scripts.
  const runtime = prepareManualData(source, { outputDirectory: join(temporary, "manifest") });
  const bundle = join(temporary, "bundle");
  cpSync(source, bundle, { recursive: true, dereference: true });
  copyFileSync(join(runtime, "manifest.json"), join(bundle, "manifest.json"));
  for (const line of pins) {
    const [, file] = line.trim().split(/\s+/);
    copyFileSync(join(legacy, file), join(bundle, file));
  }
  const manifestPath = join(bundle, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sources.domainCoreLegacy = JSON.parse(readFileSync(join(legacyRoot, "domain-core/pins.json"), "utf8"));
  manifest.integrity.domainLegacyWasm = hash(readFileSync(join(bundle, "ocgcore.domain.legacy.wasm")));
  manifest.integrity.domainLegacyLua = hash(readFileSync(join(bundle, "card-scripts/domain.legacy.lua")));
  manifest.integrity.domainLegacyPatch = hash(Buffer.concat(["apply-domain-patch.mjs", "domain_master.cpp", "domain_master.h"].map((file) => readFileSync(join(legacyRoot, "domain-core/src", file)))));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // Refresh the repo overlay and bundleVersion through the normal resource tooling.
  const prepared = spawnSync("npm", ["run", "duel:prepare"], {
    cwd: repoRoot, stdio: "inherit", env: { ...process.env, DUEL_DATA_DIR: bundle },
  });
  if (prepared.error) throw prepared.error;
  if (prepared.status !== 0) throw new Error(`duel:prepare failed (${prepared.status})`);
  verifyEngineBundle(bundle, { engine: "pinned" });
  verifyEngineBundle(bundle, { engine: "legacy" });
  renameSync(bundle, target);
  console.log(`[e2e] matching strict snapshot ready: ${target}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
