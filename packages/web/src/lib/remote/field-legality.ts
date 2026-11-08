import { fieldZoneLocation, hasExtraMonsterZones, type FieldFormat, type FieldZone } from '@yugidraft/vision';

/**
 * Card facts from /api/cards/resolve: engine cards.cdb type bits first (Spell/Trap subtype in `race`, a Trap
 * Monster's Level, Link frame), then our catalog row. `effectText` decides the soft rules (Set as Spell, Equip).
 */
export type FieldZoneFacts = { type:string; frameType?:string; race?:string|null; effectText?:string|null; level?:number|null };
/** `trapZone`: a Trap Monster keeps this Spell & Trap Zone occupied while it is a monster. */
type FieldTwin = { ref:string; zone:string; slot?:number; trapZone?:number; token?:unknown };
/** `check`: the card stays where the camera saw it, but the zone is unusual for it ("Check zone?"). */
/** `moved`: the camera row was not legal for this card; it went to the nearest legal zone ("Trap → S3"). */
type Projection = { zone?:FieldZone; label:string; reason?:string; check?:string; moved?:string };
/** Context that can make a soft placement plausible: an Equip effect on the same field. */
export type ZoneContext = { faceDown?:boolean; equipSource?:boolean };
const piles = new Set(['GY','BANISHED','DECK','EXTRA','graveyard','banished','deck','extra','hand','hand-reveal']);
const unknownType = 'Card type is unknown. Choose a zone manually.';

/** Trap Monster text, cross-checked with EDOPro cards.cdb (Traps with a Level). */
const TRAP_MONSTER = /Special Summon (?:this card|it)\b[^.]*?\bas an? (?:Normal |Effect )?Monster|\bTrap Monster\b/i;
/** A monster that its own text puts in the Spell & Trap Zone (Artifact, Crystal Beast, Continuous-like monsters). Checked against cards.cdb. */
const SPELL_TRAP_TEXT = /\b(?:Set|place|put|treat)\s+(?:this card|it)\b[^.]*?\b(?:Spell (?:&|and) Trap Zone|Spell\/Trap Zone)|\bas an? (?:Continuous|Equip|Field) (?:Spell|Trap)\b/i;
/** A monster that equips itself (not one that only searches an Equip Spell). Union monsters come from the type. */
const EQUIP_TEXT = /\bequip this card\b|\bthis card (?:is|was) equipped\b|\bequipped (?:to a monster )?by this card's effect\b/i;
/** A card whose effect equips a monster as an Equip Card ("equip that target to this card"). */
const EQUIPS_MONSTER = /\bequip (?:it|them|that (?:target|monster|card)|(?:up to )?\d+ [^.;]*?monster[^.;]*?) to\b/i;

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
    trapMonster:trap&&((facts?.level??0)>0||/\bmonster\b/i.test(type)||TRAP_MONSTER.test(text)),
    /** A Spell with no known subtype: it may be a Field Spell, so FIELD is never marked for it. */
    spellSubtypeUnknown:spell&&!facts?.race?.trim(),
    spellTrapText:monster&&SPELL_TRAP_TEXT.test(text),
    equip:monster&&(/\bunion\b/i.test(type)||EQUIP_TEXT.test(text))};
}

/** True when this card's text can equip a monster to its controller's Spell & Trap Zone. */
export function equipsMonsters(facts:FieldZoneFacts|undefined):boolean {
  return EQUIPS_MONSTER.test(facts?.effectText??'');
}

const ON_FIELD=new Set(['monster','extra-monster','spell-trap','field','pendulum']);
/** A face-up card on this field can equip monsters, so a monster in a Spell & Trap Zone is plausible. */
export function equipSourceOnField<T extends {zone:string;faceUp?:boolean}>(twins:readonly T[],factsOf:(card:T)=>FieldZoneFacts|undefined):boolean {
  return twins.some(card=>!!card.faceUp&&ON_FIELD.has(card.zone)&&equipsMonsters(factsOf(card)));
}


/** The full card type for the inspector: "Field Spell", "Continuous Trap", "Trap Monster", "Link-2 Monster" … */
export function cardTypeLine(facts:FieldZoneFacts|undefined):string {
  if(!facts)return '';
  const kind=cardKind(facts),race=facts.race?.trim();
  if(kind.spell)return race?`${race} Spell`:'Spell Card';
  if(kind.trap)return `${race?`${race} Trap`:'Trap Card'}${kind.trapMonster&&(facts.level??0)>0?' · Trap Monster':''}`;
  if(kind.link)return `Link-${facts.level??'?'} ${/link monster/i.test(facts.type)?'Monster':facts.type}`;
  return facts.type;
}

export function fieldZoneLabel(zone:string):string {
  if(/^M[1-5]$/.test(zone))return `Main Monster Zone ${zone.slice(1)}`;
  if(/^S[1-5]$/.test(zone))return `Spell/Trap Zone ${zone.slice(1)}`;
  return ({EMZ1:'Extra Monster Zone, left',EMZ2:'Extra Monster Zone, right',FIELD:'Field Spell Zone',GY:'Graveyard',BANISHED:'Banished cards',DECK:'Deck',EXTRA:'Extra Deck'} as Record<string,string>)[zone]??zone;
}

const columnOf=(zone:FieldZone)=>zone==='EMZ1'?2:zone==='EMZ2'?4:/^[MS][1-5]$/.test(zone)?Number(zone[1]):1;
const twinLocation=(zone:string,slot?:number)=>/^[MS][1-5]$|^EMZ[12]$|^FIELD$/.test(zone)?fieldZoneLocation(zone as FieldZone):{zone,slot};

type Verdict = { legal:'ok'|'unusual'|'illegal'; reason?:string };
/**
 * Zone by card type (docs/remote-duels/zone-rules.md). Legal by type is the default: Spell/Trap → S/T
 * (Field Spell → FIELD), Monster → M (Extra Deck / Pendulum also EMZ). Only cards whose facts allow the
 * other row are exceptions: Trap Monsters in M, monsters that are Set as Spells or equip (Artifact,
 * Union, "equip this card", an equip effect on the field), Pendulum scales in S1/S5. An exception card in
 * an odd spot is "unusual" (kept, "Check zone?"); a face-up monster in S/T is also "unusual" (equipped monsters look like
 * this, so the camera's zone wins). Any other wrong row is "illegal" (moved).
 */
function zoneVerdict(facts:FieldZoneFacts|undefined,zone:string,slot:number|undefined,context:ZoneContext):Verdict {
  const {zone:destination,slot:targetSlot}=twinLocation(zone,slot);
  const kind=cardKind(facts);
  if(piles.has(zone)||!kind.known||!['monster','extra-monster','spell-trap','field','pendulum'].includes(destination))return {legal:'ok'};
  const illegal=(reason:string):Verdict=>({legal:'illegal',reason});
  if(destination==='field')return kind.field||kind.spellSubtypeUnknown?{legal:'ok'}:illegal('Only Field Spells belong in the Field Spell Zone.');
  if(kind.field)return {legal:'unusual',reason:'Field Spells belong in the Field Spell Zone.'};
  if(destination==='monster')return kind.monster||kind.trapMonster?{legal:'ok'}:kind.trap?illegal('This Trap has no Trap Monster text, so it belongs in a Spell/Trap Zone.'):illegal('Spell Cards belong in Spell/Trap Zones, not Monster Zones.');
  if(destination==='extra-monster')return kind.extra||kind.pendulum?{legal:'ok'}:illegal('Extra Monster Zones require Fusion, Synchro, Xyz, or Link Monsters.');
  if(destination==='pendulum')return kind.pendulum?{legal:'ok'}:illegal('Only Pendulum Monsters belong in Pendulum Zones.');
  if(kind.spell||kind.trap)return {legal:'ok'};
  // A monster in a Spell & Trap Zone.
  if(kind.spellTrapText)return {legal:'ok'};
  if(kind.equip||context.equipSource)return context.faceDown?{legal:'unusual',reason:'A face-down monster in a Spell/Trap Zone needs a Set effect.'}:{legal:'ok'};
  if(kind.pendulum)return targetSlot===1||targetSlot===5?{legal:'ok'}:{legal:'unusual',reason:'Pendulum Monsters use Spell/Trap Zones 1 or 5 as scales.'};
  // The camera wins: a face-up monster seen in S/T is usually equipped or a mat mismatch, so keep it and ask.
  return {legal:'unusual',reason:'Monsters belong in Monster Zones; this monster has no Equip, Set or Continuous effect for a Spell/Trap Zone.'};
}

/** "Check zone?": only for an exception card in an unusual zone. Never a reason to move the card. */
export function fieldZoneCheck(facts:FieldZoneFacts|undefined,zone:string,slot?:number,context:ZoneContext={}):string|undefined {
  const verdict=zoneVerdict(facts,zone,slot,context);
  return verdict.legal==='unusual'?verdict.reason:undefined;
}

const kindLabel=(kind:ReturnType<typeof cardKind>)=>kind.field?'Field Spell':kind.spell?'Spell':kind.trap?'Trap':kind.link?'Link Monster':'Monster';
/** Log text for a rule move: "Trap → S3", "Field Spell → FIELD". */
export function zoneMoveLabel(facts:FieldZoneFacts|undefined,target:FieldZone):string { return `${kindLabel(cardKind(facts))} → ${target==='FIELD'?'Field Zone':target}`; }
/**
 * Where a camera card goes. Legal by type: a card in a wrong row goes to the nearest free legal zone of the
 * same column (M3 → S3, EMZ1 → M2), with `moved` for the log. An exception card in an unusual zone stays with
 * `check`. An occupied zone uses the nearest free zone of the same row; a full row abstains. Face-down cards
 * keep their row (the camera cannot see their type).
 */
export function projectFieldZone({zone,facts,twins,ref,faceDown=false,format='normal',equipSource=false}:{
  zone:FieldZone; facts?:FieldZoneFacts; twins:readonly FieldTwin[]; ref?:string; faceDown?:boolean; format?:FieldFormat; equipSource?:boolean;
}):Projection {
  const accept=(target:FieldZone,check?:string,moved?:string):Projection=>({zone:target,label:fieldZoneLabel(target),...(check?{check}:{}),...(moved?{moved}:{})});
  const abstain=(reason:string):Projection=>({label:fieldZoneLabel(zone),reason});
  if(piles.has(zone))return accept(zone);
  const occupied=(target:FieldZone)=>{
    const location=fieldZoneLocation(target);
    // A token has no physical card: it never pushes a camera card to a neighbour slot. The cell stays the card's, and the player chooses (see tokenInCell).
    return twins.some(twin=>twin.ref!==ref&&!twin.token&&(twin.zone===target||
      (twin.zone===location.zone&&(location.slot===undefined||twin.slot===location.slot))||
      (location.zone==='spell-trap'&&twin.trapZone===location.slot)||
      (twin.zone==='pendulum'&&((target==='S1'&&twin.slot===1)||(target==='S5'&&twin.slot===2)))));
  };
  const row=(prefix:'M'|'S',check?:(target:FieldZone)=>string|undefined,moved?:(target:FieldZone)=>string):Projection=>{
    const col=columnOf(zone);
    const free=[1,2,3,4,5].sort((a,b)=>Math.abs(a-col)-Math.abs(b-col)||a-b)
      .map(slot=>`${prefix}${slot}` as FieldZone).find(target=>!occupied(target));
    return free?accept(free,check?.(free),moved?.(free)):abstain(`No free ${prefix==='M'?'Main Monster':'Spell/Trap'} Zone. Choose a zone manually.`);
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
  const moved=(target:FieldZone)=>target===zone?'':zoneMoveLabel(facts,target);
  if(kind.field&&!occupied('FIELD'))return accept('FIELD',undefined,moved('FIELD'));
  if(zone.startsWith('EMZ')&&!hasExtraMonsterZones(format))return row(kind.monster?'M':'S',check,moved);
  if(kind.field&&zone!=='FIELD'&&!zone.startsWith('S'))return row('S',check,moved);
  const verdict=zoneVerdict(facts,zone,undefined,{equipSource});
  if(verdict.legal==='illegal')return row(kind.monster||kind.trapMonster&&zone.startsWith('EMZ')?'M':'S',check,moved);
  if(!occupied(zone))return accept(zone,verdict.legal==='unusual'?verdict.reason:undefined);
  if(zone==='FIELD')return abstain('Field Spell Zone is occupied. Choose a zone manually.');
  return row(zone.startsWith('S')?'S':'M',check);
}

/** The token that holds this Main Monster Zone cell, if any. A camera card standing there asks the player; it is never moved away or placed over the token. */
export function tokenInCell<T extends FieldTwin>(twins:readonly T[],zone:FieldZone|undefined):T|undefined {
  if(!zone||!/^M[1-5]$/.test(zone))return;
  const location=fieldZoneLocation(zone);
  return twins.find(twin=>twin.token&&twin.zone===location.zone&&twin.slot===location.slot);
}

/** A rule target that differs from the card's zone: a card in a row its type does not allow (Trap in M, Field Spell in S/T). */
export function hardFieldZone(facts:FieldZoneFacts|undefined,zone:FieldZone,twins:readonly FieldTwin[],ref:string,format:FieldFormat='normal',equipSource=false):FieldZone|undefined {
  const kind=cardKind(facts);
  if(!kind.known||piles.has(zone))return;
  if(!(kind.field&&zone!=='FIELD')&&zoneVerdict(facts,zone,undefined,{equipSource}).legal!=='illegal'&&!(zone.startsWith('EMZ')&&!hasExtraMonsterZones(format)))return;
  const target=projectFieldZone({zone,facts,twins,ref,format,equipSource}).zone;
  return target&&target!==zone&&!(kind.field&&target!=='FIELD'&&zone.startsWith('S'))?target:undefined;
}

/** Explicit moves remain available; callers can display a warning alongside the move. */
export function manualFieldZoneWarning(facts:FieldZoneFacts|undefined,zone:string,slot?:number,context:ZoneContext={}):string|undefined {
  if(piles.has(zone))return;
  const {zone:destination}=twinLocation(zone,slot);
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(destination))return;
  if(!cardKind(facts).known)return unknownType;
  const verdict=zoneVerdict(facts,zone,slot,context);
  return verdict.reason?`${verdict.reason} Check this manual move.`:undefined;
}

/** Plausible choices for a prompt in the observed zone. Callers list them first; others still follow. */
export function fieldCandidateFitsZone(zone:FieldZone,facts:FieldZoneFacts|undefined):boolean {
  if(piles.has(zone))return true;
  return cardKind(facts).known&&zoneVerdict(facts,zone,undefined,{}).legal==='ok';
}

/**
 * A Trap with Trap Monster text (or a Level, cdb) that moves from a Spell & Trap Zone to a Monster Zone
 * is a Trap Monster: it keeps its S/T zone. Any other Trap in a Monster Zone holds nothing ("Check zone?").
 */
export function becomesTrapMonster(card:{zone:string;slot?:number}|undefined,facts:FieldZoneFacts|undefined,to:string):boolean {
  return !!card&&card.zone==='spell-trap'&&card.slot!==undefined&&(to==='monster'||to==='extra-monster')&&cardKind(facts).trapMonster;
}
