import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { seedIdentity } from "./helpers/identity.js";
import * as sharedDb from "../src/db/index.js";
const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function bundle(remaps: Record<string,number> = {100000001:12}){
 const directory=mkdtempSync(join(tmpdir(),"card-remap-db-"));roots.push(directory);
 const bytes=JSON.stringify({version:1,remaps,prerelease:[],drops:[]});
 writeFileSync(join(directory,"card-remaps.json"),bytes);
 writeFileSync(join(directory,"manifest.json"),JSON.stringify({bundleVersion:"next",integrity:{cardRemaps:createHash("sha256").update(bytes).digest("hex")}}));
 const cdb=new Database(join(directory,"cards.cdb"));cdb.exec("CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER DEFAULT 0,type INTEGER DEFAULT 0); INSERT INTO datas(id) VALUES(12)");cdb.close();
 return directory;
}
it.each([[2,3,5],[60,70,99]])("rewrites user passcodes once with foreign keys and cube collisions (%i + %i = %i), preserving picks and finished replays",(oldCopies,officialCopies,total)=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");db.pragma("foreign_keys=ON");
 const oldDeck=JSON.stringify({main:[100000001,12,999],extra:[100000001],side:[],deckMaster:100000001});
 const migrated=JSON.stringify({main:[12,12,999],extra:[12],side:[],deckMaster:12});
 try{
  seedIdentity(db,{userId:1,playerId:1,guildId:'g',name:'User'});
  db.exec(`
   INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(100000001,'Preview','Normal Monster','normal','old','old','[]','now'),(12,'Preview','Normal Monster','normal','new','new','[]','now');
   INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(1,'g','cube',1);
   INSERT INTO cube_cards VALUES(1,100000001,'main',${oldCopies},'old'),(1,12,'main',${officialCopies},'new');
   INSERT INTO drafts(id,guild_id,channel_id,name,status,created_by_user_id) VALUES(1,'g','c','draft','completed',1);
   INSERT INTO draft_players(draft_id,player_id) VALUES(1,1);
   INSERT INTO draft_cards(id,draft_id,wave_number,catalog_card_id,picked_by_player_id) VALUES(1,1,1,100000001,1);
   INSERT INTO draft_deal VALUES(1,1,100000001);
   INSERT INTO draft_undealt VALUES(1,2,100000001);
   INSERT INTO draft_picks(draft_id,player_id,draft_card_id,wave_number,pick_step,picked_at) VALUES(1,1,1,1,1,'now');
   INSERT INTO duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) VALUES(1,'g','finished','finished',1,'normal','completed'),(2,'g','lobby','lobby',1,'normal','lobby');
   INSERT INTO duel_commands(duel_id,seq,seat,command_json) VALUES(1,1,0,'{"code":100000001}');`);
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g',1,'deck','normal',?)").run(oldDeck);
  for(const id of [1,2])db.prepare("INSERT INTO duel_seats(duel_id,seat,player_id,deck_json) VALUES(?,0,1,?)").run(id,oldDeck);
  db.prepare("UPDATE cubes SET config_json=?").run(JSON.stringify({customCardIds:[100000001],customExtraCardIds:[100000001],cubeCardIds:[100000001],poolCardIds:[100000001],otherNumber:100000001}));
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(false);
  expect(db.prepare("SELECT deck_json FROM saved_decks").get()).toEqual({deck_json:migrated});
  expect(db.prepare("SELECT catalog_card_id,max_copies,source FROM cube_cards").all()).toEqual([{catalog_card_id:12,max_copies:total,source:"new"}]);
  for(const table of ["draft_cards","draft_deal","draft_undealt"])expect(db.prepare(`SELECT catalog_card_id FROM ${table}`).get()).toEqual({catalog_card_id:12});
  expect(db.prepare("SELECT draft_card_id FROM draft_picks").get()).toEqual({draft_card_id:1});
  expect(db.prepare("SELECT deck_json FROM duel_seats WHERE duel_id=1").get()).toEqual({deck_json:oldDeck});
  expect(db.prepare("SELECT deck_json FROM duel_seats WHERE duel_id=2").get()).toEqual({deck_json:migrated});
  expect(db.prepare("SELECT command_json FROM duel_commands").get()).toEqual({command_json:'{"code":100000001}'});
  expect(JSON.parse((db.prepare("SELECT config_json FROM cubes").get() as {config_json:string}).config_json)).toEqual({customCardIds:[12],customExtraCardIds:[12],cubeCardIds:[12],poolCardIds:[12],otherNumber:100000001});
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(true);
  expect(db.prepare("SELECT max_copies FROM cube_cards").get()).toEqual({max_copies:total});
 }finally{db.close();}
});
it("rejects corrupt remaps before changing saved data",()=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 try{
  writeFileSync(join(dir,"card-remaps.json"),'{}');
  expect(()=>sharedDb.applyEngineCardRemaps(db,dir)).toThrow(/integrity.cardRemaps/);
 }finally{db.close();}
});

it("creates missing official catalog metadata and migrates registration, series and sandbox fields",()=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 const oldDeck=JSON.stringify({main:[100000001],extra:[],side:[],deckMaster:100000001});
 const migrated=JSON.stringify({main:[12],extra:[],side:[],deckMaster:12});
 const setup=JSON.stringify({startupScripts:["Debug.AddCard(100000001,0,0,LOCATION_HAND,0,POS_FACEUP)\nlocal unrelated=100000001"],seed:[100000001]});
 try{
  seedIdentity(db,{userId:1,playerId:1,guildId:'g',name:'User'});
  db.exec(`
   INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(100000001,'Preview','Normal Monster','normal','old','old','[]','now');
   INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main,source) VALUES(100000001,100000001,'old','old',1,'engine');
   INSERT INTO tournaments(id,guild_id,name,format,status,created_by_user_id) VALUES(1,'g','Tournament','normal','active',1);
   INSERT INTO tournament_participants(tournament_id,player_id) VALUES(1,1);
   INSERT INTO drafts(id,guild_id,channel_id,name,status,created_by_user_id) VALUES(1,'g','c','draft','completed',1);
   INSERT INTO duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) VALUES(1,'g','done','done',1,'normal','completed'),(2,'g','lobby','lobby',1,'normal','lobby');
   INSERT INTO duel_series(id,guild_id,player0_id,player1_id,mode,settings_json,created_by_player_id,status) VALUES(1,'g',1,1,'normal','{}',1,'between_games'),(2,'g',1,1,'normal','{}',1,'completed');`);
  db.prepare("UPDATE tournament_participants SET deck_json=?").run(oldDeck);
  for(const column of ["base_deck0_json","base_deck1_json","deck0_json","deck1_json"])db.prepare(`UPDATE duel_series SET ${column}=?`).run(oldDeck);
  db.prepare("UPDATE drafts SET config_json=?").run('{"poolCardIds":[100000001]}');
  db.prepare("UPDATE duels SET setup_json=?").run(setup);
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT deck_json FROM tournament_participants").get()).toEqual({deck_json:migrated});
  for(const column of ["base_deck0_json","base_deck1_json","deck0_json","deck1_json"]){
   expect(db.prepare(`SELECT ${column} AS deck FROM duel_series WHERE id=1`).get()).toEqual({deck:migrated});
   expect(db.prepare(`SELECT ${column} AS deck FROM duel_series WHERE id=2`).get()).toEqual({deck:oldDeck});
  }
  expect(db.prepare("SELECT config_json FROM drafts").get()).toEqual({config_json:'{"poolCardIds":[12]}'});
  expect(db.prepare("SELECT setup_json FROM duels WHERE id=1").get()).toEqual({setup_json:setup});
  expect(JSON.parse((db.prepare("SELECT setup_json FROM duels WHERE id=2").get() as {setup_json:string}).setup_json)).toEqual({startupScripts:["Debug.AddCard(12,0,0,LOCATION_HAND,0,POS_FACEUP)\nlocal unrelated=100000001"],seed:[100000001]});
  expect(db.prepare("SELECT ygoprodeck_id,image_url,image_url_small FROM card_catalog").get()).toEqual({ygoprodeck_id:12,image_url:"https://images.ygoprodeck.com/images/cards/12.jpg",image_url_small:"https://images.ygoprodeck.com/images/cards_small/12.jpg"});
  expect(db.prepare("SELECT card_id,artwork_id,is_main FROM card_artworks").get()).toEqual({card_id:12,artwork_id:12,is_main:1});
  expect(db.pragma("foreign_key_check")).toEqual([]);
 }finally{db.close();}
});

it.each(["bad json","null","[]",'"string"',"42","true"])("skips and logs invalid saved JSON %s while migrating valid rows",invalid=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
 try{
  seedIdentity(db,{userId:1,playerId:1,guildId:"g"});
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g',1,'a','normal',?)").run(JSON.stringify({main:[100000001],extra:[],side:[]}));
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g',1,'b','normal',?)").run(invalid);
  db.prepare("INSERT INTO cubes(id,guild_id,name,created_by_user_id,config_json) VALUES(1,'g','bad',1,?)").run(invalid);
  db.prepare("INSERT INTO cubes(id,guild_id,name,created_by_user_id,config_json) VALUES(2,'g','good',1,?)").run('{"customCardIds":[100000001]}');
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(false);
  expect(db.prepare("SELECT deck_json FROM saved_decks WHERE name='a'").get()).toEqual({deck_json:'{"main":[12],"extra":[],"side":[]}'});
  expect(db.prepare("SELECT deck_json FROM saved_decks WHERE name='b'").get()).toEqual({deck_json:invalid});
  expect(db.prepare("SELECT config_json FROM cubes WHERE id=1").get()).toEqual({config_json:invalid});
  expect(db.prepare("SELECT config_json FROM cubes WHERE id=2").get()).toEqual({config_json:'{"customCardIds":[12]}'});
  expect(warning).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("saved_decks.deck_json row 2"));
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("cubes.config_json row 1"));
  expect(db.prepare("SELECT bundle_version FROM engine_card_remap_runs").all()).toEqual([{bundle_version:"next"}]);
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(true);
 }finally{warning.mockRestore();db.close();}
});


it.each([true,false])("never rewrites or deletes real alternate-art catalog/artwork rows from an older remap artifact (loaded=%s)", loaded => {
 const dir=bundle({100000001:12,57160137:57160136}),db=sharedDb.openDatabase(":memory:");
 const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
 try {
  seedIdentity(db,{userId:1,playerId:1,guildId:"g"});
  const cdb=new Database(join(dir,"cards.cdb"));
  cdb.exec("INSERT INTO datas(id,alias) VALUES(57160136,0)");
  if(loaded)cdb.exec("INSERT INTO datas(id,alias) VALUES(57160137,57160136)");cdb.close();
  db.exec(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
   VALUES(57160136,'Cynet Mining','Spell Card','spell','main','main','[]','now'),(57160137,'Cynet Mining','Spell Card','spell','art','art','[]','now');
   INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main,source)
   VALUES(57160136,57160137,'art','art',0,'engine');
   INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g',1,'art','normal','{"main":[57160137,100000001]}');`);
  const catalog=db.prepare("SELECT * FROM card_catalog ORDER BY ygoprodeck_id").all();
  const artworks=db.prepare("SELECT * FROM card_artworks ORDER BY artwork_id").all();
  expect(sharedDb.applyEngineCardRemaps(db,dir).remappedPasscodes).toBe(1);
  expect(db.prepare("SELECT * FROM card_catalog ORDER BY ygoprodeck_id").all()).toEqual(catalog);
  expect(db.prepare("SELECT * FROM card_artworks ORDER BY artwork_id").all()).toEqual(artworks);
  expect(db.prepare("SELECT deck_json FROM saved_decks").get()).toEqual({deck_json:'{"main":[57160137,12]}'});
  expect(db.pragma("foreign_key_check")).toEqual([]);
 } finally {warning.mockRestore();db.close();}
});


it.each(["official-releases-prerelease-v1","official-releases-prerelease-v2"])("requires remaps for the %s recipe even without a recorded hash",format=>{
 const dir=bundle();
 rmSync(join(dir,"card-remaps.json"));
 writeFileSync(join(dir,"manifest.json"),JSON.stringify({sources:{databaseFormat:format}}));
 expect(()=>sharedDb.loadCardPasscodeRemaps(dir)).toThrow(/Missing card-remaps/);
});


it("refuses unsafe v1 remaps before touching legacy artworks with no family mapping",()=>{
 const dir=bundle({57160137:57160136}),db=sharedDb.openDatabase(":memory:");
 try{
  const cdb=new Database(join(dir,"cards.cdb"));cdb.exec("INSERT INTO datas(id) VALUES(57160136)");cdb.close();
  const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));
  manifest.sources={databaseFormat:"official-releases-prerelease-v1"};
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest));
  db.exec(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
   VALUES(57160137,'Cynet Mining','Spell Card','spell','art','art','[]','now');`);
  const before=db.prepare("SELECT * FROM card_catalog").all();
  expect(()=>sharedDb.applyEngineCardRemaps(db,dir)).toThrow(/Unsafe.*v1.*rebuild/i);
  expect(db.prepare("SELECT * FROM card_catalog").all()).toEqual(before);
  expect(db.prepare("SELECT * FROM engine_card_remap_runs").all()).toEqual([]);
 }finally{db.close();}
});

it("replaces renamed/type-corrected preview metadata with official engine metadata in decks, cubes and drafts",()=>{
 const dir=bundle({101402001:77482666}),db=sharedDb.openDatabase(":memory:");
 const cdb=new Database(join(dir,"cards.cdb"));
 cdb.exec(`CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT); INSERT INTO datas(id,type) VALUES(77482666,97);
 INSERT INTO texts VALUES(77482666,'Swiftwind Panther Warrior','Official effect');`);cdb.close();
 try {
  seedIdentity(db,{userId:1,playerId:1,guildId:"g"});
  db.exec(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(101402001,'Swift Panther Warrior','Effect Monster','effect','Old effect','old','old','[]','now');
    INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g',1,'renamed','normal','{"main":[101402001]}');
    INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(1,'g','cube',1);
    INSERT INTO cube_cards VALUES(1,101402001,'main',1,'manual');
    INSERT INTO drafts(id,guild_id,channel_id,name,status,created_by_user_id) VALUES(1,'g','c','draft','completed',1);
    INSERT INTO draft_cards(id,draft_id,wave_number,catalog_card_id) VALUES(1,1,1,101402001);`);
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT deck_json FROM saved_decks").get()).toEqual({deck_json:'{"main":[77482666]}'});
  expect(db.prepare("SELECT catalog_card_id,pool FROM cube_cards").get()).toEqual({catalog_card_id:77482666,pool:"extra"});
  expect(db.prepare("SELECT catalog_card_id FROM draft_cards").get()).toEqual({catalog_card_id:77482666});
  expect(db.prepare("SELECT name,type,frame_type,effect_text FROM card_catalog").get()).toEqual({name:"Swiftwind Panther Warrior",type:"Fusion Effect Monster",frame_type:"fusion",effect_text:"Official effect"});
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(true);
 } finally {db.close();}
});
it.each([[33,"extra","main"],[97,"main","extra"]] as const)("corrects cube pool using official type %i after collision",(type,oldPool,newPool)=>{
 const dir=bundle({101402001:77482666}),db=sharedDb.openDatabase(":memory:");
 const cdb=new Database(join(dir,"cards.cdb"));cdb.exec(`CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);INSERT INTO datas(id,type) VALUES(77482666,${type});INSERT INTO texts VALUES(77482666,'Official','');`);cdb.close();
 try{
  seedIdentity(db,{userId:1,playerId:1,guildId:"g"});
  db.exec(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(101402001,'Preview','Effect Monster','effect','old','old','[]','now'),(77482666,'Official','Effect Monster','effect','new','new','[]','now');INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(1,'g','cube',1);`);
  db.prepare("INSERT INTO cube_cards VALUES(1,?,?,2,'old'),(1,?,?,3,'new')").run(101402001,oldPool,77482666,oldPool);
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT catalog_card_id,pool,max_copies,source FROM cube_cards").all()).toEqual([{catalog_card_id:77482666,pool:newPool,max_copies:5,source:"new"}]);
 }finally{db.close();}
});

it.each([
 ['[{"set_name":"Official set"}]','Catalog translation'],
 ['[]','Official'],
 ['[]','OCG-only catalog translation'],
])("preserves existing catalog metadata across weekly bundles (sets=%s, name=%s)",(sets,name)=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 const cdb=new Database(join(dir,"cards.cdb"));
 cdb.exec("CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);UPDATE datas SET type=97 WHERE id=12;INSERT INTO texts VALUES(12,'Official','Lossy engine effect');");cdb.close();
 try{
  db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
   VALUES(12,?,'Fusion Monster','fusion','Synced effect','synced','synced',?,'synced date')`).run(name,sets);
  const before=db.prepare("SELECT * FROM card_catalog WHERE ygoprodeck_id=12").get();
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT * FROM card_catalog WHERE ygoprodeck_id=12").get()).toEqual(before);
  const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));manifest.bundleVersion="next-week";
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest));
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT * FROM card_catalog WHERE ygoprodeck_id=12").get()).toEqual(before);
 }finally{db.close();}
});

it("refreshes a copied preview only once, even if engine text changes next week",()=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 const cdb=new Database(join(dir,"cards.cdb"));
 cdb.exec("CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);UPDATE datas SET type=97 WHERE id=12;INSERT INTO texts VALUES(12,'Official','First effect');");cdb.close();
 try{
  db.exec(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
   VALUES(100000001,'Preview','Effect Monster','effect','preview','preview','[]','now');`);
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT name,effect_text FROM card_catalog").get()).toEqual({name:"Official",effect_text:"First effect"});
  const before=db.prepare("SELECT * FROM card_catalog").get();
  const next=new Database(join(dir,"cards.cdb"));next.exec("UPDATE texts SET desc='Next week effect'");next.close();
  const manifest=JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8"));manifest.bundleVersion="next-week";
  writeFileSync(join(dir,"manifest.json"),JSON.stringify(manifest));
  sharedDb.applyEngineCardRemaps(db,dir);
  expect(db.prepare("SELECT * FROM card_catalog").get()).toEqual(before);
 }finally{db.close();}
});
