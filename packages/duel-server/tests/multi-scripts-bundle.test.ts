import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyEngineBundle } from "../src/engine-bundle.js";
import { installMultiScripts, multiScriptsFolderHash } from "../src/multi-scripts.js";
import { makeOverlay, removeOverlays } from "./support/multi-scripts.js";

const temporary: string[] = [];
const temp = (stem: string) => {
  const directory = mkdtempSync(join(tmpdir(), stem));
  temporary.push(directory);
  return directory;
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

afterEach(() => {
  removeOverlays();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("verifyEngineBundle and integrity.multiScripts", () => {
  function bundle(integrity: Record<string, string>, folder?: string) {
    const directory = temp("ms-bundle-");
    for (const [name, content] of Object.entries({ "ocgcore.standard.wasm": "s", "ocgcore.domain.wasm": "d", "cards.cdb": "c" })) writeFileSync(join(directory, name), content);
    mkdirSync(join(directory, "card-scripts"));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "v1", integrity }));
    if (folder) installMultiScripts(directory, folder);
    return directory;
  }
  const wrapperPath = (directory: string) => {
    writeFileSync(join(directory, "wrapper"), "w");
    return join(directory, "wrapper");
  };

  it("accepts a matching folder hash", () => {
    const source = makeOverlay([{ code: 1, text: "A" }]);
    const directory = bundle({ multiScripts: multiScriptsFolderHash(source) }, source);
    expect(verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory), engine: "pinned" }).bundleVersion).toBe("v1");
  });

  it("accepts an older bundle without integrity.multiScripts", () => {
    const directory = bundle({});
    expect(verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory), engine: "pinned" }).bundleVersion).toBe("v1");
  });

  it("rejects a folder that changed", () => {
    const source = makeOverlay([{ code: 1, text: "A" }]);
    const directory = bundle({ multiScripts: multiScriptsFolderHash(source) }, source);
    writeFileSync(join(directory, "multi-scripts", "c1.lua"), "changed");
    expect(() => verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory), engine: "pinned" })).toThrow(/does not match manifest integrity\.multiScripts.*duel:prepare/);
  });

  it("rejects a missing folder when the manifest lists it", () => {
    const directory = bundle({ multiScripts: sha("x") });
    expect(() => verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory), engine: "pinned" })).toThrow(/Multi-scripts folder is missing at .*multi-scripts.*duel:prepare/);
  });
});

// scripts/install-engine-bundle.sh computes the folder hash in sh. A difference from multiScriptsFolderHash would
// refuse a good bundle at deploy time, so it is tested here: the manifest hash comes from the TS function.
describe("install-engine-bundle.sh and integrity.multiScripts", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "install-engine-bundle.sh");
  // Names that sort differently by locale and by byte: c1.lua before c10.lua, a nested folder, an upper case name.

  function sourceBundle(options: { folder?: boolean; hash?: string } = {}) {
    const directory = temp("ms-src-");
    for (const [name, content] of Object.entries({ "ocgcore.standard.wasm": "s", "ocgcore.domain.wasm": "d", "cards.cdb": "c", "strings.conf": "t" })) writeFileSync(join(directory, name), content);
    mkdirSync(join(directory, "card-scripts"));
    writeFileSync(join(directory, "card-scripts", "domain.lua"), "-- domain");
    writeFileSync(join(directory, "ocgcore.domain.legacy.wasm"), "legacy domain");
    writeFileSync(join(directory, "card-scripts", "domain.legacy.lua"), "-- legacy domain");
    const overlay = makeOverlay([{ code: 1, text: "A" }, { code: 10, text: "B" }, { code: 2, text: "C" }], { files: { "sub/deep/x.lua": "D", "sub/a.lua": "E", "Z.txt": "F" } });
    if (options.folder !== false) installMultiScripts(directory, overlay);
    const hash = options.hash ?? multiScriptsFolderHash(overlay);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "v1", integrity: { multiScripts: hash, domainLegacyWasm: sha("legacy domain"), domainLegacyLua: sha("-- legacy domain") } }, null, 2) + "\n");
    return directory;
  }

  function install(source: string) {
    const parent = temp("ms-dst-");
    const destination = join(parent, "duel-engine");
    const run = spawnSync("sh", [script], { env: { PATH: process.env.PATH ?? "", DUEL_BUNDLE_SRC: source, DUEL_DATA_DIR: destination }, encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}`, destination };
  }

  it("installs a good bundle: the sh hash equals the TS hash, nested folders and c1 against c10 included", () => {
    const result = install(sourceBundle());
    expect(result.output).toContain("installed duel-engine bundle");
    expect(result.status).toBe(0);
    expect(existsSync(join(result.destination, "multi-scripts", "sub", "deep", "x.lua"))).toBe(true);
  });

  it("refuses a bundle whose overlay file changed after the manifest was written", () => {
    const source = sourceBundle();
    writeFileSync(join(source, "multi-scripts", "c10.lua"), "changed");
    const result = install(source);
    expect(result.status).toBe(1);
    expect(result.output).toContain("multi-scripts hash does not match manifest integrity.multiScripts");
    expect(existsSync(result.destination)).toBe(false);
  });

  it("refuses a bundle whose manifest has the wrong overlay hash", () => {
    const result = install(sourceBundle({ hash: sha("x") }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("multi-scripts hash does not match manifest integrity.multiScripts");
  });

  it("refuses a bundle with no overlay folder", () => {
    const result = install(sourceBundle({ folder: false }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("multi-scripts folder is missing or incomplete");
  });
});
