import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
import { cardCode, cellsFor, hasExtraZones, mirrorEmz, type ZoneKey } from './model';
import { landingForCell, type Landing } from './placement';
import { cardInfo } from './catalog';
import { playerStamp } from '@/lib/remote/field-timing';
import { fieldSummonKind } from '@/lib/remote/field-summons';
import { isFieldSpell } from '@/lib/remote/field-legality';

export type ZonePick = { seat: number; key: ZoneKey; cardId: number; name: string; faceUp: boolean; fromRef?: string; anotherCopy?: boolean; targetRef?: string;
  top?: { ref: string; kind: 'summon'; materialRefs: string[] } | { ref: string; kind: 'replace' } };
function ownTwins(room: RemoteRoom, seat: number) {
  if (room.status !== 'active' || room.state.ended || room.state.match.phase !== 'duel' || room.state.seats[seat]?.eliminated || !(room.solo || seat === room.mySeat)) throw new Error('You can only edit your own active field.');
  return room.state.seats[seat].twin;
}
export type ZoneCardAction = Extract<RemoteActionProposal, { type: 'twin.flip' | 'twin.detach' | 'card.identified' }>;
/** Direct zone commands must still refer to the card that occupies that cell at save time. */
export function zoneCardAction(room: RemoteRoom, key: ZoneKey, action: ZoneCardAction): ZoneCardAction {
  const twins = ownTwins(room, action.seat);
  if (cellsFor(twins, hasExtraZones(room.format?.id))[key]?.card?.ref !== action.cardRef) throw new Error('This zone changed. Open it again.');
  if(action.type==='card.identified'&&!twins.find(c=>c.ref===action.cardRef)?.nameCandidates?.some(c=>c.cardId===action.cardId))throw new Error('The name changed. Open this zone again.');
  return action;
}
/** Re-run destination and copy checks inside the room transaction. */
export function zonePlacement(room: RemoteRoom, pick: ZonePick, newRef: string): RemoteActionProposal[] {
  const twins = ownTwins(room, pick.seat), extra = hasExtraZones(room.format?.id);
  const info = cardInfo(pick.cardId), fieldSpell = isFieldSpell(info);
  const land: Landing = fieldSpell ? { zone: 'field' } : landingForCell(pick.key, info, extra);
  const occupant = cellsFor(twins, extra)[pick.key]?.card;
  if (pick.top) {
    if (!occupant || occupant.ref !== pick.top.ref || occupant.token) throw new Error('This zone changed. Open it again.');
    if (pick.targetRef || pick.fromRef === occupant.ref || !pick.faceUp) throw new Error('Choose a face-up top card.');
    if (fieldSpell && pick.top.kind === 'summon') throw new Error('Choose an Extra Deck monster to summon.');
  }
  if (pick.top && occupant && !fieldSpell) {
    if (land.zone !== occupant.zone || land.slot !== occupant.slot) throw new Error('The top card must fit this zone.');
    const actorSeat = room.solo ? pick.seat : room.mySeat, cam = playerStamp('zone-top');
    const copies = twins.filter(c => cardCode(c) === pick.cardId && !c.token && c.zone !== 'material');
    if (pick.fromRef && !copies.some(c => c.ref === pick.fromRef)) throw new Error('That copy moved. Choose it again.');
    if (copies.length && !pick.fromRef && !pick.anotherCopy) throw new Error('Choose which physical copy to use.');
    const card = { ref: newRef, cardId: pick.cardId, name: pick.name, slot: land.slot, faceUp: true, position: 'attack' as const };
    if (pick.top.kind === 'replace') return [
      { type: 'twin.move', actorSeat, seat: pick.seat, cardRef: occupant.ref, zone: 'graveyard', faceUp: true, confirmed: true, cam },
      { type: 'twin.place', actorSeat, seat: pick.seat, zone: land.zone, card, fromRef: pick.fromRef, anotherCopy: pick.anotherCopy, cam },
    ];
    const summon = fieldSummonKind(info);
    const refs = [...new Set(pick.top.materialRefs)];
    if (!summon || !refs.includes(occupant.ref) || refs.includes(pick.fromRef ?? '') || refs.some(ref => !twins.some(c => c.ref === ref && !c.token && ['monster','extra-monster'].includes(c.zone)))) throw new Error('Choose the monsters to use as summon material.');
    return [{ type: 'twin.place', actorSeat, seat: pick.seat, zone: land.zone, card, fromRef: pick.fromRef, anotherCopy: pick.anotherCopy, summon: { kind: summon.kind, materialRefs: refs }, cam }];
  }
  const target = pick.targetRef ? twins.find(c => c.ref === pick.targetRef) : !pick.top && occupant && !cardCode(occupant) && !occupant.token ? occupant : undefined;
  if(pick.targetRef&&(!target||occupant?.ref!==target.ref||!['monster','spell-trap','field','extra-monster','pendulum'].includes(target.zone)))throw new Error('That card left the field. Open the zone again.');
  if (!fieldSpell && occupant && occupant.ref !== target?.ref) throw new Error('This zone is occupied. Move that card first.');
  if (land.zone === 'extra-monster' && room.state.seats.some(s => s.seat !== pick.seat && s.twin.some(c => c.zone === 'extra-monster' && c.slot === mirrorEmz(land.slot ?? 1)))) throw new Error('That shared Extra Monster Zone is occupied.');
  if (twins.some(c => c.trapZone === (land.zone === 'pendulum' ? land.slot === 1 ? 1 : 5 : land.zone === 'spell-trap' ? land.slot : undefined) && c.trapZone !== undefined)) throw new Error('A Trap Monster holds this zone.');
  const actorSeat = room.solo ? pick.seat : room.mySeat, cam = playerStamp('zone-picker');
  if (target && !target.faceUp && pick.faceUp) return [
    { type: 'twin.flip', actorSeat, seat: pick.seat, cardRef: target.ref, faceUp: true, cardId: pick.cardId, name: pick.name, cam },
  ];
  if (target) return [
    { type: 'card.identified', actorSeat, seat: pick.seat, cardRef: target.ref, cardId: pick.cardId, name: pick.name, source: 'typed', cam },
    ...(target.faceUp !== pick.faceUp ? [{ type: 'twin.flip' as const, actorSeat, seat: pick.seat, cardRef: target.ref, faceUp: pick.faceUp, cam, ...(!pick.faceUp && ['monster','extra-monster'].includes(target.zone) ? { position: 'defense' as const } : {}) }] : []),
  ];
  const copies = twins.filter(c => cardCode(c) === pick.cardId && !c.token && c.zone !== 'material');
  const origin = pick.fromRef ? copies.find(c => c.ref === pick.fromRef) : undefined;
  if (pick.fromRef && !origin) throw new Error('That copy moved. Choose it again.');
  if (copies.length && !origin && !pick.anotherCopy) throw new Error('Choose which physical copy to use.');
  if (origin) return [{ type: 'twin.move', actorSeat, seat: pick.seat, cardRef: origin.ref, ...land, faceUp: pick.faceUp,
    position: !pick.faceUp && ['monster','extra-monster'].includes(land.zone) ? 'defense' : 'attack', confirmed: true, cam }];
  return [{ type: 'twin.place', actorSeat, seat: pick.seat, zone:land.zone, anotherCopy: true, cam,
    card: { ref: newRef, cardId: pick.cardId, name: pick.name, slot: land.slot, faceUp: pick.faceUp, position: !pick.faceUp && ['monster','extra-monster'].includes(land.zone) ? 'defense' : 'attack' } }];
}

/** A sleeved Set has a physical ref and pose, with no guessed or private name required. */
export function zoneSet(room: RemoteRoom, seat: number, key: ZoneKey, newRef: string): RemoteActionProposal {
  const twins = ownTwins(room, seat), extra = hasExtraZones(room.format?.id);
  const land = landingForCell(key, undefined, extra);
  if (!['monster','spell-trap'].includes(land.zone)) throw new Error('Set a card in a Main Monster or Spell/Trap Zone.');
  if (cellsFor(twins, extra)[key]?.card) throw new Error('This zone is occupied. Move that card first.');
  if (land.zone === 'spell-trap' && twins.some(c => c.trapZone === land.slot)) throw new Error('A Trap Monster holds this zone.');
  return { type: 'twin.place', actorSeat: room.solo ? seat : room.mySeat, seat, zone: land.zone, anotherCopy: true, cam: playerStamp('zone-set'),
    card: { ref: newRef, slot: land.slot, faceUp: false, position: land.zone === 'monster' ? 'defense' : 'attack' } };
}
