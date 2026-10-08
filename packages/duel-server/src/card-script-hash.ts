import { createHash } from "node:crypto";
import type { CardDatabase } from "./cards.js";

/** Use the same near-code alias and basename/fallback lookup as the core's script loader. */
export function cardScriptHash(cards: CardDatabase, code: number): string | null {
  const alias = cards.deckCard(code)?.alias ?? 0;
  const requested = alias && Math.abs(alias - code) < 10 ? alias : code;
  const text = cards.readScript(`c${requested}.lua`);
  return text === null ? null : createHash("sha256").update(text).digest("hex");
}
