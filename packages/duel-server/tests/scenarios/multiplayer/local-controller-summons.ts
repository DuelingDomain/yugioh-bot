import { activate, defineScenario, endTurn, normalSummon, pickOpponent, expectPrompt, select, yes, type Scenario, type Step, type DuelistExpect } from '../../support/dsl.js';
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from './seat-kit.js';
const CODES=[60514625,94384774];
function probe(code:number,format:Format):Scenario {
 const late:Seat=format==='ffa3'?'p2':'p3';
 const spec:Partial<Record<Seat,DuelistExpect>>={};for(const p of SEATS[format])spec[p]={hand:[]};
 let setup:Scenario['setup'];let steps:Step[]=[];
 if(code===60514625){
  setup=baseSetup(format,{p0:{field:'Ecole de Zone'},[late]:{hand:['Battle Ox']}});
  steps=[...turnsBefore(format,late),normalSummon('Battle Ox',late)];spec.p0={hand:[],spells:['Ecole de Zone']};for(const p of SEATS[format].slice(1))spec[p]!.hand=['Mystical Elf'];spec[late]={hand:['Mystical Elf'],monsters:['Mask Token'],grave:['Battle Ox']};
 }else{
  setup=baseSetup(format,{p0:{spells:['Ebisu Shinsen Matsuri'],hand:['Monster Reborn'],grave:['Neo-Spacian Aqua Dolphin']}});
  steps=[activate('Monster Reborn','p0'),yes('p0'),pickOpponent(late,'p0')];spec.p0={hand:[],monsters:['Neo-Spacian Aqua Dolphin'],spells:['Ebisu Shinsen Matsuri'],grave:['Monster Reborn']};spec[late]={hand:[],monsters:['Shinsen Token']};
 }
 for(const p of SEATS[format])spec[p]={extra:[],deckCount:20,...spec[p]};
 if(code===60514625)for(const p of SEATS[format].slice(1))spec[p]!.deckCount=19;
 steps.push(expectPrompt({by:code===60514625?late:'p0',context:'action'}),everySeat(format,spec));
 return defineScenario({id:`local-controller-summons-${code}-${format}`,title:`${code}: use the real card controller or owner for a summon`,source:'docs/adr/0002-multiplayer-duel-rules.md',tags:['multiplayer',format,`card:${code}`],setup,steps});
}
export const LOCAL_CONTROLLER_SUMMON_SCENARIOS=CODES.flatMap(c=>(['ffa3','ffa4','tag'] as Format[]).map(f=>probe(c,f)));
