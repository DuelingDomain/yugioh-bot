import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered,
 type Scenario, type Step, type DuelistId, type BoardExpect } from "../../support/dsl.js";

const ELF="Mystical Elf", OX="Battle Ox", STONE="Giant Soldier of Stone", CURE="Dian Keto the Cure Master";
function proof(format:"ffa3"|"ffa4"|"tag",domain:boolean,target:DuelistId):Scenario {
 const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"] : ["p0","p1","p2","p3"];
 const setup:Scenario["setup"]={format,attackFirstTurn:true,...(domain ? {mode:"domain"}: {})};
 for(const seat of seats) setup[seat]={monsters:seat==="p0" ? [STONE,OX] : [OX],deck:Array(20).fill(ELF),
  ...(seat==="p1" ? {hand:[CURE]} : {}),...(domain ? {deckMaster:"Blue-Eyes White Dragon"}: {})};
 const steps:Step[]=[endTurn("p0"),activate(CURE,"p1")];
 const end=target==="p0" ? seats.length : seats.indexOf(target);
 for(let i=1;i<end;i++) steps.push(endTurn(seats[i]));
 steps.push(changePhase("battle",target));
 const blocked=target!=="p0" && (format!=="tag" || target!=="p2");
 steps.push(blocked ? expectNotOffered("attack",OX,target) : expectOffered("attack",OX,target));
 const board:BoardExpect={};
 for(let i=0;i<seats.length;i++) {
  const seat=seats[i],draws=seat==="p0" ? (domain ? 1 : 0)+(target==="p0" ? 1:0) : i<=end ? 1:0;
  board[seat]={lp:format==="tag" ? (seat==="p1"||seat==="p3" ? 17000:16000) : seat==="p1" ? 9000:8000,
   monsters:seat==="p0" ? [STONE,OX]:[OX],hand:Array(draws).fill(ELF),deckCount:20-draws,
   spells:[],grave:seat==="p1" ? [CURE]:[],banished:[],...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}}:{})};
 }
 steps.push(expectBoard(board));
 return defineScenario({id:`continuous-watcher-lock-${format}-${target}${domain ? "-domain":""}`,title:"Continuous watcher locks all opponents",
  source:"Owner answer 2026-10-02 night; R-COMMON-ONGOING",rules:["R-COMMON-ONGOING"],tags:["multiplayer"],setup,steps});
}
async function run(scenario:Scenario):Promise<void> {
 const compiled=compileBoard(scenario.setup);
 const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
  multiWasmBinary:scenario.setup.mode==="domain" ? domainNseatWasmBinary():nseatWasmBinary(),seed:["1","2","3","4"],
  startupScripts:[{name:"continuous-watcher-lock.lua",content:readFileSync(new URL("./fixtures/continuous-watcher-lock.lua",import.meta.url),"utf8")},...(compiled.options.startupScripts??[])]});
 try {const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();scenario.steps.forEach((step,i)=>session.run(step,i+1));}
 finally {game.close();}
}
describeWithCores("continuous watcher lock",liveNseat,()=>runScenarios("multiplayer/continuous-watcher-lock",
 [false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).flatMap(format=>(format==="ffa3" ? ["p0","p1","p2"] as const : ["p0","p1","p2","p3"] as const).map(target=>proof(format,domain,target)))),run));
