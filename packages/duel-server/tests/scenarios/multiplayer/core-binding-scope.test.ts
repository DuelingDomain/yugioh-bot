import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, expectOffered, expectNotOffered, pickOpponent, select,
  type Scenario, type DuelistId, type Step, type BoardExpect } from "../../support/dsl.js";
const SOURCE="Giant Soldier of Stone", OX="Battle Ox", ELF="Mystical Elf", HEART="Change of Heart";
const standardTrap = process.env.CORE_SCOPE_TRAP_WASM ?? process.env.TABLE_TRAP_WASM ?? "";
const domainTrap = process.env.TABLE_TRAP_DOMAIN_WASM ?? "";
type Case="card-lock"|"card-lock-symbolic"|"player-lock"|"phase-read"|"phase-later"|"phase-same-turn"|"single"|"equip"|"field"|"duration"|"dead-duration"|"empty-duration"|"tag-read";
function proof(format:"1v1"|"ffa3"|"ffa4"|"tag", domain:boolean, kind:Case):Scenario {
  const openingDraw=Number(domain&&format!=="1v1");
  const seats:DuelistId[]=format==="1v1"?["p0","p1"]:format==="ffa3"?["p0","p1","p2"]:["p0","p1","p2","p3"];
  const setup:Scenario["setup"]={format,...(domain?{mode:"domain"}:{})};
  for(const seat of seats) setup[seat]={monsters:seat==="p0"?[SOURCE,OX]:[OX],deck:Array(20).fill(ELF),...(domain?{deckMaster:"Blue-Eyes White Dragon"}:{})};
  const control=kind.startsWith("card-lock")||kind==="player-lock";
  const phase=kind.startsWith("phase-");
  if(control) {setup.p1!.hand=[HEART,"Monster Reborn"];setup.p1!.grave=[ELF];}
  const board=(turn:number,boost:(s:DuelistId)=>boolean,recover?:DuelistId):BoardExpect=>{
    const result:BoardExpect={};
    for(const seat of seats) {
      const index=seats.indexOf(seat), draws=index===0?openingDraw:index<turn?1:0;
      result[seat]={lp:(format==="tag"?16000:8000)+(recover===seat?100:0),monsters:seat==="p0"?control&&turn>1?[OX]:[SOURCE,OX]:seat==="p1"&&control&&turn>1?[OX,SOURCE]:[OX],
        zones:{[seat==="p0"?"m1":"m0"]:{card:OX,attack:1700+(boost(seat)?700:0)}},hand:control&&seat==="p1"?["Monster Reborn",...Array(draws).fill(ELF)]:Array(draws).fill(ELF),deckCount:20-draws,spells:[],banished:[],grave:seat==="p1"&&control?[ELF,...(turn>1?[HEART]:[])]:[],
        ...(domain?{deckMaster:{inZone:true,returns:0,nextCost:0}}:{})};
      if(control&&seat==="p1"&&turn===1) result[seat]!.hand=[HEART,"Monster Reborn"];
    }
    return result;
  };
  const steps:Step[]=[];
  if(kind==="phase-same-turn") {
    const final=board(2,()=>false,"p1");final.p2!.lp!+=100;
    steps.push(endTurn("p0"),expectPickSeats(seats.slice(1),"p0"),pickOpponent("p2","p0"),expectPrompt({by:"p1",context:"action"}),expectBoard(final));
  } else if(phase) {
    steps.push(endTurn("p0"));
    steps.push(expectPrompt({by:"p1",context:"action"}),expectBoard(board(2,()=>false,"p1")),endTurn("p1"));
    if(kind!=="phase-read") steps.push(expectPickSeats(seats.slice(1),"p0"),pickOpponent("p1","p0"));
    steps.push(expectPrompt({by:"p2",context:"action"}));
    const final=board(3,()=>false,"p1"); final[kind==="phase-read"?"p2":"p1"]!.lp!+=100;
    steps.push(expectBoard(final));
  } else {
    steps.push(activate(SOURCE,"p0"));
    if(format.startsWith("ffa")) steps.push(expectPickSeats(seats.slice(1),"p0"),pickOpponent(control?"p1":"p2","p0"));
    if(control) {
      steps.push(endTurn("p0"),activate(HEART,"p1"));
      if(format!=="tag") steps.push(pickOpponent("p0","p1"));
      steps.push(select({card:SOURCE,owner:"p0"}),expectPrompt({by:"p1",context:"action"}),
        (kind.startsWith("card-lock")?expectOffered:expectNotOffered)("activate","Monster Reborn","p1"),
        expectBoard(board(2,s=>kind.startsWith("card-lock")?format==="tag"?s==="p0"||s==="p2":s==="p0":format==="tag"?s==="p1"||s==="p3":s==="p1")));
    } else if(kind==="tag-read") {
      steps.push(pickOpponent("p3","p0"),expectPrompt({by:"p0",context:"action"}));
      const final=board(1,()=>false);final.p3!.hand=[ELF];final.p3!.deckCount=19;steps.push(expectBoard(final));
    } else {
      if(kind==="single"||kind==="equip"||kind==="field"||kind==="duration") {
        const active=board(1,s=>(kind==="field"||kind==="duration")&&(s==="p0"||(format==="tag"&&s==="p2")));
        if(kind==="single") active.p0!.zones={m0:{card:SOURCE,attack:2000},m1:{card:OX,attack:1700}};
        if(kind==="equip") {active.p0!.monsters=[OX];active.p0!.spells=[SOURCE];active.p0!.zones={m1:{card:OX,attack:2400}};}
        steps.push(expectBoard(active));
      }
      steps.push(endTurn("p0"),endTurn("p1"),expectPrompt({by:format==="1v1"?"p0":kind==="dead-duration"?(format==="ffa3"?"p0":"p3"):"p2",context:"action"}));
      const final=board(3,s=>kind==="duration"&&s==="p0");
      if(format==="1v1") {final.p0!.hand=Array(1+openingDraw).fill(ELF);final.p0!.deckCount=19-openingDraw;}
      if(kind==="equip") { final.p0!.monsters=[OX];final.p0!.spells=[SOURCE];final.p0!.zones={m1:{card:OX,attack:1700}}; }
      if(kind==="dead-duration") {
        const next=format==="ffa3"?"p0":"p3";const draws=next==="p0"?1+openingDraw:1;final[next]!.hand=Array(draws).fill(ELF);final[next]!.deckCount=20-draws;
        final.p2={lp:0,monsters:[],spells:[],hand:[],deckCount:0,grave:[],banished:[],...(domain?{deckMaster:{inZone:false,returns:0,nextCost:0}}:{})};
      }
      if(kind==="single") final.p0!.zones={m0:{card:SOURCE,attack:1300},m1:{card:OX,attack:1700}};
      // Player effects count the declared turn. SINGLE, EQUIP and card FIELD effects count each opponent turn (R3).
      steps.push(expectBoard(final));
      if(format!=="1v1"&&(kind==="single"||kind==="equip"||kind==="field"||kind==="duration")) {
        const cleared=board(format==="ffa3"?1:4,()=>false);
        if(format==="ffa3") {cleared.p0!.hand=Array(1+openingDraw).fill(ELF);cleared.p0!.deckCount=19-openingDraw;cleared.p1!.hand=[ELF];cleared.p1!.deckCount=19;cleared.p2!.hand=[ELF];cleared.p2!.deckCount=19;}
        if(kind==="single") cleared.p0!.zones={m0:{card:SOURCE,attack:1300},m1:{card:OX,attack:1700}};
        if(kind==="equip") {cleared.p0!.monsters=[OX];cleared.p0!.spells=[SOURCE];}
        steps.push(endTurn("p2"),expectBoard(cleared));
      }
    }
  }
  return defineScenario({id:`core-scope-${kind}-${format}${domain?"-domain":""}`,title:`${format}: ${kind} uses its own binding scope`,setup,steps,
    source:"Owner duration scope 2026-10-02 late: card effects keep Q1 R3; phase reads bind the turn player",rules:[...(kind==="single"||kind==="equip"||kind==="field"?["R-FFA-OPP-ONE"]:[]),phase?"R-FFA-OPP-RESPONSE":control?"R-FFA-LOCK-CONTROL-CHANGE":(kind==="single"||kind==="equip"||kind==="field")?"R-FFA-ORDER":"R-FFA-DECLARED-DURATION"],tags:["multiplayer",`fixture:${kind}`]});
}
async function run(scenario:Scenario):Promise<void>{
 const compiled=compileBoard(scenario.setup),kind=scenario.tags.find(t=>t.startsWith("fixture:"))!.slice(8);
 const fixture=readFileSync(new URL("./fixtures/core-binding-scope.lua",import.meta.url),"utf8");
 const trapPath=scenario.setup.mode==="domain"?domainTrap:standardTrap;
 const trapBytes=kind==="tag-read"?readFileSync(trapPath):undefined;
 const wasm=trapBytes?trapBytes.buffer.slice(trapBytes.byteOffset,trapBytes.byteOffset+trapBytes.byteLength) as ArrayBuffer:scenario.setup.mode==="domain"?domainNseatWasmBinary():nseatWasmBinary();
 if(kind==="tag-read") expect(Buffer.from(new Uint8Array(wasm ?? new ArrayBuffer(0))).includes(Buffer.from("NFOLD %c")),"The loaded core must emit fold traps").toBe(true);
 const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
  multiWasmBinary:wasm,startupScripts:[{name:"core-binding-scope.lua",content:`CORE_CASE=${JSON.stringify(kind)}\n${fixture}`},...(compiled.options.startupScripts??[])],seed:["1","2","3","4"]});
 try{const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();scenario.steps.forEach((step,i)=>session.run(step,i+1));
  if(kind==="tag-read") expect(game.diagnostics().filter(d=>d.kind==="stderr").map(d=>d.detail).join("\n")).toMatch(/NFOLD c .*fn=Draw/);
 }finally{game.close();}
}
describeWithCores("Core binding scopes",liveNseat,()=>{
 runScenarios("multiplayer/core-binding-scope",[false,true].flatMap(domain=>(["1v1","ffa3","ffa4","tag"] as const).flatMap(format=>
  (format==="1v1"?["single","equip","field"]:format==="tag"?["card-lock","card-lock-symbolic","player-lock","single","equip","field"]:["card-lock","card-lock-symbolic","player-lock","phase-read","phase-later","phase-same-turn","single","equip","field","duration","dead-duration","empty-duration"]).map(kind=>proof(format,domain,kind as Case)))),run);
});

describeWithCores("Tag operation read traps",[liveNseat,needs.file("Tag read trap core",standardTrap, "Set TABLE_TRAP_WASM to a YGO_N_TRAP core"),needs.file("Domain Tag read trap core",domainTrap,"Set TABLE_TRAP_DOMAIN_WASM to a YGO_N_TRAP Domain core")],()=>{
 runScenarios("multiplayer/tag-operation-trap",[false,true].map(domain=>proof("tag",domain,"tag-read")),run);
});
