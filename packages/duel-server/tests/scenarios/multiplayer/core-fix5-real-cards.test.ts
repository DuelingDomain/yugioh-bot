import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, expectTurn, pickOpponent, select,
  type Scenario, type DuelistId, type Step, type BoardExpect } from "../../support/dsl.js";
const ELF="Mystical Elf", OX="Battle Ox", LAND="Burning Land", LOTUS="Appointer of the Red Lotus", AXE="Axe Raider", FANG="Silver Fang";
type Format="1v1"|"ffa3"|"ffa4"|"tag";
function proof(format:Format,domain:boolean,card:typeof LAND|typeof LOTUS):Scenario {
  const n=format==="1v1"?2:format==="ffa3"?3:4;
  const seats=(["p0","p1","p2","p3"] as DuelistId[]).slice(0,n);
  const target=seats[n-1], lotus=card===LOTUS;
  const setup:Scenario["setup"]={format,...(domain?{mode:"domain"}:{})};
  for(const seat of seats) setup[seat]={monsters:[OX],deck:Array(20).fill(ELF),hand:lotus?seat==="p0"?[ELF]:seat===target?[AXE,FANG]:[OX]:seat==="p0"?[LAND]:[],
    ...(lotus&&seat==="p0"?{spells:[{card:LOTUS,pos:"set" as const}]}:{}),...(domain?{deckMaster:"Blue-Eyes White Dragon"}:{})};
  const draws=Array(n).fill(0);draws[0]=Number(domain&&format!=="1v1");
  const damaged=new Set<DuelistId>();let returned=false;
  const board=():BoardExpect=>Object.fromEntries(seats.map((seat,i)=>[seat,{
    lp:(format==="tag"?16000:8000)-(lotus?(seat==="p0"||(format==="tag"&&seat==="p2")?2000:0):500*([...damaged].filter(p=>format==="tag"?Number(p.slice(1))%2===i%2:p===seat).length)),
    monsters:[OX],spells:seat==="p0"&&!lotus?[LAND]:[],grave:seat==="p0"&&lotus?[LOTUS]:[],
    banished:lotus&&seat===target&&!returned?[AXE]:[],
    hand:[...(lotus?seat==="p0"?[ELF]:seat===target?(returned?[AXE,FANG]:[FANG]):[OX]:[]),...Array(draws[i]).fill(ELF)],
    deckCount:20-draws[i],...(domain?{deckMaster:{inZone:true,returns:0,nextCost:0}}:{})
  }]));
  const steps:Step[]=[activate(card,"p0")];
  if(lotus) {
    if(format!=="1v1") steps.push(expectPickSeats(format==="tag"?["p1","p3"]:seats.slice(1),"p0"),pickOpponent(target,"p0"));
    steps.push(select({card:AXE,owner:target}));
  }
  steps.push(expectPrompt({by:"p0",context:"action"}),expectBoard(board()));
  for(let turn=2;turn<=n+1;turn++) {
    const previous=seats[(turn-2)%n],next=seats[(turn-1)%n];
    if(lotus&&(format.startsWith("ffa")?previous===target:previous==="p1")) returned=true;
    if(!lotus) damaged.add(next);
    draws[Number(next.slice(1))]++;
    steps.push(endTurn(previous),expectTurn(next,turn),expectPrompt({by:next,context:"action"}),expectBoard(board()));
  }
  return defineScenario({id:`core-fix5-${lotus?"appointer":"burning-land"}-${format}${domain?"-domain":""}`,
    title:`${format}: ${lotus?"the player effect returns the card after its counted opponent turn":"Burning Land damages the turn player with no opponent pick"}`,
    source:"Owner duration scope and Opus core-fix4 review HIGH-1/HIGH-2",rules:format.startsWith("ffa")?[lotus?"R-FFA-DECLARED-DURATION":"R-FFA-OPP-RESPONSE"]:!lotus?["R-COMMON-ONGOING"]:format==="tag"?["R-TAG-ORDER","R-COMMON-OPP-PICK"]:["R-COMMON-OPP-PICK"],
    tags:["multiplayer",`card:${lotus?43262273:24294108}`],setup,steps});
}
async function run(scenario:Scenario):Promise<void> {
  const compiled=compileBoard(scenario.setup);
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
    multiWasmBinary:scenario.setup.mode==="domain"?domainNseatWasmBinary():nseatWasmBinary(),seed:["1","2","3","4"]});
  try {const session=new Session(scenario,game);session.reachMainPhase();session.startRecording();scenario.steps.forEach((step,i)=>session.run(step,i+1));}
  finally {game.close();}
}
describeWithCores("Core fix5 real card controls",liveNseat,()=>runScenarios("multiplayer/core-fix5-real-cards",
  [false,true].flatMap(domain=>(["1v1","ffa3","ffa4","tag"] as const).flatMap(format=>([LAND,LOTUS] as const).map(card=>proof(format,domain,card)))),run));
