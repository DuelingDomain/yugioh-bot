import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered,
  expectOffered, expectPickSeats, expectPrompt, faceDown, pickOpponent, type BoardExpect,
  type Scenario, type Step } from "../../support/dsl.js";

const ELF="Mystical Elf", CURE="Dian Keto the Cure Master", ROAR="Threatening Roar", OX="Battle Ox";
function proof(format: "ffa3" | "ffa4" | "tag", domain: boolean, clone: boolean, blocked = false): Scenario {
  const seats = format==="ffa3" ? ["p0","p1","p2"] as const : ["p0","p1","p2","p3"] as const;
  const setup: Scenario["setup"] = { format, attackFirstTurn:true, ...(domain ? { mode:"domain" } : {}),
    p0:{spells:[faceDown(ROAR)]}, p1:{hand:[CURE],monsters:[OX]}, p2:{monsters:[ELF]} };
  for(const seat of seats) setup[seat]={deck:Array(20).fill(ELF),...setup[seat],
    ...(domain ? {deckMaster:"Blue-Eyes White Dragon"} : {})};
  const steps: Step[]=[endTurn("p0"),activate(CURE,"p1"),activate(ROAR,"p0")];
  if(format!=="tag") steps.push(expectPickSeats(seats.filter(s=>s!=="p0"),"p0"),pickOpponent(blocked ? "p1" : "p2","p0"));
  steps.push(expectPrompt({by:"p1",context:"action"}),changePhase("battle","p1"));
  const board: BoardExpect={};
  for(const seat of seats) {
    const draws=seat==="p1" || (seat==="p0" && domain) ? 1 : 0;
    board[seat]={lp:format==="tag" ? 16000 : 8000,monsters:[],spells:[],grave:[],banished:[],
      hand:Array(draws).fill(ELF),deckCount:20-draws,
      ...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
  }
  board.p0!.grave=[ROAR];
  board.p1={...board.p1!,monsters:[OX],grave:[CURE],lp:format==="tag" ? 17000 : 9000};
  if(format==="tag" || blocked) {
    steps.push(expectNotOffered("attack",OX,"p1"));
    board.p2!.monsters=[ELF]; if(format==="tag") board.p3!.lp=17000;
  } else {
    steps.push(expectOffered("attack",OX,"p1"),attack(OX,{card:ELF,owner:"p2"},"p1"));
    board.p2={...board.p2!,grave:[ELF],lp:7100};
  }
  steps.push(expectBoard(board));
  return defineScenario({id:`activated-global-lock-${clone ? "clone-" : ""}${format}${blocked ? "-blocked" : "-spared"}${domain ? "-domain" : ""}`,
    title:`${format}: an activated ${clone ? "GlobalEffect clone" : "GlobalEffect"} keeps the declared opponent${domain ? " (Domain)" : ""}`,
    source:"Owner-approved GlobalEffect constructor fixture; R-FFA-ACTIVATED-LOCK",
    rules:["R-FFA-ACTIVATED-LOCK","R-FFA-OPP-ONE"],tags:["multiplayer","activated-global-lock",format,...(domain ? ["domain"] : [])],
    setup,steps});
}
async function runWithFixture(scenario: Scenario): Promise<void> {
  const compiled=compileBoard(scenario.setup);
  const fixture=readFileSync(new URL("./fixtures/activated-global-roar.lua",import.meta.url),"utf8");
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
    multiWasmBinary:scenario.setup.mode==="domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts:[{name:"activated-global-roar-fixture.lua",content:
      `ACTIVATED_GLOBAL_CLONE=${scenario.id.includes("-clone-") ? "true" : "false"}\n${fixture}`},...(compiled.options.startupScripts ?? [])],
    seed:["1","2","3","4"]});
  try {
    const session=new Session(scenario,game);
    session.reachMainPhase();session.startRecording();
    scenario.steps.forEach((step,index)=>{
      session.run(step,index+1);
      if(index===0) {
        // Decline the trap's optional Draw/Standby/start-of-Main windows;
        // its explicit activation follows the real Cure Master chain.
        for(let guard=0;guard<40;++guard) {
          const open=Array.from({length:compiled.options.decks.length},(_,seat)=>
            ({seat,prompt:game.view(seat).prompt})).find(row=>row.prompt);
          if(!open?.prompt || open.prompt.context?.type!=="chain" || open.prompt.context.forced) break;
          game.answer(open.seat,open.prompt.id,{cancel:true});
        }
      }
    });
  } finally {game.close();}
}
describeWithCores("activated GlobalEffect locking scope",[liveNseat,...needs.domainMulti()],()=>{
  runScenarios("multiplayer/activated-global-lock",[false,true].flatMap(domain=>[false,true].flatMap(clone=>
    (["ffa3","ffa4","tag"] as const).flatMap(format=>[proof(format,domain,clone),...(format==="tag" ? [] : [proof(format,domain,clone,true)])]))),runWithFixture);
});
