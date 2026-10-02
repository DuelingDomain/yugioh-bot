import { activate, select, yes, no, choose, announce, expectBoard, defineScenario, type Scenario, type Step } from "../../support/dsl.js";
const seats = ["p0", "p1", "p2", "p3"] as const;
const hand = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
export const HIDDEN_PAIR_CODES = { rain:95568112, maximus:95679145, exchange:5556668, dragged:16435215, "dd-designator":33423043, "old-mind":54239282, fukubiki:54927180, outfits:94446564, "top-share":90359458, margin:62632427, "mind-crush":15800838, "re-cover":58695102, "gold-pride":91286284 } as const;
export type HiddenPair = keyof typeof HIDDEN_PAIR_CODES;
function hiddenPair(kind:HiddenPair,format:'1v1'|'ffa3'|'ffa4'|'tag'):Scenario {
 const count=format==='1v1'?2:format==='ffa3'?3:4,lp=format==='tag'?16000:8000,last=seats[count-1];
 const setup:any={format,deckSize:3,attackFirstTurn:true},board:any={},steps:Step[]=[];
 for(let i=0;i<count;i++){setup[seats[i]]={hand:[hand[i]],monsters:['Mystical Elf'],deck:['Mystical Elf','Mystical Elf','Mystical Elf']};board[seats[i]]={lp,hand:[hand[i]],monsters:['Mystical Elf'],spells:[],grave:[],banished:[],extra:[],deckCount:3};}
 if(kind==='rain') {
  setup.p0.pendulum=['Rain Bozu',null];board.p0.spells=['Rain Bozu'];
  for(let i=0;i<count;i++){setup[seats[i]].extra=Array(i+1).fill('Number 39: Utopia');board[seats[i]].extra=setup[seats[i]].extra;}
  steps.push(activate('Rain Bozu','p0'));if(format==='tag')steps.push(select({card:'Mystical Elf',owner:'p0'}));
 } else if(kind==='maximus') {
  setup.p0.monsters=['Dogmatika Maximus'];board.p0.monsters=['Dogmatika Maximus'];
  for(let i=0;i<count;i++){setup[seats[i]].extra=['Number 39: Utopia','Karbonala Warrior'];board[seats[i]].extra=setup[seats[i]].extra;}
  board.p0.extra=[];board.p0.grave=setup.p0.extra;board[last].extra=[];board[last].grave=setup[last].extra;
  steps.push(activate('Dogmatika Maximus','p0'),select({card:'Number 39: Utopia',owner:'p0'},{card:'Karbonala Warrior',owner:'p0'}));
 }
 if(['exchange','dragged','dd-designator','old-mind','fukubiki','outfits','top-share','margin','mind-crush'].includes(kind)) {
  const names:any={'exchange':'Exchange','dragged':'Dragged Down into the Grave','dd-designator':'D.D. Designator','old-mind':'Old Mind','fukubiki':'Fukubiki','outfits':'Matching Outfits','top-share':'Top Share','margin':'Margin Trading','mind-crush':'Mind Crush'};
  const card=names[kind];if(['mind-crush','fukubiki','outfits'].includes(kind))setup.p0.spells=[{card,pos:'set'}];else setup.p0.hand.push(card);board.p0.grave=[card];steps.push(activate(card,'p0'));
  if(kind==='exchange'){board.p0.hand=[hand[count-1]];board[last].hand=[hand[0]];steps.push(select({card:hand[count-1],owner:last}),select({card:hand[0],owner:'p0'}));}
  if(kind==='dragged'){board.p0.hand=['Mystical Elf'];board[last].hand=['Mystical Elf'];board.p0.grave.push(hand[0]);board[last].grave=[hand[count-1]];board.p0.deckCount=2;board[last].deckCount=2;steps.push(select({card:hand[count-1],owner:last}),select({card:hand[0],owner:'p0'}));}
  if(kind==='dd-designator'||kind==='mind-crush'){steps.push(announce(hand[count-1],'p0'));board[last].hand=[];if(kind==='dd-designator')board[last].banished=[hand[count-1]];else board[last].grave=[hand[count-1]];}
  if(kind==='old-mind'){steps.push(choose('Discard','p0'),select({card:hand[0],owner:'p0'}));board.p0.hand=['Mystical Elf'];board.p0.deckCount=2;board.p0.grave=[hand[0]];board[last].hand=[card];board[last].grave=[hand[count-1]];}
  if(['fukubiki','outfits','top-share','margin'].includes(kind))for(let i=0;i<count;i++)setup[seats[i]].deck=Array(3).fill(kind==='fukubiki'&&i===0?'Blue-Eyes White Dragon':hand[i]);
  if(kind==='fukubiki'){board.p0.hand.push('Blue-Eyes White Dragon');board.p0.deckCount=2;board[last].grave=[hand[count-1]];board[last].deckCount=2;}
  if(kind==='outfits'||kind==='margin'){board.p0.hand.push(hand[0]);board[last].hand.push(hand[count-1]);board.p0.deckCount=2;board[last].deckCount=2;}
  if(kind==='top-share')steps.push(select({card:hand[0],owner:'p0'}),select({card:hand[count-1],owner:last}));
  if(kind==='margin')steps.push(no(last),select({card:hand[count-1],owner:last}),select({card:hand[0],owner:'p0'}));
 } else if(kind==='re-cover') {
  setup.p0.grave=['Re-Cover'];board.p0.monsters.push('Re-Cover');board.p0.lp=lp-2000;if(format==='tag')board.p2.lp=lp-2000;
  for(let i=1;i<count;i++){setup[seats[i]].extra=Array(i===count-1?5:1).fill('Number 39: Utopia');board[seats[i]].extra=setup[seats[i]].extra;}
  steps.push(activate('Re-Cover','p0'));
 } else if(kind==='gold-pride') {
  setup.p0.hand.push('Gold Pride - That Came Out of Nowhere!');setup.p0.grave=['Gold Pride - Leon'];board.p0.grave=['Gold Pride - That Came Out of Nowhere!'];board.p0.monsters.push('Gold Pride - Leon');board[last].monsters.push(hand[count-1]);board[last].hand=[];
  steps.push(activate('Gold Pride - That Came Out of Nowhere!','p0'),yes(last));
 }

 steps.push(expectBoard(board));
 return defineScenario({id:`paired-hidden-zones-${kind}-${format}`,title:kind,source:'docs/adr/0002-multiplayer-duel-rules.md [Q4]',rules:['R-COMMON-OPP-PICK'],tags:['multiplayer','pair',`card:${HIDDEN_PAIR_CODES[kind]}`,kind,format],setup,steps});
}
export const PAIRED_HIDDEN_ZONES_SCENARIOS: Scenario[] = (Object.keys(HIDDEN_PAIR_CODES) as HiddenPair[]).flatMap(kind =>
  (kind === "mind-crush" ? ["1v1", "tag"] as const : ["1v1", "ffa3", "ffa4", "tag"] as const).map(format => hiddenPair(kind,format))
);
