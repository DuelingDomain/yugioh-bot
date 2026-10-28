import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BRIDGE_FILES, validateBridgeCandidate } from "../../ci/bridge-artifacts.mjs";

describe("bridge publication integrity", () => {
  it("accepts the rebuilt artifacts and rejects altered data or executable source", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const output = mkdtempSync(join(status, "bridge-publication-"));
    try {
      for (const file of BRIDGE_FILES) { mkdirSync(join(output, file, ".."), { recursive: true }); cpSync(join(root, file), join(output, file)); }
      const manifest = readFileSync(join(root, "packages/shared/data/effects/bridges-manifest.json"));
      const bridge = { files: BRIDGE_FILES, manifest_sha256: createHash("sha256").update(manifest).digest("hex"), version: JSON.parse(manifest.toString()).version };
      expect(validateBridgeCandidate(root, output, bridge)).toEqual(BRIDGE_FILES);
      const pin = BRIDGE_FILES.at(-1)!, before = readFileSync(join(output, pin));
      writeFileSync(join(output, pin), before.toString().replace("schema_version: 1", "schema_version: 2"));
      expect(() => validateBridgeCandidate(root, output, bridge)).toThrow("outside its integrity pin");
      writeFileSync(join(output, pin), before);
      const artifact = join(output, BRIDGE_FILES[0]!);
      writeFileSync(artifact, Buffer.concat([readFileSync(artifact), Buffer.from("changed")]));
      expect(() => validateBridgeCandidate(root, output, bridge)).toThrow("compressed integrity");
    } finally { rmSync(output, { recursive: true, force: true }); }
  });
});
