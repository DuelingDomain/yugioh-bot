import { activate, endTurn, expectOffered, expectPickOptions, expectPrompt, pass, select, type Scenario } from '../../support/dsl.js';
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, type Format, type Seat } from './seat-kit.js';
const NINJA = 'Black Dragon Ninja';
const ELF = 'Mystical Elf';
const SPIRIT = 'Blue-Eyes Spirit Dragon';
const SOURCE = 'docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-SEP-FIELDS]';

function twoOwners(format: Format, spirit: boolean): Scenario {
 const late: Seat = format === 'ffa3' ? 'p2' : 'p3';
 const removal = spirit ? 'Tribute to The Doomed' : 'Dark Hole';
 const before = everySeat(format, {
  p0:{monsters:[NINJA],hand:[],deckCount:20,
   grave:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation','Upstart Golden Ninja','Ninjitsu Art of Duplication']},
  p1:{hand:[removal,...(spirit?['Silver Fang']:[]),ELF],deckCount:19,banished:['Battle Ox']},
  [late]:{hand:[],deckCount:20,monsters:spirit?[SPIRIT]:[],banished:[ELF]},
  ...(format === 'ffa3' ? {} : {p2:{hand:[],deckCount:20}}),
 });
 return defineScenario({
  id:`black-dragon-${format}-two-owners-${spirit?'spirit-returns-one':'returns-both'}`,
  title:`${format}: Black Dragon Ninja ${spirit?'returns one selected monster under Blue-Eyes Spirit Dragon':'returns monsters to two real owners'}`,
  source:SOURCE, rules:['R-COMMON-SEP-FIELDS'],
  tags:['multiplayer',format,'black-dragon-return','card:56562619',...(spirit?['card:59822133']:[])],
  setup:baseSetup(format,{
   p0:{monsters:[NINJA],hand:['Ninja Grandmaster Hanzo','Upstart Golden Ninja',
    'Ninjitsu Art of Transformation','Ninjitsu Art of Duplication']},
   p1:{monsters:['Battle Ox'],hand:[removal,...(spirit?['Silver Fang']:[])]},
   [late]:{monsters:[ELF,...(spirit?[SPIRIT]:[])]},
  }),
  steps:[
   activate(NINJA,'p0'),select('Ninja Grandmaster Hanzo'),select('Ninjitsu Art of Transformation'),
   select({card:'Battle Ox',owner:'p1'}),endTurn('p0'),
   activate(NINJA,'p0'),select('Upstart Golden Ninja'),select({card:ELF,owner:late}),before,
   expectPrompt({by:'p1',context:'action'}),activate(removal,'p1'),
   ...(spirit ? [select('Silver Fang'),select({card:NINJA,owner:'p0'}),
    expectPrompt({by:late,context:'chain'}),expectOffered('activate',SPIRIT,late),pass(late),
    expectPickOptions([{seat:'p1',card:'Battle Ox'},{seat:late,card:ELF}],'p0'),
    select({card:ELF,owner:late})] : []),
   everySeat(format,{
    p0:{hand:[],deckCount:20,grave:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation',
     'Upstart Golden Ninja','Ninjitsu Art of Duplication',NINJA]},
    p1:{hand:[ELF],deckCount:19,grave:[...(spirit?['Silver Fang']:[]),removal],
     ...(spirit?{banished:['Battle Ox']}:{monsters:['Battle Ox']})},
    [late]:{hand:[],deckCount:20,monsters:[ELF,...(spirit?[SPIRIT]:[])]},
    ...(format === 'ffa3' ? {} : {p2:{hand:[],deckCount:20}}),
   }),
  ],
 });
}

export const BLACK_DRAGON_RETURN_SCENARIOS: Scenario[] = [...(['ffa3','ffa4','tag'] as Format[]).map(format => {
 const target: Seat = format==='ffa3'?'p2':'p3';
 const s=defineScenario({id:`black-dragon-${format}`,title:'Black Dragon Ninja returns late owner',source:SOURCE,rules:['R-COMMON-SEP-FIELDS'],tags:['multiplayer',format,'black-dragon-return','card:56562619'],setup:baseSetup(format,{
 p0:{monsters:['Black Dragon Ninja'],hand:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation','Dark Hole']},[target]:{monsters:['Mystical Elf']}}),steps:[
 activate('Black Dragon Ninja','p0'),select('Ninja Grandmaster Hanzo'),select('Mystical Elf'),
 activate('Dark Hole','p0'),everySeat(format,{p0:{grave:['Ninja Grandmaster Hanzo','Ninjitsu Art of Transformation','Dark Hole','Black Dragon Ninja']},[target]:{monsters:['Mystical Elf']}})]});return s;
}), ...(['ffa3','ffa4','tag'] as Format[]).flatMap(format => [twoOwners(format,false),twoOwners(format,true)])];
