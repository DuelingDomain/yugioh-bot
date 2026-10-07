import { join } from "node:path";
import { expect, it } from "vitest";
import type { DuelDeck, DuelFormat, DuelMode } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { loadCardDatabase } from "../src/cards.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const settings = { visibility:"public" as const,banlist:"none" as const,cardPool:"both" as const,
 turnSeconds:240,startingLP:8000,startingHand:5,drawPerTurn:1,timeout:"loss" as const,validateDeck:false,shuffleDeck:false };
for (const engine of ["legacy","pinned","ffa3","ffa4","tag"] as const) {
 const required=[needs.cards(dataDirectory),needs.scripts(dataDirectory)];
 if(engine==="pinned")required.push(needs.standard(dataDirectory),needs.domain(dataDirectory));
 if(engine==="legacy")required.push(needs.file("legacy Domain core",join(dataDirectory,"ocgcore.domain.legacy.wasm")));
 if(engine==="ffa3"||engine==="ffa4"||engine==="tag")required.push(needs.installedMulti(dataDirectory),needs.file("installed Domain multi core",join(dataDirectory,"ocgcore.multi-domain.wasm")));
 describeWithCores(`prerelease initialization on ${engine}`,required,()=>{
  it.each<DuelMode>(["normal","domain"])("loads every retained prerelease card in %s duels",async mode=>{
   const cards=loadCardDatabase(dataDirectory),preview=[...cards.all()].filter(card=>card.prerelease);
   expect(preview.length).toBeGreaterThan(0);
   const main=preview.filter(card=>(card.type & (0x40|0x2000|0x800000|0x4000000))===0).map(card=>card.code);
   const extra=preview.filter(card=>(card.type & (0x40|0x2000|0x800000|0x4000000))!==0).map(card=>card.code);
   const batches=Math.max(Math.ceil(main.length/30),Math.ceil(extra.length/15));
   for(let batch=0;batch<batches;batch++){
    const selected=main.slice(batch*30,(batch+1)*30);
    const deck=():DuelDeck=>({main:[...selected,...Array<number>(40-selected.length).fill(89631139)],extra:extra.slice(batch*15,(batch+1)*15),side:[],...(mode==="domain"?{deckMaster:89631139}:{})});
    const format:DuelFormat=engine==="ffa3"?"ffa3":engine==="ffa4"?"ffa4":engine==="tag"?"tag":"1v1";
    const start=engine==="legacy"?createLegacyEngineGame:createEngineGame;
    const game=await start({mode,format,dataDirectory,settings,seed:["1","2","3","4"],decks:Array.from({length:format==="ffa3"?3:format==="tag"||format==="ffa4"?4:2},deck)});
    try{expect(game.view(0).turn).toBeGreaterThan(0);expect(game.view(0).prompt).not.toBeNull();expect(JSON.stringify(game.view(0).log)).not.toContain("Missing script");}finally{game.close();}
   }
  },30_000);
 });
}
