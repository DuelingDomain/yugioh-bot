import { endTurn, expectTurn, expectPrompt, activate, pickOpponent, attack, specialSummon, select, yes, choose, number, raw, expectBoard, expectNoEvent, expectPickSeats, defineScenario, type Scenario, type Step } from "../../support/dsl.js";
const SEATS = ["p0", "p1", "p2", "p3"] as const;
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
export const TRIGGER_PAIR_CODES = { pawn:89839552, cosmos:64659851, stained:16598965, dolphin:17955766, "extra-net":95376428, dna:27340877, helix:1322368, specimen:12292422, branded:14220547, "branded-fusion":14220547, matrix:35569555 } as const;
export type TriggerPair = keyof typeof TRIGGER_PAIR_CODES;
function triggerPair(kind:TriggerPair,format:'1v1'|'ffa3'|'ffa4'|'tag'):Scenario {
 const count=format==='1v1'?2:format==='ffa3'?3:4,last=SEATS[count-1],lp=format==='tag'?16000:8000;
 const setup:any={format,deckSize:3,attackFirstTurn:true},board:any={},steps:Step[]=[];
 // R-COMMON-OPP-PICK (Tag and FFA), R-FFA-OPP-ONE (FFA): declare at activation, before card choices.
 // A condition-only read does not declare. Tag must not offer the partner p2.
 const opponentSteps:Step[]=format==='1v1' ? [] : [
   expectNoEvent({kind:'chain-resolving',card:TRIGGER_PAIR_CODES[kind]}),
   expectPickSeats(format==='tag' ? ['p1','p3'] : SEATS.slice(1,count),'p0'),
   pickOpponent(last,'p0')
 ];
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
  // The Ritual needs no declaration. The later Branded trigger uses an opponent's Extra Deck.
  steps.push(activate('Black Illusion Ritual','p0'),select('Giant Rat'),yes('p0'),...opponentSteps,choose("opponent's Extra Deck",'p0'));
 } else if(kind==='branded-fusion') {
  setup.p0.spells=['Branded in Central Dogmatika'];board.p0.spells=setup.p0.spells;setup.p0.hand=['Polymerization','M-Warrior #1','M-Warrior #2'];setup.p0.extra=['Karbonala Warrior'];board.p0.hand=[];board.p0.monsters.push('Karbonala Warrior');board.p0.grave=['Polymerization','M-Warrior #1','M-Warrior #2'];
  for(let seat=1;seat<count-1;seat++)setup[SEATS[seat]].monsters=[{card:'Mystical Elf',pos:'def'}];board[last].monsters=[];board[last].grave=['Mystical Elf'];board[last].lp=lp-2200;if(format==='tag')board.p1.lp=lp-2200;
  steps.push(activate('Polymerization','p0'),select('M-Warrior #1','M-Warrior #2'),yes('p0'),attack('Karbonala Warrior',{card:'Mystical Elf',owner:last},'p0'));
 } else if(kind==='matrix') {
  setup.p0.spells=['Dogmatikamatrix'];board.p0.spells=setup.p0.spells;setup.p0.monsters=['White Knight of Dogmatika'];board.p0.monsters=setup.p0.monsters;
  for(let seat=0;seat<count;seat++){setup[SEATS[seat]].extra=['Number 39: Utopia'];board[SEATS[seat]].extra=['Number 39: Utopia'];}board[last].extra=[];board[last].grave=['Number 39: Utopia'];
  steps.push(activate('Dogmatikamatrix','p0'),...opponentSteps,choose("opponent's Extra Deck",'p0'));
 }

 if(format !== '1v1' && !['branded','branded-fusion','matrix'].includes(kind)) {
   // Extra Net activates after the summon. The summon material is not its effect choice.
   const at=kind==='extra-net' ? 2 : 1;
   steps.splice(at,0,...opponentSteps);
 }

 steps.push(expectBoard(board));
 return defineScenario({id:`paired-zone-triggers-${kind}-${format}`,title:kind,source:'docs/adr/0002-multiplayer-duel-rules.md [Q4]',rules:['R-COMMON-OPP-PICK'],tags:['multiplayer','pair',`card:${TRIGGER_PAIR_CODES[kind]}`,kind,format],setup,steps});
}
export const PAIRED_ZONE_TRIGGERS_SCENARIOS: Scenario[] = (Object.keys(TRIGGER_PAIR_CODES) as TriggerPair[]).flatMap(kind =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).map(format => triggerPair(kind,format))
);

// Extra Net lets the opponent of the summoner draw. An opposing-team summon
// lets p0 draw from its own Deck; it needs no opposing-duelist declaration.
function extraNetOpponentSummon(): Scenario {
 const setup: Scenario["setup"] = {format:"tag",deckSize:3};
 const board: Parameters<typeof expectBoard>[0] = {};
 for (let i=0;i<4;i++) {
  setup[SEATS[i]]={hand:[HANDS[i]],monsters:["Mystical Elf"],deck:Array(3).fill("Mystical Elf")};
  board[SEATS[i]]={lp:16000,hand:[HANDS[i]],monsters:["Mystical Elf"],spells:[],grave:[],banished:[],extra:[],deckCount:3};
 }
 setup.p0!.field="Extra Net";setup.p1!.extra=["Link Spider"];
 board.p0!.spells=["Extra Net"];board.p0!.hand=[HANDS[0],"Mystical Elf"];board.p0!.deckCount=2;
 board.p1!.hand=[HANDS[1],"Mystical Elf"];board.p1!.deckCount=2;
 board.p1!.monsters=["Link Spider"];board.p1!.grave=["Mystical Elf"];
 return defineScenario({id:"paired-zone-triggers-extra-net-tag-opponent-summon",title:"Extra Net: opposing-team summon needs no pick",
  source:"Extra Net card text; docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-OPP-PICK]",
  rules:["R-COMMON-OPP-PICK","R-TAG-PARTNER"],tags:["multiplayer","pair","card:95376428","extra-net","tag","opponent-summon"],setup,
  steps:[endTurn("p0"),expectTurn("p1",2),specialSummon("Link Spider","p1"),select({card:"Mystical Elf",owner:"p1"}),
   // A pick has no yes/no options. The next prompt must be p0's optional draw.
   expectPrompt({by:"p0",kind:"choice",offers:["yes","no"]}),yes("p0"),expectBoard(board)]});
}
PAIRED_ZONE_TRIGGERS_SCENARIOS.push(extraNetOpponentSummon());

// Pinpoint Dash with different Extra Deck card types summons only the opponent's
// card. Its effect has p0 as the reason player, so the summon event names no
// single opponent. Extra Net must still offer p0 a draw without another pick.
function extraNetPinpointSummon(): Scenario {
 const setup: Scenario["setup"] = {format:"tag",deckSize:3};
 const board: Parameters<typeof expectBoard>[0] = {};
 for (let i=0;i<4;i++) {
  setup[SEATS[i]]={hand:[HANDS[i]],monsters:["Mystical Elf"],deck:Array(3).fill("Mystical Elf")};
  board[SEATS[i]]={lp:16000,hand:[HANDS[i]],monsters:["Mystical Elf"],spells:[],grave:[],banished:[],extra:[],deckCount:3};
 }
 setup.p0!.field="Extra Net";setup.p0!.spells=[{card:"Pinpoint Dash",pos:"set"}];
 setup.p0!.extra=["Karbonala Warrior"];setup.p1!.extra=["Link Spider"];
 board.p0!.spells=["Extra Net"];board.p0!.hand=[HANDS[0],"Mystical Elf"];board.p0!.deckCount=2;
 board.p0!.grave=["Pinpoint Dash","Karbonala Warrior"];
 board.p1!.monsters=["Mystical Elf","Link Spider"];
 return defineScenario({id:"paired-zone-triggers-extra-net-tag-pinpoint-opponent-summon",title:"Extra Net: Pinpoint Dash summons only for p1",
  source:"Extra Net and Pinpoint Dash card text; docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-OPP-PICK]",
  rules:["R-COMMON-OPP-PICK","R-TAG-PARTNER"],tags:["multiplayer","pair","card:95376428","extra-net","tag","opponent-summon"],setup,
  // Each Extra Deck has one card. The core selects those cards without a prompt.
  steps:[activate("Pinpoint Dash","p0"),expectPrompt({by:"p0",kind:"choice",offers:["yes","no"]}),yes("p0"),expectBoard(board)]});
}
PAIRED_ZONE_TRIGGERS_SCENARIOS.push(extraNetPinpointSummon());
