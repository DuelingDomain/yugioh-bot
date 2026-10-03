import { it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describeWithCores("Matrix ignition wrapper startup check", [liveNseat, ...needs.domainMulti()], () => {
 for (const domain of [false, true]) it(`wraps gytg with MPTarget and gyop with MPOne${domain ? " Domain" : " Standard"}`, async () => {
  const stock = readFileSync(join(engineDataDirectory, "card-scripts/official/c35569555.lua"), "utf8");
  const overlay = readFileSync(new URL("../../../domain-core/multi-scripts/c35569555.lua", import.meta.url), "utf8");
  // Run the full stock file and full overlay. Local stubs record the wrapper inputs.
  // They do not change the engine helpers or depend on the opponent-read analyzer.
  const content = `local script={}
local function GetID() return script,35569555 end
do
${stock}
end
local stock_target,stock_operation=script.gytg,script.gyop
assert(type(stock_target)=="function" and type(stock_operation)=="function","The stock Matrix functions must exist")
local target_calls,operation_calls={},{}
local target_wrapper,operation_wrapper
local aux=setmetatable({
 MPTarget=function(fn)
  table.insert(target_calls,fn)
  target_wrapper=function(...) return fn(...) end
  return target_wrapper
 end,
 MPOne=function(fn)
  table.insert(operation_calls,fn)
  operation_wrapper=function(...) return fn(...) end
  return operation_wrapper
 end
},{__index=aux})
do
 local s,id=script,35569555
${overlay}
end
assert(#target_calls==1,"MPTarget must wrap gytg once")
assert(#operation_calls==1,"MPOne must wrap gyop once")
assert(target_calls[1]==stock_target,"MPTarget must receive the stock gytg")
assert(operation_calls[1]==stock_operation,"MPOne must receive the stock gyop")
assert(script.gytg==target_wrapper and script.gytg~=stock_target,"gytg must keep the MPTarget wrapper")
assert(script.gyop==operation_wrapper and script.gyop~=stock_operation,"gyop must keep the MPOne wrapper")`;
  const compiled = compileBoard({ format: "ffa3", deckSize: 20, ...(domain ? {
   mode: "domain" as const,
   p0: { deckMaster: "Blue-Eyes White Dragon" },
   p1: { deckMaster: "Blue-Eyes White Dragon" },
   p2: { deckMaster: "Blue-Eyes White Dragon" },
  } : {}) });
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
   multiWasmBinary: domain ? domainNseatWasmBinary() : nseatWasmBinary(),
   startupScripts: [...compiled.options.startupScripts!, { name: "matrix-ignition-wrapper-test.lua", content }],
   seed: ["1", "2", "3", "4"],
  });
  game.close();
 });
});
