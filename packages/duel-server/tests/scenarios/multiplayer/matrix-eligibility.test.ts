import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { activate, defineScenario, expectBoard, expectPrompt, yes, select, type DuelistId, type Scenario, type Step, type BoardExpect } from "../../support/dsl.js";
const ELF="Mystical Elf",MATRIX="Dogmatikamatrix",RITUAL="White Relic of Dogmatika",SEARCH="Dogmatika Ecclesia, the Virtuous";
function proof(format:"ffa3"|"ffa4"|"tag",domain:boolean):Scenario {
 const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"] : ["p0","p1","p2","p3"];
 const setup:Scenario["setup"]={format,deckSize:4,...(domain ? {mode:"domain" as const} : {})},board:BoardExpect={};
 const qualifying=format==="tag" ? "p3" : "p2";
 for(const seat of seats) {
  setup[seat]={hand:seat==="p0" ? [MATRIX] : [],monsters:seat===qualifying ? [ELF] : [],deck:seat==="p0" ? [RITUAL,SEARCH,ELF,ELF] : Array(4).fill(ELF),...(domain ? {deckMaster:"Blue-Eyes White Dragon"} : {})};
  board[seat]={lp:format==="tag" ? 16000 : 8000,hand:seat==="p0" ? [RITUAL,SEARCH] : [],monsters:seat===qualifying ? [ELF] : [],spells:seat==="p0" ? [MATRIX] : [],grave:[],banished:[],deckCount:seat==="p0" ? 2 : 4,...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
 }
 const steps:Step[]=[activate(MATRIX,"p0"),expectPrompt({by:"p0",kind:"choice",offers:["yes","no"]}),yes("p0"),expectPrompt({by:"p0",kind:"choice",offers:["yes","no"]}),yes("p0"),expectPrompt({by:"p0",context:"action"}),expectBoard(board)];
 return defineScenario({id:`matrix-nonbinding-eligibility-${format}${domain ? "-domain" : ""}`,title:"An empty first opponent cannot hide another opponent's monster",source:"R-FFA-OPP-ONE; C3/C4 final review",rules:["R-FFA-OPP-ONE"],tags:["multiplayer","card:35569555"],setup,steps});
}
async function run(scenario:Scenario) {
 const compiled=compileBoard(scenario.setup);
 const skip="local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD); e:SetCode(EFFECT_SKIP_DP); e:SetProperty(EFFECT_FLAG_PLAYER_TARGET); e:SetTargetRange(1,1); Duel.RegisterEffect(e,0)";
 const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,multiWasmBinary:scenario.setup.mode==="domain" ? domainNseatWasmBinary() : nseatWasmBinary(),startupScripts:[...compiled.options.startupScripts!,{name:"circle-proof-draw-control.lua",content:skip}],seed:["1","2","3","4"]});
 try{const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();scenario.steps.forEach((step,index)=>session.run(step,index+1));}finally{game.close();}
}
describeWithCores("Matrix ordinary activation eligibility",[liveNseat,...needs.domainMulti()],()=>runScenarios("matrix-eligibility",[false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).map(format=>proof(format,domain))),run));
