import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { activate, defineScenario, expectBoard, expectNotOffered, expectPrompt, no, yes, select, type DuelistId, type Scenario, type Step, type BoardExpect } from "../../support/dsl.js";
const ELF="Mystical Elf", CIRCLE="Underworld Circle";
function proof(format:"ffa3"|"ffa4"|"tag",domain:boolean,summon:boolean):Scenario {
 const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"] : ["p0","p1","p2","p3"];
 const setup:Scenario["setup"]={format,deckSize:2,...(domain ? {mode:"domain" as const} : {})},board:BoardExpect={};
 for(const seat of seats) {
  setup[seat]={hand:seat==="p0" ? [CIRCLE] : [],monsters:[ELF],grave:Array(5).fill(ELF),deck:[ELF,ELF],...(domain ? {deckMaster:"Blue-Eyes White Dragon"} : {})};
  board[seat]={lp:format==="tag" ? 16000 : 8000,hand:[],monsters:seat==="p0" && summon ? [ELF] : [],spells:seat==="p0" ? [CIRCLE] : [],grave:Array(seat==="p0" && summon ? 5 : 6).fill(ELF),banished:[ELF,ELF],deckCount:0,...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
 }
 const steps:Step[]=[activate(CIRCLE,"p0"),expectPrompt({by:"p0",kind:"choice",offers:["yes","no"]}),summon ? yes("p0") : no("p0")];
 if(summon)steps.push(select({card:ELF,owner:"p0",from:"grave",nth:0}));
 steps.push(expectPrompt({by:"p0",context:"action"}),expectBoard(board));
 return defineScenario({id:`no-opponent-circle-${format}-${summon ? "yes" : "no"}${domain ? "-domain" : ""}`,title:"Circle's own Graveyard choice has no opponent declaration",source:"R-COMMON-OPP-PICK; owner review finding 2",rules:["R-COMMON-OPP-PICK"],tags:["multiplayer","card:73443672"],setup,steps});
}
function insufficient(format:"ffa3"|"ffa4"|"tag",domain:boolean,shortSeat:DuelistId):Scenario {
 const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"] : ["p0","p1","p2","p3"];
 const setup:Scenario["setup"]={format,deckSize:2,...(domain ? {mode:"domain" as const} : {})},board:BoardExpect={};
 for(const seat of seats) {
  const grave=Array(seat===shortSeat ? 4 : 5).fill(ELF),hand=seat==="p0" ? [CIRCLE] : [];
  setup[seat]={hand,monsters:[ELF],grave,deck:[ELF,ELF],...(domain ? {deckMaster:"Blue-Eyes White Dragon"} : {})};
  board[seat]={lp:format==="tag" ? 16000 : 8000,hand,monsters:[ELF],spells:[],grave,banished:[],deckCount:2,...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
 }
 return defineScenario({id:`circle-every-living-duelist-${format}-short-${shortSeat}${domain ? "-domain" : ""}`,title:"Circle needs five monsters in every living duelist's Graveyard",source:"R-COMMON-EACH-PLAYER; Underworld Circle card text",rules:["R-COMMON-EACH-PLAYER"],tags:["multiplayer","card:73443672"],setup,steps:[expectNotOffered("activate",CIRCLE,"p0"),expectBoard(board)]});
}
async function run(scenario:Scenario) {
 const compiled=compileBoard(scenario.setup);
 const skip="local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD); e:SetCode(EFFECT_SKIP_DP); e:SetProperty(EFFECT_FLAG_PLAYER_TARGET); e:SetTargetRange(1,1); Duel.RegisterEffect(e,0)";
 const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,multiWasmBinary:scenario.setup.mode==="domain" ? domainNseatWasmBinary() : nseatWasmBinary(),startupScripts:[...compiled.options.startupScripts!,{name:"circle-proof-draw-control.lua",content:skip}],seed:["1","2","3","4"]});
 try{const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();scenario.steps.forEach((step,index)=>session.run(step,index+1));}finally{game.close();}
}
function seatsForShort(format:"ffa3"|"ffa4"|"tag"):DuelistId[] { return format==="tag" ? ["p2","p3"] : [format==="ffa3" ? "p2" : "p3"]; }
describeWithCores("Circle own-GY choices on both cores",[liveNseat,...needs.domainMulti()],()=>runScenarios("no-opponent-circle",[false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).flatMap(format=>[...([false,true].map(summon=>proof(format,domain,summon))),...seatsForShort(format).map(seat=>insufficient(format,domain,seat))])),run));
