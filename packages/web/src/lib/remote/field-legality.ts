import { fieldZoneLocation, hasExtraMonsterZones, type FieldFormat, type FieldZone } from '@yugidraft/vision';

export type FieldZoneFacts = { type:string; frameType?:string; race?:string|null };
type FieldTwin = { ref:string; zone:string; slot?:number };
type Projection = { zone?:FieldZone; label:string; reason?:string };
const piles = new Set(['GY','BANISHED','DECK','EXTRA','graveyard','banished','deck','extra','hand','hand-reveal']);
const unknownType = 'Card type is unknown. Choose a zone manually.';

/** Catalog type is authoritative; a decorative frame cannot establish a card type. */
function cardKind(facts:FieldZoneFacts|undefined) {
  const type=facts?.type??'';
  const trap=/\btrap\b/i.test(type),spell=/\bspell\b/i.test(type);
  const monster=!trap&&!spell&&/\b(monster|token)\b/i.test(type);
  return {trap,spell,monster,known:trap||spell||monster,
    field:spell&&(/\bfield\b/i.test(type)||facts?.race?.trim().toLowerCase()==='field'),
    pendulum:monster&&/\bpendulum\b/i.test(type),
    extra:monster&&/\b(fusion|synchro|xyz|link)\b/i.test(type),
    trapMonster:trap&&/\bmonster\b/i.test(type)};
}

export function fieldZoneLabel(zone:string):string {
  if(/^M[1-5]$/.test(zone))return `Main Monster Zone ${zone.slice(1)}`;
  if(/^S[1-5]$/.test(zone))return `Spell/Trap Zone ${zone.slice(1)}`;
  return ({EMZ1:'Extra Monster Zone, left',EMZ2:'Extra Monster Zone, right',FIELD:'Field Spell Zone',GY:'Graveyard',BANISHED:'Banished cards',DECK:'Deck',EXTRA:'Extra Deck'} as Record<string,string>)[zone]??zone;
}

const columnOf=(zone:FieldZone)=>zone==='EMZ1'?2:zone==='EMZ2'?4:/^[MS][1-5]$/.test(zone)?Number(zone[1]):1;

/** Project only type-compatible free zones; the adapter owns identity and pile policy. */
export function projectFieldZone({zone,facts,twins,ref,faceDown=false,format='normal'}:{
  zone:FieldZone; facts?:FieldZoneFacts; twins:readonly FieldTwin[]; ref?:string; faceDown?:boolean; format?:FieldFormat;
}):Projection {
  const accept=(target:FieldZone):Projection=>({zone:target,label:fieldZoneLabel(target)});
  const abstain=(reason:string):Projection=>({label:fieldZoneLabel(zone),reason});
  if(piles.has(zone))return accept(zone);
  const occupied=(target:FieldZone)=>{
    const location=fieldZoneLocation(target);
    return twins.some(twin=>twin.ref!==ref&&(twin.zone===target||
      (twin.zone===location.zone&&(location.slot===undefined||twin.slot===location.slot))||
      (twin.zone==='pendulum'&&((target==='S1'&&twin.slot===1)||(target==='S5'&&twin.slot===2)))));
  };
  const row=(prefix:'M'|'S'):Projection=>{
    const col=columnOf(zone);
    const free=[1,2,3,4,5].sort((a,b)=>Math.abs(a-col)-Math.abs(b-col)||a-b)
      .map(slot=>`${prefix}${slot}` as FieldZone).find(target=>!occupied(target));
    return free?accept(free):abstain(`No free ${prefix==='M'?'Main Monster':'Spell/Trap'} Zone. Choose a zone manually.`);
  };
  if(faceDown){
    if(zone.startsWith('M'))return row('M');
    if(zone.startsWith('S'))return row('S');
    if(zone.startsWith('EMZ'))return row('M');
    return occupied(zone)?abstain(`${fieldZoneLabel(zone)} is occupied. Choose a zone manually.`):accept(zone);
  }
  const kind=cardKind(facts);
  if(!kind.known)return abstain(unknownType);
  if(kind.field)return occupied('FIELD')?abstain('Field Spell Zone is occupied. Choose a zone manually.'):accept('FIELD');
  if(kind.spell||kind.trap)return row('S');
  if(kind.pendulum&&(zone==='S1'||zone==='S5')&&!occupied(zone))return accept(zone);
  if(kind.extra&&zone.startsWith('EMZ')&&hasExtraMonsterZones(format)&&!occupied(zone))return accept(zone);
  return row('M');
}

/** Explicit moves remain available; callers can display a warning alongside the move. */
export function manualFieldZoneWarning(facts:FieldZoneFacts|undefined,zone:string,slot?:number):string|undefined {
  if(piles.has(zone))return;
  const location=/^[MS][1-5]$|^EMZ[12]$|^FIELD$/.test(zone)?fieldZoneLocation(zone as FieldZone):{zone,slot};
  const destination=location.zone,targetSlot=location.slot;
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(destination))return;
  const kind=cardKind(facts);
  if(!kind.known)return unknownType;
  if(destination==='monster')return kind.monster||kind.trapMonster?undefined:'Spell and Trap Cards normally belong outside Main Monster Zones. Check this manual move.';
  if(destination==='extra-monster')return kind.extra?undefined:'Extra Monster Zones require Fusion, Synchro, Xyz, or Link Monsters. Check this manual move.';
  if(destination==='field')return kind.field?undefined:'Only Field Spells normally belong in the Field Spell Zone. Check this manual move.';
  if(kind.field)return 'Field Spells normally belong in the Field Spell Zone. Check this manual move.';
  if(destination==='pendulum')return kind.pendulum?undefined:'Only Pendulum Monsters normally belong in Pendulum Zones. Check this manual move.';
  if(kind.spell||kind.trap)return;
  if(kind.pendulum)return targetSlot===1||targetSlot===5?undefined:'Pendulum Monsters use Spell/Trap Zones 1 or 5 as scales. Check this manual move.';
  return 'Monsters normally belong outside Spell/Trap Zones. Check this manual move.';
}
