import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCoreCapabilities } from "../src/core-capabilities.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const sha = "a".repeat(64);
function data(source?: string) {
  const directory = mkdtempSync(join(tmpdir(), "p5-view-capabilities-"));
  folders.push(directory);
  if (source !== undefined) writeFileSync(join(directory, "ocgcore.multi.SOURCE"), source);
  return directory;
}

describe("loaded core capabilities", () => {
  it("enables C6 only with an explicit flag and the loaded core hash", () => {
    expect(readCoreCapabilities(data(`sha256=${sha}\ncapabilities=ffa4-shared-extra-zones\n`), "ocgcore.multi.wasm", sha))
      .toEqual({ ffa4SharedExtraZones: true });
  });
  it.each([
    undefined,
    `tag=C6\nsha256=${sha}\n`,
    `sha256=${sha}\ncapabilities=not-ffa4-shared-extra-zones\n`,
    "sha256=wrong\ncapabilities=ffa4-shared-extra-zones\n",
    "capabilities=ffa4-shared-extra-zones\n",
  ])("keeps separate zones with absent, stale or unmarked metadata (%s)", (source) => {
    expect(readCoreCapabilities(data(source), "ocgcore.multi.wasm", sha)).toEqual({ ffa4SharedExtraZones: false });
  });
  it("checks Standard and Domain metadata separately", () => {
    const directory = data(`sha256=${sha}\ncapabilities=ffa4-shared-extra-zones\n`);
    expect(readCoreCapabilities(directory, "ocgcore.multi-domain.wasm", sha)).toEqual({ ffa4SharedExtraZones: false });
    writeFileSync(join(directory, "ocgcore.multi-domain.SOURCE"), `sha256=${sha}\ncapabilities=other,ffa4-shared-extra-zones\n`);
    expect(readCoreCapabilities(directory, "ocgcore.multi-domain.wasm", sha)).toEqual({ ffa4SharedExtraZones: true });
  });
});
