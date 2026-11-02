import type Database from "better-sqlite3";
import { inspectDeck, remoteDeckCardFacts } from "../deck-legality/index.js";
import type { DuelDeck, DuelDeckValidation } from "../duels/index.js";
import type { RemoteFormat } from "../remote/deck-checks.js";
import { createGenesysPointsReader } from "./genesys-points.js";
import { deckEngineDataDirectory, loadArtworkIdentityCatalog } from "./card-artworks.js";

import { createInsightCatalog } from "./card-insight-catalog.js";
import { deriveRemoteEffectPlans, remoteEffectMatches, type RemoteEffectSource } from "../remote/effect-filters.js";
import { remoteAssert } from "../remote/actions.js";

/** Reads the editor validator's sources without starting an engine duel or calling a host. */
export function createRemoteDeckRules(db: Database.Database, directory = deckEngineDataDirectory(db.name)) {
  return {
    effect(source: {cardId?:number;name?:string;cardRef?:string}, main: readonly number[]) {
      const catalog=createInsightCatalog(db,directory);
      try {
        const candidate=source.cardId ? catalog.candidate(source.cardId) : source.name ? catalog.byName(source.name) : undefined;
        remoteAssert(candidate,"Identify the effect source first",409);
        const resolved:RemoteEffectSource={cardId:candidate.card.id,name:candidate.card.name,...(source.cardRef ? {cardRef:source.cardRef} : {})};
        const plans=deriveRemoteEffectPlans(candidate.card,candidate.tags).map(plan=>{
          const pool=new Map<number,{cardId:number;copyKey:number;name:string;copies:number}>();
          for(const code of main) {
            const card=catalog.candidate(code)?.card;
            if(!card || !remoteEffectMatches(plan,card)) continue;
            const row=pool.get(card.id);
            if(row) row.copies++; else pool.set(card.id,{cardId:card.id,copyKey:card.id,name:card.name,copies:1});
          }
          return {...plan,pool:[...pool.values()].sort((a,b)=>a.cardId-b.cardId)};
        });
        return {source:resolved,plans};
      } finally {catalog.close();}
    },
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
