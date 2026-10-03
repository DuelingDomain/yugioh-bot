import { activate, pickOpponent, raw, endTurn, choose, expectBoard } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, turnsBefore, type Format, type Seat } from './seat-kit.js';
export const FORK_DRAW_LEGALITY_SCENARIOS = (['ffa3','ffa4','tag'] as Format[]).map(format => {
 const owner: Seat = format==='ffa3'?'p2':'p3';
 const s=defineScenario({id:`fork-legality-${format}`,title:'Fork checks actual owner Deck',source:'ADR-0002',tags:['multiplayer',format,'draw-legality','card:19338434'],setup:{...baseSetup(format,{
 p0:{spells:[{card:'Mimighoul Fork',pos:'set'}]},p1:{monsters:[{card:'Celtic Guardian',pos:'set'}]},[owner]:{hand:['Pot of Greed'],monsters:[{card:'Battle Ox',pos:'set'}]}}),deckSize:3},steps:[
 ...turnsBefore(format,owner),activate('Pot of Greed',owner),endTurn(owner),activate('Mimighoul Fork','p0'),raw({selected:['card:1']},'p0'),pickOpponent('p1','p0'),choose('Attack','p0'),
 everySeat(format,{p0:{grave:['Mimighoul Fork'],hand:{count:1}},p1:{monsters:['Celtic Guardian'],hand:{count:1}},...(format!=='ffa3'?{p2:{hand:{count:1}}}:{}),[owner]:{monsters:['Battle Ox'],grave:['Pot of Greed'],deckCount:0,hand:{count:3}}})]});return s;
});
