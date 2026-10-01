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
  const files: Record<string, string> = { "ocgcore.standard.wasm": "standard", "ocgcore.domain.wasm": "domain", "cards.cdb": "cards", wrapper: "wrapper" };
  for (const [name, content] of Object.entries(files)) {
    if (!options.skip?.includes(name)) writeFileSync(join(directory, name), content);
  }
  if (!options.skip?.includes("card-scripts")) mkdirSync(join(directory, "card-scripts"));
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
  it("accepts a complete bundle without integrity entries", () => {
    const { directory, wrapperPath } = bundle();
    expect(verifyEngineBundle(directory, { wrapperPath })).toEqual({ bundleVersion: "v1" });
  });

  it("accepts matching sha256 values", () => {
    const { directory, wrapperPath } = bundle({ integrity: { standardWasm: sha("standard"), domainWasm: sha("domain"), wrapper: sha("wrapper") } });
    expect(verifyEngineBundle(directory, { wrapperPath }).bundleVersion).toBe("v1");
  });

  it.each([
    ["manifest.json", /manifest is missing or unreadable.*manifest\.json.*duel:prepare/],
    ["ocgcore.standard.wasm", /Standard wasm is missing.*ocgcore\.standard\.wasm.*build-standard-core\.sh/],
    ["ocgcore.domain.wasm", /Domain wasm is missing.*ocgcore\.domain\.wasm.*build-domain-core\.sh/],
    ["cards.cdb", /Card database is missing.*cards\.cdb/],
    ["card-scripts", /Card scripts directory is missing.*card-scripts/],
  ])("names the missing %s", (name, pattern) => {
    const { directory, wrapperPath } = bundle({ skip: [name] });
    expect(() => verifyEngineBundle(directory, { wrapperPath })).toThrow(pattern);
  });

  it("rejects a manifest without bundleVersion", () => {
    const { directory, wrapperPath } = bundle({ bundleVersion: null });
    expect(() => verifyEngineBundle(directory, { wrapperPath })).toThrow(/no bundleVersion/);
  });

  it.each([
    ["standardWasm", /ocgcore\.standard\.wasm does not match manifest integrity\.standardWasm.*build-standard-core\.sh/],
    ["domainWasm", /ocgcore\.domain\.wasm does not match manifest integrity\.domainWasm.*build-domain-core\.sh/],
    ["wrapper", /wrapper does not match manifest integrity\.wrapper.*patch-package/],
  ])("rejects a %s hash mismatch", (key, pattern) => {
    const { directory, wrapperPath } = bundle({ integrity: { [key]: sha("something else") } });
    expect(() => verifyEngineBundle(directory, { wrapperPath })).toThrow(pattern);
  });
});
