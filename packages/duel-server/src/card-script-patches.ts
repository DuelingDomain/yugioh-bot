import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CARD_SCRIPT_PATCH_RECEIPT = ".host-card-script-patches.json";

/** Hash the effective patched files, using the paths recorded during preparation. */
export function cardScriptPatchesHash(scriptDirectory: string): string {
  const receipt: unknown = JSON.parse(readFileSync(join(scriptDirectory, CARD_SCRIPT_PATCH_RECEIPT), "utf8"));
  if (!Array.isArray(receipt)) throw new Error("Card script patch receipt must be a list");
  const paths = receipt.map((patch: unknown) => {
    const path = (patch as { stockPath?: unknown } | null)?.stockPath;
    if (typeof path !== "string" || !/^(?:[A-Za-z0-9_-]+\/)*c[0-9]+\.lua$/.test(path)) {
      throw new Error("Invalid card script patch stockPath");
    }
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new Error("Duplicate card script patch stockPath");
  paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash("sha256");
  for (const path of paths) {
    const digest = createHash("sha256").update(readFileSync(join(scriptDirectory, path))).digest("hex");
    hash.update(`${path}\0${digest}\n`);
  }
  return hash.digest("hex");
}
