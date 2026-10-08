import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { nseatWasmBinary, Session } from "../../support/session.js";
import { activate, expectBoard, type BoardExpect, type DuelistId } from "../../support/dsl.js";
let ownedPath: string | undefined;
afterEach(()=>{vi.unstubAllEnvs();if(ownedPath)rmSync(ownedPath,{recursive:true,force:true});ownedPath=undefined;});
const root=resolve("domain-core/.build/phase1/gap-overlay/player-all/boundary");
const forms=["ffa3","ffa4","tag"] as const;
const cases=[
  {name:"ss-nil",category:"CATEGORY_SPECIAL_SUMMON",group:"nil",count:0},
  {name:"ss-numeric-zero",category:"CATEGORY_SPECIAL_SUMMON",group:"0",count:0},
  {name:"ss-and-destroy-three",category:"CATEGORY_SPECIAL_SUMMON|CATEGORY_DESTROY",group:"g",count:3},
  {name:"ss-one",category:"CATEGORY_SPECIAL_SUMMON",group:"g",count:1,bad:true},
  {name:"ss-two",category:"CATEGORY_SPECIAL_SUMMON",group:"g",count:2},
  {name:"ss-three",category:"CATEGORY_SPECIAL_SUMMON",group:"g",count:3,bad:true},
  {name:"ss-four",category:"CATEGORY_SPECIAL_SUMMON",group:"g",count:4,bad:true},
  {name:"destroy-three",category:"CATEGORY_DESTROY",group:"g",count:3},
  {name:"ss-possible-three",category:"CATEGORY_SPECIAL_SUMMON",group:"g",count:3,possible:true},
];
describeWithCores("live PLAYER_ALL operation-info API",liveNseat,()=>{
for(const format of forms)for(const c of cases)it(`${format} ${c.name}: real activation writes PLAYER_ALL operation info`,async()=>{
  mkdirSync(root,{recursive:true});
  const path=mkdtempSync(resolve(root,`${format}-${c.name}-`));ownedPath=path;
  writeFileSync(resolve(path,"mp-utility.lua"),readFileSync("domain-core/multi-scripts/mp-utility.lua","utf8"));
  writeFileSync(resolve(path,"MANIFEST.json"),JSON.stringify({version:1,cards:[{code:55144522,name:"Pot of Greed",file:"c55144522.lua",kind:"whole"}]}));
  writeFileSync(resolve(path,"c55144522.lua"),`--@replace
local s,id=GetID()
function s.initial_effect(card)
 local e=Effect.CreateEffect(card)
 e:SetType(EFFECT_TYPE_ACTIVATE) e:SetCode(EVENT_FREE_CHAIN)
 e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return true end
  local g=Duel.GetFieldGroup(tp,LOCATION_GRAVE,0)
  Duel.${c.possible?"SetPossibleOperationInfo":"SetOperationInfo"}(0,${c.category},${c.group},${c.count},PLAYER_ALL,0)
 end)
 e:SetOperation(function(e,tp) Duel.Draw(tp,1,REASON_EFFECT) end)
 card:RegisterEffect(e)
end
`);
  vi.stubEnv("DUEL_MULTI_SCRIPTS_DIR",path);
  const grave=Array.from({length:c.count},()=>"Celtic Guardian");
  const board:BoardExpect={};for(let i=0;i<(format==="ffa3"?3:4);i++)board[`p${i}` as DuelistId]={lp:format==="tag"?16000:8000,hand:i===0?["Mystical Elf"]:[],monsters:[],spells:[],grave:i===0?[...grave,"Pot of Greed"]:[],banished:[],extra:[],deckCount:i===0?19:20};
  const scenario={id:`player-all-operation-info-${format}-${c.name}`,title:"Real PLAYER_ALL boundary",source:"P68 SetOperationInfo",tags:["multiplayer","player-all-operation-info",format],setup:{format,p0:{hand:["Pot of Greed"],grave}},steps:[activate("Pot of Greed","p0"),expectBoard(board)]};
  const reported = vi.fn();
  const run = async () => {
    const compiled = compileBoard(scenario.setup);
    const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
      multiWasmBinary: nseatWasmBinary(),
      seed: ["1", "2", "3", "4"], scriptErrorMode: c.bad ? "strict" : "tolerant", onScriptError: reported });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase(); session.startRecording();
      scenario.steps.forEach((step, index) => session.run(step, index + 1));
    } finally { game.close(); }
  };
  if (c.bad) {
    const error: unknown = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Card script error (strict mode): an effect may not have resolved correctly.");
    expect((error as Error).message).not.toMatch(/group size wasn't exactly 2|c55144522\.lua/);
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({
      code: 55144522, scriptErrorMode: "strict", message: expect.stringContaining("group size wasn't exactly 2"),
    }));
  } else {
    await run();
    expect(reported).not.toHaveBeenCalled();
  }
});

});
