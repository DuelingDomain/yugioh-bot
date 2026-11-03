import { fieldZoneLocation, hasExtraMonsterZones, type FieldFormat, type FieldZone } from '@yugidraft/vision';

/** Card facts from our catalog. `effectText` decides the soft rules (Set as Spell, Equip, Trap Monster). */
export type FieldZoneFacts = { type:string; frameType?:string; race?:string|null; effectText?:string|null };
/** `trapZone`: a Trap Monster keeps this Spell & Trap Zone occupied while it is a monster. */
type FieldTwin = { ref:string; zone:string; slot?:number; trapZone?:number };
/** `check`: the card stays where the camera saw it, but the zone is unusual for it ("Check zone?"). */
type Projection = { zone?:FieldZone; label:string; reason?:string; check?:string };
/** Context that can make a soft placement plausible: an Equip effect on the same field. */
export type ZoneContext = { faceDown?:boolean; equipSource?:boolean };
const piles = new Set(['GY','BANISHED','DECK','EXTRA','graveyard','banished','deck','extra','hand','hand-reveal']);
const unknownType = 'Card type is unknown. Choose a zone manually.';

/** Trap Monster text, cross-checked with EDOPro cards.cdb (Traps with a Level). */
const TRAP_MONSTER = /Special Summon (?:this card|it)\b[^.]*?\bas an? (?:Normal |Effect )?Monster|\bTrap Monster\b/i;
/** A monster that its own text puts in the Spell & Trap Zone (Artifact, Crystal Beast, Continuous-like monsters). */
const SPELL_TRAP_TEXT = /Spell (?:&|and) Trap Zone|Spell\/Trap Zone|as an? (?:Continuous|Equip|Field) (?:Spell|Trap)/i;
const EQUIP_TEXT = /\bequip/i;

/** Catalog type is authoritative; a decorative frame cannot establish a card type. */
function cardKind(facts:FieldZoneFacts|undefined) {
  const type=facts?.type??'',text=facts?.effectText??'';
  const trap=/\btrap\b/i.test(type),spell=/\bspell\b/i.test(type);
  const monster=!trap&&!spell&&/\b(monster|token)\b/i.test(type);
  return {trap,spell,monster,known:trap||spell||monster,
    field:spell&&(/\bfield\b/i.test(type)||facts?.race?.trim().toLowerCase()==='field'),
    pendulum:monster&&/\bpendulum\b/i.test(type),
    extra:monster&&/\b(fusion|synchro|xyz|link)\b/i.test(type),
    link:monster&&(/\blink\b/i.test(type)||facts?.frameType==='link'),
    trapMonster:trap&&(/\bmonster\b/i.test(type)||TRAP_MONSTER.test(text)),
    spellTrapText:monster&&SPELL_TRAP_TEXT.test(text),
    equip:monster&&(/\bunion\b/i.test(type)||EQUIP_TEXT.test(text))};
}

/** True when this card's text can equip a monster to its controller's Spell & Trap Zone. */
export function equipsMonsters(facts:FieldZoneFacts|undefined):boolean {
  const text=facts?.effectText??'';
  return /\bequip\b[^.]*\bmonster|\bmonster\b[^.]*\bequip/i.test(text);
}

/** True for any Trap Card, including Trap Monsters (they keep their Spell & Trap Zone). */
export function isTrapCard(facts:FieldZoneFacts|undefined):boolean { return cardKind(facts).trap; }

export function fieldZoneLabel(zone:string):string {
  if(/^M[1-5]$/.test(zone))return `Main Monster Zone ${zone.slice(1)}`;
  if(/^S[1-5]$/.test(zone))return `Spell/Trap Zone ${zone.slice(1)}`;
  return ({EMZ1:'Extra Monster Zone, left',EMZ2:'Extra Monster Zone, right',FIELD:'Field Spell Zone',GY:'Graveyard',BANISHED:'Banished cards',DECK:'Deck',EXTRA:'Extra Deck'} as Record<string,string>)[zone]??zone;
}

const columnOf=(zone:FieldZone)=>zone==='EMZ1'?2:zone==='EMZ2'?4:/^[MS][1-5]$/.test(zone)?Number(zone[1]):1;
const twinLocation=(zone:string,slot?:number)=>/^[MS][1-5]$|^EMZ[12]$|^FIELD$/.test(zone)?fieldZoneLocation(zone as FieldZone):{zone,slot};

/**
 * Soft zone rule. Undefined = the zone is plausible for this card. A string = keep the card there,
 * but mark it "Check zone?" with this reason. Never a reason to move the card.
 */
export function fieldZoneCheck(facts:FieldZoneFacts|undefined,zone:string,slot?:number,context:ZoneContext={}):string|undefined {
  if(piles.has(zone))return;
  const {zone:destination,slot:targetSlot}=twinLocation(zone,slot);
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(destination))return;
  const kind=cardKind(facts);
  if(!kind.known)return;
  if(destination==='field')return kind.field?undefined:'Only Field Spells normally belong in the Field Spell Zone.';
  if(kind.field)return 'Field Spells normally belong in the Field Spell Zone.';
  if(destination==='monster')return kind.monster||kind.trapMonster?undefined:kind.trap?'This Trap has no Trap Monster text.':'Spell Cards normally belong outside Main Monster Zones.';
  if(destination==='extra-monster')return kind.extra||kind.pendulum?undefined:'Extra Monster Zones require Fusion, Synchro, Xyz, or Link Monsters.';
  if(destination==='pendulum')return kind.pendulum?undefined:'Only Pendulum Monsters normally belong in Pendulum Zones.';
  if(kind.spell||kind.trap)return;
  if(kind.spellTrapText)return;
  if(!context.faceDown&&(kind.equip||context.equipSource))return;
  if(kind.pendulum)return targetSlot===1||targetSlot===5?undefined:'Pendulum Monsters use Spell/Trap Zones 1 or 5 as scales.';
  return 'Monsters in a Spell/Trap Zone need an Equip, Set or Continuous effect.';
}

/**
 * Hard zone rules. Field Spell → FIELD, Link Monster → Monster Zones. Other cards stay where
 * the camera saw them (a soft rule only marks "Check zone?"). Occupied zones use the nearest free
 * zone of the same row; a full row abstains.
 */
export function projectFieldZone({zone,facts,twins,ref,faceDown=false,format='normal',equipSource=false}:{
  zone:FieldZone; facts?:FieldZoneFacts; twins:readonly FieldTwin[]; ref?:string; faceDown?:boolean; format?:FieldFormat; equipSource?:boolean;
}):Projection {
  const accept=(target:FieldZone,check?:string):Projection=>({zone:target,label:fieldZoneLabel(target),...(check?{check}:{})});
  const abstain=(reason:string):Projection=>({label:fieldZoneLabel(zone),reason});
  if(piles.has(zone))return accept(zone);
  const occupied=(target:FieldZone)=>{
    const location=fieldZoneLocation(target);
    return twins.some(twin=>twin.ref!==ref&&(twin.zone===target||
      (twin.zone===location.zone&&(location.slot===undefined||twin.slot===location.slot))||
      (location.zone==='spell-trap'&&twin.trapZone===location.slot)||
      (twin.zone==='pendulum'&&((target==='S1'&&twin.slot===1)||(target==='S5'&&twin.slot===2)))));
  };
  const row=(prefix:'M'|'S',check?:(target:FieldZone)=>string|undefined):Projection=>{
    const col=columnOf(zone);
    const free=[1,2,3,4,5].sort((a,b)=>Math.abs(a-col)-Math.abs(b-col)||a-b)
      .map(slot=>`${prefix}${slot}` as FieldZone).find(target=>!occupied(target));
    return free?accept(free,check?.(free)):abstain(`No free ${prefix==='M'?'Main Monster':'Spell/Trap'} Zone. Choose a zone manually.`);
  };
  if(faceDown){
    if(zone.startsWith('M'))return row('M');
    if(zone.startsWith('S'))return row('S');
    if(zone.startsWith('EMZ'))return row('M');
    return occupied(zone)?abstain(`${fieldZoneLabel(zone)} is occupied. Choose a zone manually.`):accept(zone);
  }
  const kind=cardKind(facts);
  if(!kind.known)return abstain(unknownType);
  const check=(target:FieldZone)=>fieldZoneCheck(facts,target,undefined,{equipSource});
  // Hard rules.
  if(kind.field&&!occupied('FIELD'))return accept('FIELD');
  if(kind.link&&(zone.startsWith('S')||zone==='FIELD'))return row('M');
  if(zone.startsWith('EMZ')&&!hasExtraMonsterZones(format))return row('M',check);
  // Soft rules: the camera zone wins when it is free.
  if(!occupied(zone))return accept(zone,check(zone));
  if(zone==='FIELD')return abstain('Field Spell Zone is occupied. Choose a zone manually.');
  return row(zone.startsWith('S')?'S':'M',check);
}

/** A hard rule target that differs from the card's zone (Field Spell outside FIELD, Link in S/T). */
export function hardFieldZone(facts:FieldZoneFacts|undefined,zone:FieldZone,twins:readonly FieldTwin[],ref:string,format:FieldFormat='normal'):FieldZone|undefined {
  const kind=cardKind(facts);
  if(!(kind.field&&zone!=='FIELD')&&!(kind.link&&(zone.startsWith('S')||zone==='FIELD')))return;
  const target=projectFieldZone({zone,facts,twins,ref,format}).zone;
  return target&&target!==zone&&(kind.field?target==='FIELD':target.startsWith('M'))?target:undefined;
}

/** Explicit moves remain available; callers can display a warning alongside the move. */
export function manualFieldZoneWarning(facts:FieldZoneFacts|undefined,zone:string,slot?:number,context:ZoneContext={}):string|undefined {
  if(piles.has(zone))return;
  const {zone:destination}=twinLocation(zone,slot);
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(destination))return;
  if(!cardKind(facts).known)return unknownType;
  const check=fieldZoneCheck(facts,zone,slot,context);
  return check?`${check} Check this manual move.`:undefined;
}

/** Plausible choices for a prompt in the observed zone. Callers list them first; others still follow. */
export function fieldCandidateFitsZone(zone:FieldZone,facts:FieldZoneFacts|undefined):boolean {
  if(piles.has(zone))return true;
  return cardKind(facts).known&&!fieldZoneCheck(facts,zone);
}

/** A Trap that moves from a Spell & Trap Zone to a Monster Zone is a Trap Monster: it keeps its S/T zone. */
export function becomesTrapMonster(card:{zone:string;slot?:number}|undefined,facts:FieldZoneFacts|undefined,to:string):boolean {
  return !!card&&card.zone==='spell-trap'&&card.slot!==undefined&&(to==='monster'||to==='extra-monster')&&cardKind(facts).trap;
}
