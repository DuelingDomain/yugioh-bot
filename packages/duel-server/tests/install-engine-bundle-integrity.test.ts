import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, incompleteFixture, run, sha, snapshot } from "./helpers/install-engine-bundle.js";

describe("install-engine-bundle.sh patched card scripts", () => {
  it.each(["stock", "missing script", "missing receipt", "empty receipt", "invalid receipt", "unsafe path"])("refuses %s in the incoming bundle before writing", kind => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const script = join(f.src, "card-scripts/official/c3743515.lua");
    const receipt = join(f.src, "card-scripts/.host-card-script-patches.json");
    if (kind === "stock") writeFileSync(script, "-- stock\n");
    if (kind === "missing script") rmSync(script);
    if (kind === "missing receipt") rmSync(receipt);
    if (kind === "empty receipt") writeFileSync(receipt, "[]");
    if (kind === "invalid receipt") writeFileSync(receipt, "{}");
    if (kind === "unsafe path") writeFileSync(receipt, JSON.stringify([{ stockPath: "../manifest.json" }]));
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toContain("cardScriptPatches");
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it("repairs an installed stock script even when the manifest is identical", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, []);
    const path = "card-scripts/official/c3743515.lua";
    writeFileSync(join(f.dst, path), "-- stock\n");
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, path), "utf8")).toBe(readFileSync(join(f.src, path), "utf8"));
  });

  it("refuses repair of an installed stock script while a duel is active", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, [{ format: "1v1", status: "active" }]);
    const path = join(f.dst, "card-scripts/official/c3743515.lua");
    writeFileSync(path, "-- stock\n");
    for (const preflight of [true, false]) {
      expect(run(f, preflight).status).toBe(1);
      expect(readFileSync(path, "utf8")).toBe("-- stock\n");
    }
  });
});

describe("install-engine-bundle.sh and the legacy 1v1 engine files", () => {
  it.each([
    ["has no legacy files", false],
    ["has a legacy wasm that does not match integrity.domainLegacyWasm", "bad-hash"],
  ] as const)("refuses a bundle that %s", (_name, legacy) => {
    const f = incompleteFixture(legacy);
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toMatch(/bundle source is incomplete/);
    }
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("installs the legacy files with the bundle", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.domain.legacy.wasm"), "utf8")).toBe("legacy domain");
    expect(readFileSync(join(f.dst, "card-scripts", "domain.legacy.lua"), "utf8")).toBe("-- legacy domain");
  });
});

it.each([true,false])("refuses a missing/corrupt prerelease remap artifact before installation (preflight=%s)",preflight=>{
 const f=fixture({tag:"old"},{tag:"new"},[]),before=snapshot(f.dst);
 const path=join(f.src,"manifest.json"),manifest=JSON.parse(readFileSync(path,"utf8"));
 manifest.sources={databaseFormat:"official-releases-prerelease-v1"};manifest.integrity.cardRemaps=sha("valid-remaps");
 writeFileSync(path,JSON.stringify(manifest));
 expect(run(f,preflight).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
 writeFileSync(join(f.src,"card-remaps.json"),"corrupt-remaps");
 expect(run(f,preflight).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
 writeFileSync(join(f.src,"card-remaps.json"),"valid-remaps");
 expect(run(f,preflight).status).toBe(0);
});


it.each(["official-releases-prerelease-v1","official-releases-prerelease-v2"])("refuses the %s recipe without a remap hash", format=>{
 const f=fixture({tag:"old"},{tag:"new"},[]),before=snapshot(f.dst);
 const path=join(f.src,"manifest.json"),manifest=JSON.parse(readFileSync(path,"utf8"));
 manifest.sources={databaseFormat:format};delete manifest.integrity.cardRemaps;
 writeFileSync(path,JSON.stringify(manifest));
 expect(run(f,true).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
});
