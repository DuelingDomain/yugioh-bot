import { it } from "vitest";
import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { activate, attack, changePhase, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, no, yes, normalSummon, pickOpponent, select, zone, type DuelistId, type Scenario, type Step, type BoardExpect } from "../../support/dsl.js";
const ELF="Mystical Elf", RAT="Giant Rat", OX="Battle Ox", AXE="Axe Raider", OGRE="Ogre of the Scarlet Sorrow", TUALATIN="Tualatin";
const SKIP_DRAW=`local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD); e:SetCode(EFFECT_SKIP_DP); e:SetProperty(EFFECT_FLAG_PLAYER_TARGET); e:SetTargetRange(1,1); Duel.RegisterEffect(e,0)`;
function proof(format:"ffa3"|"ffa4"|"tag",domain:boolean,ogre:boolean):Scenario {
  const seats:DuelistId[]=format==="ffa3" ? ["p0","p1","p2"] : ["p0","p1","p2","p3"], tag=format==="tag";
  const setup:Scenario["setup"]={format,attackFirstTurn:true,...(domain ? {mode:"domain" as const} : {})};
  const board:BoardExpect={};
  for(const seat of seats) {
    setup[seat]={deck:Array(20).fill(ELF),...(domain ? {deckMaster:"Blue-Eyes White Dragon"} : {})};
    board[seat]={lp:tag ? 16000 : 8000,hand:[],monsters:[],spells:[],grave:[],banished:[],deckCount:20,...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
  }
  const steps:Step[]=[];
  if(ogre) {
    setup.p0!.hand=[OGRE];setup.p1!.monsters=[RAT,OX,AXE];
    setup.p2!.monsters=tag ? [] : [ELF];if(format!=="ffa3")setup.p3!.monsters=[ELF];
    steps.push(endTurn("p0"),changePhase("battle","p1"),attack(RAT,"direct","p1"),...(tag ? [pickOpponent("p0","p1")] : [yes("p1")]),attack(OX,"direct","p1"),...(tag ? [pickOpponent("p0","p1")] : [yes("p1")]),activate(OGRE,"p0"),expectPrompt({by:"p1",offers:["yes","no"]}),no("p1"));
    // The real lock is inspected by the continuous observer. Only p1 is marked in FFA.
    board.p0!.monsters=[OGRE];board.p0!.lp=(tag ? 16000 : 8000)-1400;
    board.p1!.monsters=[RAT,OX,AXE];board.p1!.lp=tag ? 15800 : 7900;
    board.p2!.monsters=tag ? [] : [ELF];if(format!=="ffa3")board.p3!.monsters=[ELF];
    if(tag){board.p2!.lp=14600;board.p3!.lp=15800;}
  } else {
    setup.p0!.hand=[TUALATIN];setup.p0!.monsters=[ELF,ELF];setup.p1!.monsters=[OX,OX];
    for(const seat of seats.slice(1)){setup[seat]!.hand=[RAT];board[seat]!.hand=[RAT];}
    for(const seat of seats.slice(2))setup[seat]!.monsters=tag && seat==="p2" ? [] : [ELF,OX];
    if(tag){
      // The partner's monsters enter after the Battle Phase starts. They must not
      // prevent the loss of the two original monsters from triggering Tualatin.
      setup.p2!.grave=[ELF,OX];
      setup.p2!.spells=[{card:"Call of the Haunted",pos:"set"},{card:"Oasis of Dragon Souls",pos:"set"}];
    }
    for(const seat of seats)steps.push(endTurn(seat));steps.push(endTurn("p0"));
    steps.push(changePhase("battle","p1"),attack({card:OX,nth:0},{card:ELF,owner:"p0",nth:0},"p1"));
    if(tag)steps.push(activate("Call of the Haunted","p2"),select({card:ELF,owner:"p2",from:"grave"}),activate("Oasis of Dragon Souls","p2"),select({card:OX,owner:"p2",from:"grave"}),expectPrompt({by:"p1",offers:["yes","no"]}),yes("p1"),select({card:ELF,owner:"p0",nth:0}));
    steps.push(attack({card:OX,nth:0},{card:ELF,owner:"p0",nth:0},"p1"),activate(TUALATIN,"p0"),zone("p0","m0","p0"),choose("Face-up Attack","p0"),expectPrompt({by:"p0",kind:"cards"}),choose("EARTH","p0"),changePhase("main2","p1"),expectNotOffered("normalSummon",RAT,"p1"),endTurn("p1"),expectOffered("normalSummon",RAT,"p2"),normalSummon(RAT,"p2"));
    board.p0!.lp=tag ? 14200 : 6200;board.p0!.monsters=[TUALATIN];board.p0!.grave=[ELF,ELF];board.p1!.grave=[OX,OX];
    board.p2!.monsters=[ELF,RAT];board.p2!.grave=[OX,...(tag ? ["Oasis of Dragon Souls"] : [])];board.p2!.hand=[];
    if(tag){board.p2!.lp=14200;board.p2!.spells=["Call of the Haunted"];}
    if(format!=="ffa3") {
      steps.push(endTurn("p2"),tag ? expectNotOffered("normalSummon",RAT,"p3") : expectOffered("normalSummon",RAT,"p3"));
      if(!tag){steps.push(normalSummon(RAT,"p3"));board.p3!.monsters=[ELF,RAT];board.p3!.grave=[OX];board.p3!.hand=[];}
      else {board.p3!.monsters=[ELF];board.p3!.grave=[OX];}
    }
  }
  steps.push(expectBoard(board));
  return defineScenario({id:`causal-response-${ogre ? "ogre" : "tualatin"}-${format}${domain ? "-domain" : ""}`,title:"The response lock binds the opponent who caused the event",source:"R-FFA-OPP-RESPONSE; owner night answers",rules:["R-FFA-OPP-RESPONSE"],tags:["multiplayer",`card:${ogre ? 82670878 : 27769400}`],setup,steps});
}
async function run(scenario:Scenario) {
  const compiled=compileBoard(scenario.setup);
  const content=SKIP_DRAW+(scenario.id.includes("ogre") ? readFileSync(new URL("./fixtures/ogre-lock-observer.lua",import.meta.url),"utf8").replace("FIXTURE_SEAT_COUNT",String(scenario.setup.format==="ffa3" ? 3 : 4)) : "");
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,multiWasmBinary:scenario.setup.mode==="domain" ? domainNseatWasmBinary() : nseatWasmBinary(),startupScripts:[...compiled.options.startupScripts!,{name:"response-lock-observer.lua",content}],seed:["1","2","3","4"]});
  try{
    const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();
    scenario.steps.forEach((step,index)=>{
      if(scenario.id.includes("tualatin-tag") && (step.op==="phase" || step.op==="attack")) {
        // Decline routine windows from the two revival Traps. The explicit Trap
        // activations and the Tualatin trigger retain their real prompts below.
        for(let guard=0;guard<40;guard++){
          const open=Array.from({length:compiled.options.decks.length},(_,seat)=>({seat,prompt:game.view(seat).prompt})).find(row=>row.prompt);
          if(!open?.prompt || open.prompt.context?.type!=="chain" || open.prompt.context.forced)break;
          game.answer(open.seat,open.prompt.id,{cancel:true});
        }
      }
      session.run(step,index+1);
    });
  }finally{game.close();}
}
describeWithCores("causal response locks on both cores",[liveNseat,...needs.domainMulti()],()=>runScenarios("causal-response-locks",[false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).flatMap(format=>[proof(format,domain,true),proof(format,domain,false)])),run));

describeWithCores("Response wrappers restore the register function",[liveNseat,...needs.domainMulti()],()=>{
 for(const code of [27769400,82670878]) for(const domain of [false,true]) it(`${code} restores after an error${domain ? " Domain" : " Standard"}`,async()=>{
  const overlay=readFileSync(new URL(`../../../domain-core/multi-scripts/c${code}.lua`,import.meta.url),"utf8");
  const wrapper=overlay.slice(overlay.indexOf("local mp_lock_initial=s.initial_effect"));
  const content=`local original=Card.RegisterEffect
local s={initial_effect=function() error("response-wrapper-test",0) end}
${wrapper}
local ok,err=pcall(s.initial_effect,{})
local restored=Card.RegisterEffect==original
Card.RegisterEffect=original
assert(not ok and err=="response-wrapper-test","The wrapper must return the original error")
assert(restored,"The wrapper must restore Card.RegisterEffect after an error")`;
  const compiled=compileBoard({format:"ffa3",deckSize:20,...(domain ? {mode:"domain" as const,p0:{deckMaster:"Blue-Eyes White Dragon"},p1:{deckMaster:"Blue-Eyes White Dragon"},p2:{deckMaster:"Blue-Eyes White Dragon"}} : {})});
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,multiWasmBinary:domain ? domainNseatWasmBinary() : nseatWasmBinary(),startupScripts:[...compiled.options.startupScripts!,{name:"response-wrapper-error-test.lua",content}],seed:["1","2","3","4"]});
  game.close();
 });
});
