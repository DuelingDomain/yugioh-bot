import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { expectPrompt, type Scenario } from "../../support/dsl.js";
import { TABLE_CARD_SCENARIOS } from "./table-cards.js";
const cases=TABLE_CARD_SCENARIOS.filter(s=>s.id.includes("pudica-standby-return-goes")||s.id.includes("summoning-curse-two-opponents"));
async function run(scenario:Scenario):Promise<void>{
 const compiled=compileBoard(scenario.setup);
 const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,multiWasmBinary:nseatWasmBinary(),seed:["1","2","3","4"]});
 try{
  const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();
  for(const [i,step] of scenario.steps.entries()){
   if(step.op==="select"&&(step as {by?:string}).by==="p1"){
    session.run(expectPrompt({by:"p1",kind:"cards"}),i+1);
    // Standard MR5: p0 has drawn only once. Its hand has exactly one legal card.
    expect(game.view(0).seats[0].hand).toHaveLength(1);
    expect(game.view(0).seats[0].banished).toHaveLength(0);
    expect(game.view(0).seats[0].hand[0].name).toBe("Mystical Elf");
    expect(game.view(1).prompt).not.toBeNull();
   }
   session.run(step,i+1);
   if(step.op==="activate"&&(typeof step.sel==="object"?step.sel.card:step.sel)==="Monster Reborn"){
    // Settle Reborn and reach Pudica's optional trigger without a seat selection.
    session.run(expectPrompt({by:"p0",kind:"choice",offers:["yes"]}),i+1);
    // Only p0 has a legal Graveyard card. Reborn needs no opposing duelist choice.
    expect(game.view(0).prompt?.context?.type).not.toBe("opponent");
    expect(game.view(0).seats[0].monsters.filter(Boolean).map(c=>c!.name)).toContain("Traptrix Pudica");
    for(const seat of game.view(0).seats.slice(1)) expect(seat.graveyard).toHaveLength(0);
   }
  }
 }finally{game.close();}
}
describeWithCores("Table automatic choices",liveNseat,()=>{runScenarios("multiplayer/table-choice-scope",cases,run);});
