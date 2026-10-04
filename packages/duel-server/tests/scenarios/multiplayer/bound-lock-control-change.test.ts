import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickOptions, normalSummon, pickOpponent, select, type Scenario, type DuelistId, type OptionRef } from "../../support/dsl.js";

const SOURCE = "Giant Soldier of Stone";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const SKULL = "Summoned Skull";
const HEART = "Change of Heart";

function proof(format: "ffa3" | "ffa4" | "tag", domain: boolean, declaredTakes = false): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0","p1","p2"] as const : ["p0","p1","p2","p3"] as const;
  const taker = declaredTakes ? "p1" : format === "ffa3" ? "p2" : "p3";
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}),
    p0: { monsters: [SOURCE, OX] }, p1: { monsters: [ELF] }, [taker]: { hand: [HEART, SKULL], ...(taker === "p1" ? { monsters:[ELF] } : {}) } };
  for (const seat of seats) setup[seat] = { ...setup[seat], deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
  const turns = seats.slice(0,seats.indexOf(taker)).map(seat=>endTurn(seat));
  const steps = [activate(SOURCE,"p0"), ...turns, activate(HEART,taker), ...(format === "tag" || declaredTakes ? [] : [pickOpponent("p0",taker)]),
    select({card:SOURCE,owner:"p0"}),normalSummon(SKULL,taker)];
  const choices: OptionRef[] = [{card:SKULL,seat:taker},{card:ELF,seat:taker}];
  if(declaredTakes) choices.push({card:ELF,seat:taker},{card:OX,seat:"p0"});
  if(!declaredTakes && format !== "tag") choices.push({card:ELF,seat:"p1"});
  if(format === "tag") choices.push({card:ELF,seat:"p1"},{card:OX,seat:"p0"});
  steps.push(expectPickOptions(choices,taker),select({card:format === "tag" || declaredTakes ? OX : ELF,owner:format === "tag" || declaredTakes ? "p0" : "p1"}));
  const board: Record<string,any> = {};
  for(const seat of seats) {
    const draws=seat !== "p0" && seats.indexOf(seat)<=seats.indexOf(taker) || seat === "p0" && domain ? 1 : 0;
    board[seat]={lp:format === "tag" ? 16000 : 8000,spells:[],banished:[],hand:Array(draws).fill(ELF),deckCount:20-draws,
      monsters:seat === "p0" ? [OX] : seat === "p1" ? [ELF] : [],grave:[],...(domain ? {deckMaster:{inZone:true,returns:0,nextCost:0}} : {})};
  }
  board[taker].monsters=[...(declaredTakes ? [ELF] : []),SOURCE,SKULL];board[taker].grave=[HEART];
  if(declaredTakes) { board.p0.monsters=[];board.p0.grave=[OX]; }
  else if(format === "tag") {board.p0.monsters=[];board.p0.grave=[OX];}
  else {board.p1.monsters=[];board.p1.grave=[ELF];}
  steps.push(expectBoard(board));
  return defineScenario({id:`bound-lock-${format}-control-change${declaredTakes ? "-declared-takes" : ""}${domain ? "-domain" : ""}`,
    title:`${format}: current handler scope after control change`,source:"C4 current controller fixture; real Change of Heart and Tribute Summon",
    tags:["multiplayer","control-change"],rules:["R-FFA-ACTIVATED-LOCK", "R-FFA-LOCK-CONTROL-CHANGE"],setup,steps});
}

async function runWithFixture(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const fixture = readFileSync(new URL("./fixtures/activated-extra-tribute.lua", import.meta.url), "utf8");
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts: [{ name: "activated-extra-tribute-fixture.lua", content: fixture }, ...(compiled.options.startupScripts ?? [])],
    seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}

describeWithCores("bound field range after control change", liveNseat, () => {
  runScenarios("multiplayer/bound-lock-control-change", [false,true].flatMap(domain=>(["ffa3","ffa4","tag"] as const).flatMap(format=>[proof(format,domain),...(format==="tag" ? [] : [proof(format,domain,true)])])), runWithFixture);
});
