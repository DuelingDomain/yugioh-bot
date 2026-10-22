import type Database from "better-sqlite3";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";
import { effectSearchEnabled, importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import type { CardDatabase } from "./cards.js";
import { createCanonicalEffectResolver, initializeCardEffectIndex } from "./card-effects.js";
import { retryStartupDatabase } from "./startup-database.js";

/** The flag gates every effect-artifact boot write as well as the index. */
export async function initializeServerCardEffects(db: Database.Database, cards: CardDatabase, dataDirectory: string): Promise<void> {
  if (!effectSearchEnabled()) return;
  const imported = retryStartupDatabase("effect artifact import", () => importCardEffectArtifact(db, {
    remaps: loadCardPasscodeRemaps(dataDirectory),
    canonicalize: createCanonicalEffectResolver(cards),
  }));
  if (!imported.skipped) console.log(`[duel] Effect tags imported: ${imported.tags} cards, ${imported.profiles} profiles (${imported.version})`);
  await initializeCardEffectIndex(db, cards);
}
