import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CARD_SCRIPT_PATCH_RECEIPT = ".host-card-script-patches.json";

/** Stable host descriptors for qualifiers absent from the upstream system strings. */
export const HOST_CARD_HINT_DESCRIPTIONS: ReadonlyMap<number, string> = new Map([
  [0x70000001, "Unaffected by your opponent's activated effects, unless they target this card"],
  [0x70000002, "Unaffected by monster effects, except Power Patron monsters"],
  [0x70000003, "Unaffected by your opponent's activated effects"],
  [0x70000004, "Cannot be destroyed by battle with monsters Special Summoned from the Extra Deck"],
  [0x70000005, "Cannot be destroyed by monster or Spell effects"],
  [0x70000006, "Cannot be targeted by your opponent's monster or Spell effects"],
  [0x70000007, "Cannot be destroyed by effects of Angelechy Bastion's controller's opponent"],
  [0x70000008, "Cannot be targeted by card effects, except those of Mudragon of the Swamp's controller"],
]);

/** Hash the effective patched files, using the paths recorded during preparation. */
export function cardScriptPatchesHash(scriptDirectory: string): string {
  const receipt: unknown = JSON.parse(readFileSync(join(scriptDirectory, CARD_SCRIPT_PATCH_RECEIPT), "utf8"));
  if (!Array.isArray(receipt)) throw new Error("Card script patch receipt must be a list");
  const paths = receipt.map((patch: unknown) => {
    const path = (patch as { stockPath?: unknown } | null)?.stockPath;
    if (typeof path !== "string" || (path !== "card_counter_constants.lua" && path !== "utility.lua" && path !== "host-protection-hints.lua" && !/^(?:[A-Za-z0-9_-]+\/)*c[0-9]+\.lua$/.test(path))) {
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
