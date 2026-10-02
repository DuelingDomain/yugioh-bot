import { activate, defineScenario, select, expectBoard } from '../../support/dsl.js';
import { baseSetup, everySeat, type Format, type Seat } from './seat-kit.js';
export const BLACK_DRAGON_RETURN_SCENARIOS = (['ffa3','ffa4','tag'] as Format[]).map(format => {
 const target: Seat = format==='ffa3'?'p2':'p3';
 const s=defineScenario({id:`black-dragon-${format}`,title:'Black Dragon Ninja returns late owner',source:'ADR-0002',tags:['multiplayer',format,'card:56562619'],setup:baseSetup(format,{
 p0:{monsters:['Black Dragon Ninja'],hand:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation','Dark Hole']},[target]:{monsters:['Mystical Elf']}}),steps:[
 activate('Black Dragon Ninja','p0'),select('Ninja Grandmaster Hanzo'),select('Mystical Elf'),
 activate('Dark Hole','p0'),everySeat(format,{p0:{grave:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation','Dark Hole','Black Dragon Ninja']},[target]:{monsters:['Mystical Elf']}})]});return s;
});
