import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEngineCardFacts } from './engine-card-facts.js';
import { searchCandidates, type RemoteSearchKnowledge } from '../remote/search-candidates.js';
import type { RemoteState } from '../remote/types.js';
import type Database from "better-sqlite3";
import { inspectDeck, remoteDeckCardFacts } from "../deck-legality/index.js";
import type { DuelDeck, DuelDeckValidation } from "../duels/index.js";
import type { RemoteFormat } from "../remote/deck-checks.js";
import { createGenesysPointsReader } from "./genesys-points.js";
import { deckEngineDataDirectory, loadArtworkIdentityCatalog } from "./card-artworks.js";

import { createInsightCatalog } from "./card-insight-catalog.js";
import { deriveRemoteEffectPlans, remoteEffectMatches, REMOTE_SEARCH_SOURCE_ZONES, type RemoteEffectSource } from "../remote/effect-filters.js";
import type { TwinCard } from "../remote/actions.js";
import { remoteAssert } from "../remote/actions.js";

// Cache catalog inputs, not results: current state and each seat's deck still filter every request.
const searchKnowledgeCache=new WeakMap<Database.Database,Map<string,{until:number;knowledge:RemoteSearchKnowledge}>>();

/** Reads the editor validator's sources without starting an engine duel or calling a host. */
export function createRemoteDeckRules(db: Database.Database, directory = deckEngineDataDirectory(db.name)) {
  return {
    search(state: RemoteState, seat: number, recentCardId: number) {
      const pool=state.deckChecks.registrations[seat]?.deck.main;
      const pileCodes=state.seats[seat]?.twin.filter(c=>['graveyard','banished'].includes(c.zone)||c.inspectionFrom).flatMap(c=>c.cardId??c.passcode??[])??[];
      const visionDirectory=process.env.VISION_DATA_DIR??resolve(directory,'../vision');
      const key=JSON.stringify([directory,visionDirectory,recentCardId,pool,pileCodes]);
      let cache=searchKnowledgeCache.get(db);
      if(!cache){cache=new Map();searchKnowledgeCache.set(db,cache);}
      const saved=cache.get(key);
      if(saved&&saved.until>Date.now())return searchCandidates(state,seat,recentCardId,saved.knowledge);
      const catalog = createInsightCatalog(db, directory);
      try {
        const source = catalog.candidate(recentCardId);
        if (!source) return [];
        const engine = loadEngineCardFacts(directory);
        const candidates = [...catalog.suggestionCandidates(pool ? [...new Set([...pool,...pileCodes])] : undefined)];
        const cards = [source.card, ...candidates.filter(c => c.card.id !== source.card.id).map(c => {
          const fact = engine.get(c.card.id);
          return fact && (fact.type & 1) && !(fact.type & (0x800000 | 0x4000000)) ? {...c.card, level: fact.level & 0xff} : c.card;
        })];
        const path = resolve(visionDirectory, 'related-cards.json');
        let related: RemoteSearchKnowledge['related'];
        if (existsSync(path)) {
          try { related = JSON.parse(readFileSync(path, 'utf8')); } catch { /* Optional prepared prior may be absent during setup. */ }
        }
        const knowledge={cards,tags:source.tags?{[source.card.id]:source.tags}:{},related};
        cache.set(key,{until:Date.now()+60_000,knowledge});
        while(cache.size>16)cache.delete(cache.keys().next().value!);
        return searchCandidates(state, seat, recentCardId, knowledge);
      } finally { catalog.close(); }
    },
    effect(source: {cardId?:number;name?:string;cardRef?:string}, main: readonly number[] | undefined, twin:readonly TwinCard[]=[]) {
      const catalog=createInsightCatalog(db,directory);
      try {
        const candidate=source.cardId ? catalog.candidate(source.cardId) : source.name ? catalog.byName(source.name) : undefined;
        remoteAssert(candidate,"Identify the effect source first",409);
        const resolved:RemoteEffectSource={cardId:candidate.card.id,name:candidate.card.name,...(source.cardRef ? {cardRef:source.cardRef} : {})};
        const plans=deriveRemoteEffectPlans(candidate.card,candidate.tags).map(plan=>{
          const pool=new Map<number,{cardId:number;copyKey:number;name:string;copies:number}>();
          // An absent list means unknown Deck contents. An explicitly empty list stays empty.
          const codes=plan.source==='deck' ? main ?? [] : twin.filter(c=>c.zone===REMOTE_SEARCH_SOURCE_ZONES[plan.source] || c.zone==='hand'&&c.inspectionFrom===REMOTE_SEARCH_SOURCE_ZONES[plan.source]).flatMap(c=>c.cardId??c.passcode??[]);
          const cards=plan.source==='deck' && main===undefined ? catalog.suggestionCandidates() : codes.map(code=>catalog.candidate(code));
          for(const entry of cards) {
            const card=entry?.card;
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
