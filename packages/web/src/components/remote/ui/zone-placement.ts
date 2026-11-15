import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
import { cardCode, cellsFor, hasExtraZones, mirrorEmz, type ZoneKey } from './model';
import { landingForCell } from './placement';
import { cardInfo } from './catalog';
import { playerStamp } from '@/lib/remote/field-timing';

export type ZonePick = { seat: number; key: ZoneKey; cardId: number; name: string; faceUp: boolean; fromRef?: string; anotherCopy?: boolean; targetRef?: string };
/** Re-run inside the room transaction: a picker never displaces a card that arrived while it was open. */
export function zonePlacement(room: RemoteRoom, pick: ZonePick, newRef: string): RemoteActionProposal[] {
  if (room.status !== 'active' || room.state.ended || room.state.match.phase !== 'duel' || room.state.seats[pick.seat]?.eliminated || !(room.solo || pick.seat === room.mySeat)) throw new Error('You can only edit your own active field.');
  const twins = room.state.seats[pick.seat].twin, extra = hasExtraZones(room.format?.id);
  const land = landingForCell(pick.key, cardInfo(pick.cardId), extra);
  const occupant = cellsFor(twins, extra)[pick.key]?.card;
  const target = pick.targetRef ? twins.find(c => c.ref === pick.targetRef) : occupant && !cardCode(occupant) && !occupant.token ? occupant : undefined;
  if(pick.targetRef&&(!target||!['monster','spell-trap','field','extra-monster','pendulum'].includes(target.zone)))throw new Error('That card left the field. Open the zone again.');
  if (occupant && occupant.ref !== target?.ref) throw new Error('This zone is occupied. Move that card first.');
  if (land.zone === 'extra-monster' && room.state.seats.some(s => s.seat !== pick.seat && s.twin.some(c => c.zone === 'extra-monster' && c.slot === mirrorEmz(land.slot ?? 1)))) throw new Error('That shared Extra Monster Zone is occupied.');
  if (twins.some(c => c.trapZone === (land.zone === 'pendulum' ? land.slot === 1 ? 1 : 5 : land.zone === 'spell-trap' ? land.slot : undefined) && c.trapZone !== undefined)) throw new Error('A Trap Monster holds this zone.');
  const actorSeat = room.solo ? pick.seat : room.mySeat, cam = playerStamp('zone-picker');
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
