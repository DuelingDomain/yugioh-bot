import { createHash } from "node:crypto";
import type { DuelEngineChoice, DuelFormat, DuelMode } from "@yugidraft/shared/duels";
import type { CardScriptSource } from "./card-script-source.js";
import type { ScriptOverlay } from "./multi-scripts.js";
import { legacyNormalScript } from "./legacy/script-compat.js";

export const SCRIPT_ENGINE_KINDS = ["all", "legacy-normal", "legacy-domain", "pinned-normal", "pinned-domain", "multi-normal", "multi-domain"] as const;
export type ScriptEngineKind = typeof SCRIPT_ENGINE_KINDS[number];
export function scriptEngineKind(mode: DuelMode, format: DuelFormat, engine: DuelEngineChoice): ScriptEngineKind {
  return `${format === "1v1" ? engine : "multi"}-${mode}`;
}

/** Identity covers the loaded card, shared Lua helpers and engine-specific transforms. */
export function cardScriptHash(cards: CardScriptSource, code: number, kind: ScriptEngineKind = "all", overlay?: ScriptOverlay & { utility?: string }): string | null {
  const alias = cards.deckCard(code)?.alias ?? 0;
  const requested = alias && Math.abs(alias - code) < 10 ? alias : code;
  const text = cards.readScript(`c${requested}.lua`, kind.startsWith("multi-") ? overlay : undefined);
  if (text === null) return null;
  const hash = createHash("sha256").update(kind).update("\0").update(text);
  // Helper callbacks can fail in utility.lua, proc_*.lua, chain.lua, etc. Include all
  // installed non-card scripts so a helper fix lifts the affected revision.
  const names = [...new Set([...(cards.scriptNames?.() ?? [])].map(name => name.replaceAll("\\", "/").split("/").at(-1)!))]
    .filter(name => name.endsWith(".lua") && !/^c\d+\.lua$/.test(name)).sort();
  for (const name of names) {
    let content = cards.readScript(name);
    if (kind === "legacy-normal") content = legacyNormalScript(name, content);
    hash.update("\0").update(name).update("\0").update(content ?? "missing");
  }
  if (kind.startsWith("multi-")) hash.update("\0").update(overlay?.utility ?? "missing overlay");
  return hash.digest("hex");
}
