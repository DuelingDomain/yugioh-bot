import { activate, attack, specialSummon, select, yes, choose, number, raw, expectBoard, defineScenario, type Scenario, type Step } from "../../support/dsl.js";
const SEATS = ["p0", "p1", "p2", "p3"] as const;
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
export const TRIGGER_PAIR_CODES = { pawn:89839552, cosmos:64659851, stained:16598965, dolphin:17955766, "extra-net":95376428, dna:27340877, helix:1322368, specimen:12292422, branded:14220547, "branded-fusion":14220547, matrix:35569555 } as const;
export type TriggerPair = keyof typeof TRIGGER_PAIR_CODES;
function triggerPair(kind:TriggerPair,format:'1v1'|'ffa3'|'ffa4'|'tag'):Scenario {
 const count=format==='1v1'?2:format==='ffa3'?3:4,last=SEATS[count-1],lp=format==='tag'?16000:8000;
 const setup:any={format,deckSize:3,attackFirstTurn:true},board:any={},steps:Step[]=[];
 for(let seat=0;seat<count;seat++){setup[SEATS[seat]]={hand:[HANDS[seat]],monsters:['Mystical Elf'],deck:Array(3).fill('Mystical Elf')};board[SEATS[seat]]={lp,hand:[HANDS[seat]],monsters:['Mystical Elf'],spells:[],grave:[],banished:[],extra:[],deckCount:3};}
 if(kind==='pawn') {
  setup.p0.grave=['Puppet Pawn'];setup.p0.deck=Array(3).fill('Axe Raider');board.p0.banished=['Puppet Pawn'];board.p0.hand.push('Axe Raider');board.p0.deckCount=2;board[last].hand.push('Mystical Elf');board[last].deckCount=2;
  steps.push(activate('Puppet Pawn','p0'),select({card:'Axe Raider',owner:'p0',from:'deck'}),yes(last),select({card:'Mystical Elf',owner:last,from:'deck'}));
 } else if(kind==='cosmos') {
  setup.p0.hand.push('Law of the Cosmos');setup.p0.deck=Array(3).fill('Jinzo');setup[last].deck=Array(3).fill('Mirror Force');board.p0.grave=['Law of the Cosmos'];board.p0.monsters.push('Jinzo');board.p0.deckCount=2;board[last].spells=['Mirror Force'];board[last].deckCount=2;
  steps.push(activate('Law of the Cosmos','p0'),yes(last),select({card:'Mirror Force',owner:last,from:'deck'}),select({card:'Jinzo',owner:'p0',from:'deck'}));
 } else if(kind==='stained') {
  setup.p0.spells=[{card:'Stained Glass of Light & Dark',pos:'set'}];setup.p0.monsters=['Kuriboh'];board.p0.monsters=['Kuriboh'];board.p0.grave=['Stained Glass of Light & Dark'];board[last].hand=[];board[last].grave=[HANDS[count-1],'Mystical Elf'];board[last].deckCount=2;
  steps.push(activate('Stained Glass of Light & Dark','p0'));
 } else if(kind==='dolphin') {
  setup.p0.monsters=['Neo-Spacian Aqua Dolphin','Blue-Eyes White Dragon'];board.p0.monsters=setup.p0.monsters;board.p0.hand=[];board.p0.grave=[HANDS[0]];board[last].hand=[];board[last].grave=[HANDS[count-1]];board[last].lp=lp-500;if(format==='tag')board.p1.lp=lp-500;
  steps.push(activate('Neo-Spacian Aqua Dolphin','p0'));
 } else if(kind==='extra-net') {
  setup.p0.field='Extra Net';setup.p0.extra=['Link Spider'];board.p0.spells=['Extra Net'];board.p0.monsters=['Link Spider'];board.p0.grave=['Mystical Elf'];board[last].hand.push('Mystical Elf');board[last].deckCount=2;
  steps.push(specialSummon('Link Spider','p0'),select({card:'Mystical Elf',owner:'p0'}),yes(last));
 } else if(kind==='dna') {
  setup.p0.monsters=[{card:'Mystical Elf',pos:'set'}];setup.p0.spells=[{card:'DNA Checkup',pos:'set'}];board.p0.grave=['DNA Checkup'];board[last].hand.push('Mystical Elf','Mystical Elf');board[last].deckCount=1;
  steps.push(activate('DNA Checkup','p0'),raw({selected:['attr:16','attr:32']},last));
 } else if(kind==='helix') {
  setup.p0.monsters=['SPYRAL Double Helix'];board.p0.monsters=['SPYRAL Double Helix'];setup.p0.deck=Array(3).fill('SPYRAL Super Agent');board.p0.hand.push('SPYRAL Super Agent');board.p0.deckCount=2;
  steps.push(activate('SPYRAL Double Helix','p0'),choose('Monster','p0'),select({card:'SPYRAL Super Agent',owner:'p0',from:'deck'}));
 } else if(kind==='specimen') {
  setup.p0.hand.push('Specimen Inspection','Fossil Fusion');board.p0.hand=['Fossil Fusion'];board.p0.grave=['Specimen Inspection',HANDS[0]];board[last].grave=['Mystical Elf'];board[last].deckCount=2;
  steps.push(activate('Specimen Inspection','p0'),choose('Spellcaster','p0'),number(4,'p0'),select({card:'Mystical Elf',owner:last,from:'deck'}));
 } else if(kind==='branded') {
  setup.p0.spells=['Branded in Central Dogmatika'];board.p0.spells=setup.p0.spells;setup.p0.hand=['Black Illusion Ritual','Relinquished','Giant Rat'];board.p0.hand=[];board.p0.monsters.push('Relinquished');board.p0.grave=['Black Illusion Ritual','Giant Rat'];
  for(let seat=0;seat<count;seat++){setup[SEATS[seat]].extra=['Number 39: Utopia'];board[SEATS[seat]].extra=['Number 39: Utopia'];}
  board[last].extra=[];board[last].grave=['Number 39: Utopia'];
  steps.push(activate('Black Illusion Ritual','p0'),select('Giant Rat'),yes('p0'),choose("opponent's Extra Deck",'p0'));
 } else if(kind==='branded-fusion') {
  setup.p0.spells=['Branded in Central Dogmatika'];board.p0.spells=setup.p0.spells;setup.p0.hand=['Polymerization','M-Warrior #1','M-Warrior #2'];setup.p0.extra=['Karbonala Warrior'];board.p0.hand=[];board.p0.monsters.push('Karbonala Warrior');board.p0.grave=['Polymerization','M-Warrior #1','M-Warrior #2'];
  for(let seat=1;seat<count-1;seat++)setup[SEATS[seat]].monsters=[{card:'Mystical Elf',pos:'def'}];board[last].monsters=[];board[last].grave=['Mystical Elf'];board[last].lp=lp-2200;if(format==='tag')board.p1.lp=lp-2200;
  steps.push(activate('Polymerization','p0'),select('M-Warrior #1','M-Warrior #2'),yes('p0'),attack('Karbonala Warrior',{card:'Mystical Elf',owner:last},'p0'));
 } else if(kind==='matrix') {
  setup.p0.spells=['Dogmatikamatrix'];board.p0.spells=setup.p0.spells;setup.p0.monsters=['White Knight of Dogmatika'];board.p0.monsters=setup.p0.monsters;
  for(let seat=0;seat<count;seat++){setup[SEATS[seat]].extra=['Number 39: Utopia'];board[SEATS[seat]].extra=['Number 39: Utopia'];}board[last].extra=[];board[last].grave=['Number 39: Utopia'];
  steps.push(activate('Dogmatikamatrix','p0'),choose("opponent's Extra Deck",'p0'));
 }

 steps.push(expectBoard(board));
 return defineScenario({id:`paired-zone-triggers-${kind}-${format}`,title:kind,source:'docs/adr/0002-multiplayer-duel-rules.md [Q4]',rules:['R-COMMON-OPP-PICK'],tags:['multiplayer','pair',`card:${TRIGGER_PAIR_CODES[kind]}`,kind,format],setup,steps});
}
export const PAIRED_ZONE_TRIGGERS_SCENARIOS: Scenario[] = (Object.keys(TRIGGER_PAIR_CODES) as TriggerPair[]).flatMap(kind =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).map(format => triggerPair(kind,format))
);
