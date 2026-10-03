import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { runScenario } from "../../support/session.js";
import { activate, defineScenario, expectBoard, expectPrompt, select, yes, type Scenario, type Step, type DuelistId, type BoardExpect } from "../../support/dsl.js";
const ELF="Mystical Elf",OX="Battle Ox",ROAD="Crashbug Road";
function road(format:"ffa3"|"ffa4"|"tag",domain:boolean):Scenario {
 const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"]:["p0","p1","p2","p3"];
 const setup:Scenario["setup"]={format,...(domain ? {mode:"domain"}:{})};const board:BoardExpect={};
 for(const seat of seats) {
  setup[seat]={monsters:[ELF],hand:[OX,"Giant Rat",...(seat==="p0" ? [ROAD]:[])],deck:Array(20).fill(ELF),...(domain ? {deckMaster:"Blue-Eyes White Dragon"}:{})};
  const drawn=seat==="p0" && domain;
  board[seat]={lp:format==="tag" ? 16000:8000,monsters:[ELF,OX],hand:drawn ? ["Giant Rat",ELF]:["Giant Rat"],deckCount:drawn ? 19:20,spells:[],grave:seat==="p0" ? [ROAD]:[],banished:[],...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}}:{})};
 }
 const steps:Step[]=[activate(ROAD,"p0"),select({card:OX,owner:"p0",from:"hand"})];
 for(const seat of seats.slice(1))steps.push(expectPrompt({by:seat,kind:"choice"}),yes(seat),select({card:OX,owner:seat,from:"hand"}));
 steps.push(expectPrompt({by:"p0",context:"action"}),expectBoard(board));
 return defineScenario({id:`no-opponent-road-${format}${domain ? "-domain":""}`,title:"Each duelist summons without an opponent declaration",
  source:"Owner answer 2026-10-02 night; R-COMMON-EACH-PLAYER",rules:["R-COMMON-EACH-PLAYER"],tags:["multiplayer"],setup,steps});
}
describeWithCores("own and each-player actions have no opponent prompt",liveNseat,()=>runScenarios("multiplayer/no-opponent-own-actions",
 [false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).map(format=>road(format,domain))),runScenario));
