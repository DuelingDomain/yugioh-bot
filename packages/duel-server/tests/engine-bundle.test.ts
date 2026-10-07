import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyEngineBundle } from "../src/engine-bundle.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const directories: string[] = [];

function bundle(options: { integrity?: Record<string, string>; bundleVersion?: string | null; skip?: string[] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "engine-bundle-"));
  directories.push(directory);
  const files: Record<string, string> = { "ocgcore.standard.wasm": "standard", "ocgcore.domain.wasm": "domain", "ocgcore.domain.legacy.wasm": "legacy wasm", "cards.cdb": "cards", wrapper: "wrapper" };
  for (const [name, content] of Object.entries(files)) {
    if (!options.skip?.includes(name)) writeFileSync(join(directory, name), content);
  }
  if (!options.skip?.includes("card-scripts")) {
    mkdirSync(join(directory, "card-scripts"));
    if (!options.skip?.includes("domain.legacy.lua")) writeFileSync(join(directory, "card-scripts", "domain.legacy.lua"), "legacy lua");
  }
  if (!options.skip?.includes("manifest.json")) {
    const manifest: Record<string, unknown> = { integrity: options.integrity ?? {} };
    if (options.bundleVersion !== null) manifest.bundleVersion = options.bundleVersion ?? "v1";
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  }
  return { directory, wrapperPath: join(directory, "wrapper") };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("verifyEngineBundle", () => {
  const stockPath = "official/c3743515.lua";
  const patched = "-- stock\n-- BEGIN HOST CARD SCRIPT PATCH\n-- patched\n";
  const patchIntegrity = sha(`${stockPath}\0${sha(patched)}\n`);
  function patchedBundle() {
    const result = bundle({ integrity: { cardScriptPatches: patchIntegrity } });
    mkdirSync(join(result.directory, "card-scripts/official"));
    writeFileSync(join(result.directory, "card-scripts", stockPath), patched);
    writeFileSync(join(result.directory, "card-scripts/.host-card-script-patches.json"), JSON.stringify([{ stockPath }]));
    return result;
  }

  it("accepts matching patched card-script bytes", () => {
    const { directory, wrapperPath } = patchedBundle();
    expect(verifyEngineBundle(directory, { wrapperPath, engine: "pinned" }).bundleVersion).toBe("v1");
  });

  it.each(["stock", "missing script", "missing receipt", "empty receipt", "invalid receipt", "unsafe path"])("rejects patched scripts with %s", kind => {
    const { directory, wrapperPath } = patchedBundle();
    const script = join(directory, "card-scripts", stockPath);
    const receipt = join(directory, "card-scripts/.host-card-script-patches.json");
    if (kind === "stock") writeFileSync(script, "-- stock\n");
    if (kind === "missing script") rmSync(script);
    if (kind === "missing receipt") rmSync(receipt);
    if (kind === "empty receipt") writeFileSync(receipt, "[]");
    if (kind === "invalid receipt") writeFileSync(receipt, "{}");
    if (kind === "unsafe path") writeFileSync(receipt, JSON.stringify([{ stockPath: "../wrapper" }]));
    expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toThrow(/cardScriptPatches.*duel:prepare/);
  });

  it("accepts a complete bundle without integrity entries", () => {
    const { directory, wrapperPath } = bundle();
    expect(verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toEqual({ bundleVersion: "v1" });
  });

  it("accepts matching sha256 values", () => {
    const { directory, wrapperPath } = bundle({ integrity: { standardWasm: sha("standard"), domainWasm: sha("domain"), wrapper: sha("wrapper") } });
    expect(verifyEngineBundle(directory, { wrapperPath, engine: "pinned" }).bundleVersion).toBe("v1");
  });

  it.each([
    ["manifest.json", /manifest is missing or unreadable.*manifest\.json.*duel:prepare/],
    ["ocgcore.standard.wasm", /Standard wasm is missing.*ocgcore\.standard\.wasm.*build-standard-core\.sh/],
    ["ocgcore.domain.wasm", /Domain wasm is missing.*ocgcore\.domain\.wasm.*build-domain-core\.sh/],
    ["cards.cdb", /Card database is missing.*cards\.cdb/],
    ["card-scripts", /Card scripts directory is missing.*card-scripts/],
  ])("names the missing %s", (name, pattern) => {
    const { directory, wrapperPath } = bundle({ skip: [name] });
    expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toThrow(pattern);
  });

  it("rejects a manifest without bundleVersion", () => {
    const { directory, wrapperPath } = bundle({ bundleVersion: null });
    expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toThrow(/no bundleVersion/);
  });

  it.each([
    ["standardWasm", /ocgcore\.standard\.wasm does not match manifest integrity\.standardWasm.*build-standard-core\.sh/],
    ["domainWasm", /ocgcore\.domain\.wasm does not match manifest integrity\.domainWasm.*build-domain-core\.sh/],
    ["wrapper", /wrapper does not match manifest integrity\.wrapper.*patch-package/],
  ])("rejects a %s hash mismatch", (key, pattern) => {
    const { directory, wrapperPath } = bundle({ integrity: { [key]: sha("something else") } });
    expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toThrow(pattern);
  });

  describe("the files of the legacy 1v1 engine", () => {
    const legacyIntegrity = { domainLegacyWasm: sha("legacy wasm"), domainLegacyLua: sha("legacy lua") };

    it("accepts matching legacy hashes", () => {
      const { directory, wrapperPath } = bundle({ integrity: legacyIntegrity });
      expect(verifyEngineBundle(directory, { wrapperPath, engine: "legacy" }).bundleVersion).toBe("v1");
    });

    it("stops the server at startup when the legacy engine is chosen and the manifest has no legacy hashes", () => {
      const { directory, wrapperPath } = bundle();
      expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "legacy" })).toThrow(/no integrity\.domainLegacyWasm.*legacy-domain/);
    });

    it("does not need the legacy files when the pinned engine is chosen", () => {
      const { directory, wrapperPath } = bundle();
      expect(verifyEngineBundle(directory, { wrapperPath, engine: "pinned" }).bundleVersion).toBe("v1");
    });

    it.each([
      ["domainLegacyWasm", /ocgcore\.domain\.legacy\.wasm does not match manifest integrity\.domainLegacyWasm.*legacy-domain/],
      ["domainLegacyLua", /domain\.legacy\.lua does not match manifest integrity\.domainLegacyLua.*legacy-domain/],
    ])("rejects a %s hash mismatch in both modes", (key, pattern) => {
      const { directory, wrapperPath } = bundle({ integrity: { ...legacyIntegrity, [key]: sha("something else") } });
      expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "legacy" })).toThrow(pattern);
      expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "pinned" })).toThrow(pattern);
    });

    it("names a legacy file that the manifest lists but the folder lacks", () => {
      const { directory, wrapperPath } = bundle({ integrity: legacyIntegrity, skip: ["ocgcore.domain.legacy.wasm"] });
      expect(() => verifyEngineBundle(directory, { wrapperPath, engine: "legacy" })).toThrow(/ocgcore\.domain\.legacy\.wasm is missing.*legacy-domain/);
    });
  });
});
