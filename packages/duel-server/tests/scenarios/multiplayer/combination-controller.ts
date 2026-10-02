import { activate, attack, defineScenario, endTurn, pickOpponent, select } from '../../support/dsl.js';
import { baseSetup, everySeat, turnsBefore, type Format, type Seat } from './seat-kit.js';
export const COMBINATION_CONTROLLER_SCENARIOS = (['ffa3','ffa4','tag'] as Format[]).map(format => {
 const target: Seat = format==='ffa3'?'p2':'p3';
 const s=defineScenario({id:`combination-${format}`,title:'Combination returns Union controller',source:'ADR-0002',tags:['multiplayer',format,'card:8964854'],setup:baseSetup(format,{
 p0:{spells:[{card:'Combination Attack',pos:'set'}]},[format==='tag'?'p0':'p1']:{monsters:[{card:'Mystical Elf',pos:'def'}],...(format==='tag'?{spells:[{card:'Combination Attack',pos:'set'}]}:{})},[target]:{monsters:['X-Head Cannon','Y-Dragon Head']}}),steps:[
 ...turnsBefore(format,target),activate('Y-Dragon Head',target),attack('X-Head Cannon','Mystical Elf',target),
 activate('Combination Attack','p0'),everySeat(format,{p0:{grave:['Combination Attack'],...(format==='tag'?{monsters:['Mystical Elf']}:{})},...(format==='tag'?{}:{p1:{monsters:['Mystical Elf']}}),[target]:{monsters:['X-Head Cannon','Y-Dragon Head'],lp:format==='tag'?15800:7800}})]});return s;
});
