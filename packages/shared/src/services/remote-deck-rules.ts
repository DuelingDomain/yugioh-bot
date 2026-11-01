import type Database from "better-sqlite3";
import { inspectDeck, remoteDeckCardFacts } from "../deck-legality/index.js";
import type { DuelDeck, DuelDeckValidation } from "../duels/index.js";
import type { RemoteFormat } from "../remote/deck-checks.js";
import { createGenesysPointsReader } from "./genesys-points.js";
import { deckEngineDataDirectory, loadArtworkIdentityCatalog } from "./card-artworks.js";

/** Reads the editor validator's sources without starting an engine duel or calling a host. */
export function createRemoteDeckRules(db: Database.Database, directory = deckEngineDataDirectory(db.name)) {
  return {
    inspect(format: RemoteFormat, deck: DuelDeck): DuelDeckValidation {
      try {
        const codes = [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster ? [deck.deckMaster] : [])];
        const genesysPoints = format.settings.genesys
          ? createGenesysPointsReader(db).points(codes, loadArtworkIdentityCatalog(directory)) : undefined;
        return inspectDeck(format.mode, deck, directory, format.settings, { genesysPoints, cardBlocks: [], physicalTable: true });
      } catch (error) {
        return { issues: [{ message: "Deck validation unavailable: " + (error instanceof Error ? error.message : String(error)), cards: [] }] };
      }
    },
    facts(format: RemoteFormat, codes: readonly number[]) {
      try { return remoteDeckCardFacts(format.mode, directory, format.settings, codes); }
      catch { return {}; }
    },
  };
}
