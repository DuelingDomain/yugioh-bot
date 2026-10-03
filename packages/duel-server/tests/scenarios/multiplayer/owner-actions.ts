import { activate, changePosition, choose, pickOpponent, select, zone } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { everySeat, baseSetup, type Format, type Seat } from './seat-kit.js';
import { SOURCE } from './nseat-scenarios.js';
export const OWNER_ACTION_SCENARIOS = (['ffa3','ffa4','tag'] as Format[]).flatMap(format=>{
 const target: Seat = format === 'ffa3' ? 'p2' : 'p3';
 return [
  defineScenario({id:`bunny-${format}`, title:`${format}: Mecha Bunny damages target controller`, source:SOURCE, rules:['R-COMMON-SEAT-STATE'],tags:['multiplayer',format,'card:10110717'],
   setup:baseSetup(format,{p0:{monsters:[{card:'Mecha Bunny',pos:'set'}]},[target]:{monsters:['Battle Ox']}}),
   steps:[changePosition('Mecha Bunny','p0'),select({card:'Battle Ox',owner:target}),
    everySeat(format,{p0:{monsters:['Mecha Bunny']},[target]:{monsters:['Battle Ox'],lp:format==='tag'?15500:7500}})]}),
  defineScenario({id:`fork-${format}`, title:`${format}: Mimighoul Fork owner draws`, source:'docs/adr/0002-multiplayer-duel-rules.md (owner Q5: the bound opponent chooses)', rules:['R-COMMON-SEP-FIELDS',...(format==='tag'?[]:['R-FFA-OPP-ONE'])],tags:['multiplayer',format,'card:19338434'],
   setup:baseSetup(format,{p0:{spells:[{card:'Mimighoul Fork',pos:'set'}]},p1:{monsters:[{card:'Celtic Guardian',pos:'set'}]},[target]:{monsters:[{card:'Battle Ox',pos:'set'},{card:'Mystical Elf',pos:'set'}]}}),
   // FFA declares the opponent before cards (R-FFA-OPP-ONE); the target controller chooses (owner Q5).
   steps:[activate('Mimighoul Fork','p0'),pickOpponent(target,'p0'),zone(target,'m0','p0'),choose('Send',target),
    everySeat(format,{p0:{grave:['Mimighoul Fork']},p1:{monsters:['Celtic Guardian'],hand:{count:0}},[target]:{monsters:['Mystical Elf'],grave:['Battle Ox'],hand:{count:2},zones:{m1:{card:'Mystical Elf',pos:'set'}}}})]}),
 ];
});
