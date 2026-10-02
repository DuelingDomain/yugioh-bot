import { activate, normalSummon, pickOpponent, expectPrompt, select, yes, defineScenario, type Scenario, type Step, type DuelistExpect } from '../../support/dsl.js';
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from './seat-kit.js';
export const RIOTS_REASON_OWNER_SCENARIOS: Scenario[] = (['ffa3','ffa4','tag'] as Format[]).map(format => {
 const late:Seat=format==='ffa3'?'p2':'p3';
 const spec:Partial<Record<Seat,DuelistExpect>>={};
 for(const p of SEATS[format])spec[p]={hand:[],extra:[],deckCount:20};
 let setup:Scenario['setup'];let steps:Step[]=[];

  setup=baseSetup(format,{p0:{hand:["Riot's Reason"]},p1:{hand:['Celtic Guardian']},[late]:{monsters:[{card:'Battle Ox',pos:'set'}]}});
  steps=[activate("Riot's Reason",'p0'),...(format==='tag'?[]:[pickOpponent('p1','p0')]),yes(late)];spec.p0={hand:[],grave:["Riot's Reason"]};spec.p1={hand:['Celtic Guardian']};spec[late]={hand:[],monsters:['Battle Ox'],zones:{m0:{card:'Battle Ox',pos:'set'}}};

 for(const p of SEATS[format])spec[p]={extra:[],deckCount:20,...spec[p]};
 steps.push(expectPrompt({by:'p0',context:'action'}),everySeat(format,spec));
 return defineScenario({id:`local-controller-summons-51612489-${format}`,title:`51612489: use the real card controller or owner for a summon`,source:'docs/adr/0002-multiplayer-duel-rules.md',tags:['multiplayer',format,'card:51612489'],setup,steps});
});
