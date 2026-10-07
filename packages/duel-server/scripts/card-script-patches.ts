import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_SCRIPT_PATCH_RECEIPT, cardScriptPatchesHash } from "../src/card-script-patches.js";

const directory = fileURLToPath(new URL("../card-script-patches/", import.meta.url));
const marker = "\n-- BEGIN HOST CARD SCRIPT PATCH\n";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
type Patch = { stockPath: string; stockSha256: string; suffix: string };

/** Shared suffix overlays go in card-scripts, so every host and native reader gets them. */
export function installCardScriptPatches(scriptDirectory: string, patchDirectory = directory): string {
  const patches = JSON.parse(readFileSync(join(patchDirectory, "MANIFEST.json"), "utf8")) as Patch[];
  const installedPath = join(scriptDirectory, CARD_SCRIPT_PATCH_RECEIPT);
  const installed = existsSync(installedPath) ? JSON.parse(readFileSync(installedPath, "utf8")) as Patch[] : [];
  // Retiring a patch must also restore cached scripts, matching fresh extraction.
  for (const old of installed.filter(old => !patches.some(p => p.stockPath === old.stockPath))) {
    const path = join(scriptDirectory, old.stockPath);
    const stock = readFileSync(path, "utf8").split(marker)[0]!;
    if (hash(stock) !== old.stockSha256) throw new Error(`Card script patch stock mismatch: ${old.stockPath}`);
    writeFileSync(path, stock);
  }
  for (const patch of [...patches].sort((a, b) => Buffer.compare(Buffer.from(a.stockPath), Buffer.from(b.stockPath)))) {
    const path = join(scriptDirectory, patch.stockPath);
    const current = readFileSync(path, "utf8");
    // Replace our previous suffix on cached preparations, never stack copies.
    const stock = current.split(marker)[0]!;
    if (hash(stock) !== patch.stockSha256) throw new Error(`Card script patch stock mismatch: ${patch.stockPath}; review the upstream change before updating MANIFEST.json`);
    const patched = stock + marker + readFileSync(join(patchDirectory, patch.suffix), "utf8");
    if (current !== patched) writeFileSync(path, patched);
  }
  writeFileSync(installedPath, JSON.stringify(patches) + "\n");
  return cardScriptPatchesHash(scriptDirectory);
}
