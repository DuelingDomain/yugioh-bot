import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import * as sharedDb from "../src/db/index.js";
const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function bundle(){
 const directory=mkdtempSync(join(tmpdir(),"card-remap-db-"));roots.push(directory);
 const bytes=JSON.stringify({version:1,remaps:{100000001:12},prerelease:[],drops:[]});
 writeFileSync(join(directory,"card-remaps.json"),bytes);
 writeFileSync(join(directory,"manifest.json"),JSON.stringify({bundleVersion:"next",integrity:{cardRemaps:createHash("sha256").update(bytes).digest("hex")}}));
 const cdb=new Database(join(directory,"cards.cdb"));cdb.exec("CREATE TABLE datas(id INTEGER PRIMARY KEY); INSERT INTO datas VALUES(12)");cdb.close();
 return directory;
}
it("rewrites user passcodes once with foreign keys and cube collisions, preserving picks and finished replays",()=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");db.pragma("foreign_keys=ON");
 const oldDeck=JSON.stringify({main:[100000001,12,999],extra:[100000001],side:[],deckMaster:100000001});
 const migrated=JSON.stringify({main:[12,12,999],extra:[12],side:[],deckMaster:12});
 try{
  db.exec(`INSERT INTO players(id,guild_id,discord_user_id,display_name) VALUES(1,'g','u','User');
   INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(100000001,'Preview','Normal Monster','normal','old','old','[]','now'),(12,'Preview','Normal Monster','normal','new','new','[]','now');
   INSERT INTO cubes(id,guild_id,name,created_by_user_id) VALUES(1,'g','cube','u');
   INSERT INTO cube_cards VALUES(1,100000001,'main',2,'old'),(1,12,'main',3,'new');
   INSERT INTO drafts(id,guild_id,channel_id,name,status,created_by_user_id) VALUES(1,'g','c','draft','completed','u');
   INSERT INTO draft_players(draft_id,player_id) VALUES(1,1);
   INSERT INTO draft_cards(id,draft_id,wave_number,catalog_card_id,picked_by_player_id) VALUES(1,1,1,100000001,1);
   INSERT INTO draft_deal VALUES(1,1,100000001);
   INSERT INTO draft_undealt VALUES(1,2,100000001);
   INSERT INTO draft_picks(draft_id,player_id,draft_card_id,wave_number,pick_step,picked_at) VALUES(1,1,1,1,1,'now');
   INSERT INTO duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) VALUES(1,'g','finished','finished',1,'normal','completed'),(2,'g','lobby','lobby',1,'normal','lobby');
   INSERT INTO duel_commands(duel_id,seq,seat,command_json) VALUES(1,1,0,'{"code":100000001}');`);
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g','u','deck','normal',?)").run(oldDeck);
  for(const id of [1,2])db.prepare("INSERT INTO duel_seats(duel_id,seat,player_id,deck_json) VALUES(?,0,1,?)").run(id,oldDeck);
  db.prepare("UPDATE cubes SET config_json=?").run(JSON.stringify({customCardIds:[100000001],customExtraCardIds:[100000001],cubeCardIds:[100000001],poolCardIds:[100000001],otherNumber:100000001}));
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(false);
  expect(db.prepare("SELECT deck_json FROM saved_decks").get()).toEqual({deck_json:migrated});
  expect(db.prepare("SELECT catalog_card_id,max_copies,source FROM cube_cards").all()).toEqual([{catalog_card_id:12,max_copies:5,source:"new"}]);
  for(const table of ["draft_cards","draft_deal","draft_undealt"])expect(db.prepare(`SELECT catalog_card_id FROM ${table}`).get()).toEqual({catalog_card_id:12});
  expect(db.prepare("SELECT draft_card_id FROM draft_picks").get()).toEqual({draft_card_id:1});
  expect(db.prepare("SELECT deck_json FROM duel_seats WHERE duel_id=1").get()).toEqual({deck_json:oldDeck});
  expect(db.prepare("SELECT deck_json FROM duel_seats WHERE duel_id=2").get()).toEqual({deck_json:migrated});
  expect(db.prepare("SELECT command_json FROM duel_commands").get()).toEqual({command_json:'{"code":100000001}'});
  expect(JSON.parse((db.prepare("SELECT config_json FROM cubes").get() as {config_json:string}).config_json)).toEqual({customCardIds:[12],customExtraCardIds:[12],cubeCardIds:[12],poolCardIds:[12],otherNumber:100000001});
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(true);
  expect(db.prepare("SELECT max_copies FROM cube_cards").get()).toEqual({max_copies:5});
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
  db.exec(`INSERT INTO players(id,guild_id,discord_user_id,display_name) VALUES(1,'g','u','User');
   INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) VALUES(100000001,'Preview','Normal Monster','normal','old','old','[]','now');
   INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main,source) VALUES(100000001,100000001,'old','old',1,'engine');
   INSERT INTO tournaments(id,guild_id,name,format,status,created_by_user_id) VALUES(1,'g','Tournament','normal','active','u');
   INSERT INTO tournament_participants(tournament_id,player_id) VALUES(1,1);
   INSERT INTO drafts(id,guild_id,channel_id,name,status,created_by_user_id) VALUES(1,'g','c','draft','completed','u');
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

it("rolls back the whole migration and retries safely after invalid saved JSON is repaired",()=>{
 const dir=bundle(),db=sharedDb.openDatabase(":memory:");
 try{
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g','u','a','normal',?)").run(JSON.stringify({main:[100000001],extra:[],side:[]}));
  db.prepare("INSERT INTO saved_decks(guild_id,owner_user_id,name,mode,deck_json) VALUES('g','u','b','normal','bad json')").run();
  expect(()=>sharedDb.applyEngineCardRemaps(db,dir)).toThrow();
  expect(db.prepare("SELECT deck_json FROM saved_decks WHERE name='a'").get()).toEqual({deck_json:'{"main":[100000001],"extra":[],"side":[]}'});
  db.prepare("UPDATE saved_decks SET deck_json=? WHERE name='b'").run('{"main":[],"extra":[],"side":[]}');
  expect(sharedDb.applyEngineCardRemaps(db,dir).skipped).toBe(false);
  expect(db.prepare("SELECT deck_json FROM saved_decks WHERE name='a'").get()).toEqual({deck_json:'{"main":[12],"extra":[],"side":[]}'});
 }finally{db.close();}
});
