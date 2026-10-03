import { activate, expectBoard, expectPickOptions, expectPrompt, select, yes, defineScenario, type Scenario, type Step, type DuelistExpect } from '../../support/dsl.js';
import { baseSetup, everySeat, SEATS, type Format, type Seat } from './seat-kit.js';
export const RIOTS_REASON_OWNER_SCENARIOS: Scenario[] = (['ffa3','ffa4','tag'] as Format[]).flatMap(format => [false,true].map(stolen => {
 const late:Seat=format==='ffa3'?'p2':'p3';
 const spec:Partial<Record<Seat,DuelistExpect>>={};
 for(const p of SEATS[format])spec[p]={hand:[],extra:[],deckCount:20};
 let setup:Scenario['setup'];let steps:Step[]=[];

  const controller = stolen ? 'p0' : late;
  const owner = stolen ? 'p1' : late;
  setup=baseSetup(format,{p0:{hand:["Riot's Reason"]},p1:{hand:['Celtic Guardian']}});
  setup[controller]!.monsters=[{card:'Battle Ox',pos:'set'}];
  // The only target is automatic. The next prompt must be the owner's summon choice.
  steps=[activate("Riot's Reason",'p0'),expectPrompt({by:owner,kind:'choice',title:'Special Summon',offers:['yes','no']})];
  if(stolen) steps.push(expectBoard({p0:{monsters:[]},p1:{hand:['Celtic Guardian','Battle Ox']}}));
  steps.push(yes(owner));
  if(stolen) steps.push(expectPickOptions([{seat:owner,card:'Celtic Guardian'},{seat:owner,card:'Battle Ox'}],owner),select('Battle Ox'));
  spec.p0={hand:[],grave:["Riot's Reason"]};spec.p1={hand:['Celtic Guardian']};
  spec[owner]={...spec[owner],monsters:['Battle Ox'],zones:{m0:{card:'Battle Ox',pos:'set'}}};

 for(const p of SEATS[format])spec[p]={extra:[],deckCount:20,...spec[p]};
 steps.push(expectPrompt({by:'p0',context:'action'}),everySeat(format,spec));
 return defineScenario({id:`riots-reason-owner-51612489-${format}${stolen?'-stolen':''}`,title:`Riot's Reason: return to the owner and offer that owner's summon without an opponent pick`,source:'docs/adr/0002-multiplayer-duel-rules.md',tags:['multiplayer',format,'card:51612489',...(stolen?['stolen']:[])],setup,steps});
}));
