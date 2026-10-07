import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { emptyCardQuery, normalizeDuelSettings } from "@yugidraft/shared/duels";
import { normalizeCardCodes, normalizeImportedDeck, canonicalEngineCardCode } from "../src/deck-import.js";
import { inspectDeck } from "../src/deck-legality.js";
import { loadCardDatabase } from "../src/cards.js";
import { resolveCard } from "../src/presets/catalog.js";
import { queryCards } from "../src/card-search.js";
const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"prerelease-read-"));roots.push(dir);
 const db=new Database(join(dir,"cards.cdb"));
 db.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,ot INTEGER,alias INTEGER,setcode INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER);
 CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);
 INSERT INTO datas VALUES(12,3,0,0,17,100,100,4,1,1),(100000001,257,0,0,17,100,100,4,1,1),(100000002,258,0,0,17,100,100,4,1,1);
 INSERT INTO texts VALUES(12,'Graduated',''),(100000001,'OCG preview',''),(100000002,'TCG preview','');`);
 for(let id=100;id<137;id++){
  db.prepare("INSERT INTO datas VALUES(?,3,0,0,17,100,100,4,1,1)").run(id);
  db.prepare("INSERT INTO texts VALUES(?,?,'')").run(id,`Filler ${id}`);
 }
 db.close();
 mkdirSync(join(dir,"card-scripts"));writeFileSync(join(dir,"strings.conf"),"");
 const remaps=JSON.stringify({version:1,remaps:{100000003:12},prerelease:[],drops:[]});
 writeFileSync(join(dir,"card-remaps.json"),remaps);
 writeFileSync(join(dir,"manifest.json"),JSON.stringify({bundleVersion:"test",integrity:{cardRemaps:createHash("sha256").update(remaps).digest("hex")}}));
 return dir;
}
it("resolves temporary codes before import, pool counts, validation and scenario compilation",async()=>{
 const dir=fixture(),db=openDatabase(":memory:"),fetch=vi.fn();
 const deck={main:[100000003],extra:[],side:[],deckMaster:100000003};
 try{
  expect(await normalizeImportedDeck(deck,dir,db,{fetch})).toEqual({...deck,main:[12],deckMaster:12});
  expect(await normalizeCardCodes([100000003],dir,db,{fetch})).toEqual(new Map([[100000003,12]]));
  expect(canonicalEngineCardCode(100000003,dir)).toBe(12);
  expect(fetch).not.toHaveBeenCalled();
  const settings=normalizeDuelSettings("normal",{validateDeck:false,startingHand:1,banlist:"none"});
  expect(inspectDeck("normal",{main:[100000003],extra:[],side:[]},dir,settings).issues).toEqual([]);
  expect(inspectDeck("normal",{main:[100000003],extra:[],side:[]},dir,settings,{draftPool:{counts:new Map([[100000003,1]]),forcedCopies:new Map([[100000003,1]])}}).issues).toEqual([]);
  expect(inspectDeck("normal",{main:[100000004],extra:[],side:[]},dir,settings).issues[0]?.message).toContain("Unknown card");
  expect(resolveCard(100000003,dir)).toBe(12);
 }finally{db.close();}
});
it("exposes prerelease metadata and respects TCG/OCG bits, with unlisted cards unlimited",()=>{
 const dir=fixture(),cards=loadCardDatabase(dir);
 try{
  expect(cards.get(100000001)?.prerelease).toBe(true);
  expect(cards.deckCard(100000002)?.prerelease).toBe(true);
  expect(cards.search("preview").every(card=>card.prerelease)).toBe(true);
  const search = queryCards(cards,{...emptyCardQuery(),text:"preview"});
  expect(search.total).toBe(2);
  expect(search.cards.every(card=>card.prerelease)).toBe(true);
  for(const [pool,allowed,denied] of [["ocg",100000001,100000002],["tcg",100000002,100000001]] as const){
   const settings=normalizeDuelSettings("normal",{validateDeck:true,startingHand:1,cardPool:pool,banlist:"tcg-2026-09"});
   const filler=Array.from({length:37},(_,i)=>i+100);
   expect(inspectDeck("normal",{main:[allowed,allowed,allowed,...filler],extra:[],side:[]},dir,settings).issues).toEqual([]);
   expect(inspectDeck("normal",{main:[denied,denied,denied,...filler],extra:[],side:[]},dir,settings).issues.some(x=>x.message.includes(`not ${pool.toUpperCase()} legal`))).toBe(true);
  }
 }finally{cards.close();}
});
