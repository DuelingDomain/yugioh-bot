import data from './card-logic-data.json';
const { EQUIPPERS, REVIVE_OPPONENT_GY, SELF_EQUIP, TAKE_CONTROL } = data;

/**
 * Card logic for Remote Duels, from the engine data (cards.cdb type bits and the card scripts, see
 * packages/duel-server/scripts/build-card-logic.ts). A tiny id lookup: it decides what a card can do,
 * so the board does not guess from card text. A card that is not in the lists is plain.
 */
const sets=new Map<string,Set<number>>();
const lookup=(name:string,packed:string,id:number|undefined)=>{
  if(id===undefined)return false;
  let set=sets.get(name);
  if(!set){set=new Set(packed.split(' ').map(value=>parseInt(value,36)));sets.set(name,set);}
  return set.has(id);
};

/** A monster that puts itself into a Spell & Trap Zone as an Equip Card (Union, Agnumday-style Link/Fusion). */
export const equipsItself=(id:number|undefined)=>lookup('self',SELF_EQUIP,id);
/** A card whose effect equips another monster to a monster (the equipped monster sits in a Spell & Trap Zone). */
export const equipsOtherMonster=(id:number|undefined)=>lookup('others',EQUIPPERS,id);
/** A card that takes control of a monster, or swaps control. */
export const takesControl=(id:number|undefined)=>lookup('control',TAKE_CONTROL,id);
/** A card that Special Summons from either Graveyard (Monster Reborn). */
export const revivesFromOpponentGrave=(id:number|undefined)=>lookup('revive',REVIVE_OPPONENT_GY,id);

export type ControlOffer = { kind:'take'|'revive'; title:string };
/** The prompt an activated card calls for, or nothing. Revive wins when a card does both. */
export function controlOffer(id:number|undefined):ControlOffer|undefined {
  if(revivesFromOpponentGrave(id))return {kind:'revive',title:'Revive from which Graveyard?'};
  if(takesControl(id))return {kind:'take',title:'Take control of which monster?'};
  return undefined;
}
