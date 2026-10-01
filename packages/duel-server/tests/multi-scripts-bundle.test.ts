import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory) }).bundleVersion).toBe("v1");
  });

  it("accepts an older bundle without integrity.multiScripts", () => {
    const directory = bundle({});
    expect(verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory) }).bundleVersion).toBe("v1");
  });

  it("rejects a folder that changed", () => {
    const source = makeOverlay([{ code: 1, text: "A" }]);
    const directory = bundle({ multiScripts: multiScriptsFolderHash(source) }, source);
    writeFileSync(join(directory, "multi-scripts", "c1.lua"), "changed");
    expect(() => verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory) })).toThrow(/does not match manifest integrity\.multiScripts.*duel:prepare/);
  });

  it("rejects a missing folder when the manifest lists it", () => {
    const directory = bundle({ multiScripts: sha("x") });
    expect(() => verifyEngineBundle(directory, { wrapperPath: wrapperPath(directory) })).toThrow(/Multi-scripts folder is missing at .*multi-scripts.*duel:prepare/);
  });
});
