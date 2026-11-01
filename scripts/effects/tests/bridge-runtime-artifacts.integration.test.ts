import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
it("rebuilds the small mechanic facts artifact deterministically from the committed tags", () => {
  const directory = mkdtempSync(join(tmpdir(), "bridge-mechanic-facts-"));
  try {
    const output = join(directory, "facts.json");
    execFileSync(join(root, "node_modules/.bin/tsx"), ["scripts/effects/build-bridge-mechanic-facts.ts",
      "packages/shared/data/effects/tags.jsonl.gz", output], { cwd: root });
    const bytes = readFileSync(output);
    expect(bytes.length).toBeLessThan(250_000);
    expect(bytes).toEqual(readFileSync(join(root, "packages/shared/data/effects/bridge-mechanic-facts.json")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("imports shared code without discovery reads, checks mechanics without full tags, and logs missing observations once", () => {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { gunzipSync } from "node:zlib";
    import assert from "node:assert/strict";
    const root = ${JSON.stringify(root)};
    const read = fs.readFileSync;
    const manifest = JSON.parse(read(root + "packages/shared/data/effects/bridges-manifest.json"));
    const capabilities = gunzipSync(read(root + "packages/shared/data/effects/card-capabilities.jsonl.gz"))
      .toString().trim().split("\\n").map(line => JSON.parse(line));
    const reads = [], warnings = [];
    fs.readFileSync = function(path, ...args) {
      const name = String(path);
      if (/tags.jsonl.gz|bridge-observations.json|bridge-mechanic-facts.json/.test(name)) reads.push(name);
      if (/tags.jsonl.gz|bridge-observations.json/.test(name)) throw Object.assign(Error("fixture missing"), {code:"ENOENT"});
      return read.call(this, path, ...args);
    };
    console.warn = (...args) => warnings.push(args);
    syncBuiltinESMExports();
    const shared = await import(root + "packages/shared/dist/cards/effects/index.js");
    assert.deepEqual(reads, []);
    const engine = new shared.BridgeEngine({...manifest, capabilities});
    const start = performance.now();
    assert.equal(engine.synergyBetween("Odion", "Labrynth").reasons[0].mechanic.key, "trap_activation");
    const elapsed = performance.now() - start;
    assert.equal(reads.filter(path => /tags.jsonl.gz|bridge-observations.json/.test(path)).length, 0);
    assert.equal(reads.filter(path => /bridge-mechanic-facts.json/.test(path)).length, 1);
    assert.equal(shared.bridgeObservations(), null);
    assert.equal(shared.bridgeObservations(), null);
    assert.equal(reads.filter(path => /bridge-observations.json/.test(path)).length, 1);
    assert.equal(warnings.filter(args => String(args[0]).includes("observations unavailable")).length, 1);
    console.log(JSON.stringify({mechanicFirstPairMs: elapsed, discoveryReadsAtImport: 0, fullTagReads: 0}));
  `], { cwd: root, encoding: "utf8" });
  expect(JSON.parse(result)).toMatchObject({ discoveryReadsAtImport: 0, fullTagReads: 0 });
});

it("packages a web standalone tree without duel discovery artifacts", async () => {
  const { packageStandalone } = await import(new URL("../../../packages/web/scripts/package-standalone.mjs", import.meta.url).href);
  const directory = mkdtempSync(join(root, "packages/web/.next-bridge-trace-"));
  try {
    const standalone = join(directory, "standalone"), web = join(standalone, "packages/web");
    mkdirSync(web, { recursive: true }); mkdirSync(join(directory, "static"));
    writeFileSync(join(web, "server.js"), "// standalone packaging fixture\n");
    for (const file of ["effects/tags.jsonl.gz", "effects/bridge-mechanic-facts.json", "staples/bridge-observations.json"]) {
      const path = join(standalone, "packages/shared/data", file);
      mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, "stale traced artifact");
    }
    await packageStandalone({ webRoot: join(root, "packages/web"), distDir: basename(directory) });
    for (const file of ["effects/tags.jsonl.gz", "effects/bridge-mechanic-facts.json", "staples/bridge-observations.json"])
      expect(existsSync(join(standalone, "packages/shared/data", file)), file).toBe(false);
    expect(existsSync(join(standalone, "packages/shared/data/staples/usage.json"))).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
