import { z } from 'zod';
import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';

const location = z.object({ zone: z.string(), slot: z.number().optional() });
const evidence = location.extend({ id: z.string(), faceDown: z.boolean(), position: z.string().optional(), cardId: z.string().optional() });
const correction = z.object({ ref: z.string(), anchors: z.array(location), physical: evidence.optional(), refs: z.array(z.string()).optional(), coveredIds: z.array(z.string()).optional(), departure: z.enum(['remove', 'move']).optional() });
type Location = z.infer<typeof location>;
type Correction = z.infer<typeof correction>;
export type CorrectionObservation = z.infer<typeof evidence> & { ref: string; removed: boolean; resting: boolean };
const cell=(a:Location)=>a.zone==='pendulum'?`spell-trap:${a.slot===2?5:1}`:`${a.zone}:${a.slot??0}`;
const sameCell = (a: Location, b: Location) => cell(a)===cell(b);
const samePhysical = (a: z.infer<typeof evidence>, b: z.infer<typeof evidence>) => sameCell(a, b) && a.faceDown === b.faceDown && a.position === b.position;
const field = (zone: string) => ['monster', 'spell-trap', 'field', 'pendulum', 'extra-monster'].includes(zone);
const watchedPile = (zone: string) => zone === 'graveyard' || zone === 'banished';

/** One record per physical ref. No timer accepts a camera guess over a player's choice. */
export function createManualCorrections(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, key: string) {
  const holds = new Map<string, Correction>();
  let serialized: string | null = null;
  let observations: readonly CorrectionObservation[] = [];
  const changing = new Map<string, { value: string; since: number }>();
  try {
    serialized = storage?.getItem(key) ?? null;
    const parsed = z.array(correction).safeParse(JSON.parse(serialized ?? '[]'));
    if (parsed.success) for (const hold of parsed.data) holds.set(hold.ref, hold);
  } catch { /* Storage is optional. */ }
  const save = () => { try { if(storage){const next=JSON.stringify([...holds.values()]);storage.setItem(key,next);serialized=next;} } catch { /* Keep the in-page hold. */ } };
  return {
    storageMatches() { try { return !storage || storage.getItem(key) === serialized; } catch { return true; } },
    has: (ref: string) => [...holds.values()].some(h => h.ref === ref || h.refs?.includes(ref)),
    /** Drops one hold on purpose: the player's next step is to let the camera place a card in that cell. */
    release(ref: string) { if (holds.delete(ref)) { changing.delete(ref); save(); } },
    rebind(from:string,to:string,restored=false) {
      const hold=holds.get(from)??[...holds.values()].find(h=>h.refs?.includes(from));
      if(!hold||hold.ref===to&&!restored)return;
      holds.delete(hold.ref);
      holds.set(to,{...hold,ref:to,...(restored?{physical:undefined,coveredIds:[]}: {})});save();
    },
    begin(ref: string, anchors: Location[], refs: string[] = [ref], coveredRefs: string[] = [], departure?: Correction['departure']) {
      anchors=anchors.filter(a=>field(a.zone)||departure==='remove'&&watchedPile(a.zone));
      const previous = holds.get(ref);
      refs = [...new Set([...(previous?.refs ?? []), ...refs])];
      const displaced=[...holds].filter(([other,h])=>other!==ref&&anchors.some(a=>h.anchors.some(b=>sameCell(a,b))||!!h.physical&&sameCell(a,h.physical)));
      for(const [other] of displaced)holds.delete(other);
      const coveredIds = [...new Set([...(previous?.coveredIds ?? []), ...observations.filter(t => coveredRefs.includes(t.ref)).map(t => t.id)])];
      const physical = observations.find(t => !coveredRefs.includes(t.ref) && !t.removed && t.resting && (t.ref === ref || anchors.some(a => sameCell(a, t))));
      const hold: Correction = { ref, anchors, refs, coveredIds, ...(physical ? { physical } : {}), ...(departure ? { departure } : {}) };
      holds.set(ref, hold); changing.delete(ref); save();
      // A rejected write restores the earlier choice; it cannot erase a later click.
      return () => { if (holds.get(ref) !== hold) return; if (previous) holds.set(ref, previous); else holds.delete(ref); for(const [other,h]of displaced)if(!holds.has(other))holds.set(other,h);save(); };
    },
    observe(next: readonly CorrectionObservation[], now: number) {
      observations = next;
      let changed = false;
      const releasedTracks: string[] = [];
      for (const [ref, hold] of holds) {
        const eligible = next.filter(t => !hold.coveredIds?.includes(t.id) && !(t.ref !== ref && hold.refs?.includes(t.ref)));
        const bound = eligible.find(t => t.id === hold.physical?.id) ?? eligible.find(t => t.ref === ref);
        const replacement = eligible.find(t => !t.removed && hold.anchors.some(a => sameCell(a, t)));
        const track = bound && !bound.removed ? bound : replacement ?? bound;
        if (!track) { changing.delete(ref); continue; }
        if (track.removed) {
          if (!hold.departure && hold.physical) { holds.delete(ref); changing.delete(ref); changed = true; }
          else if (hold.departure) {
            const value = `removed:${track.id}`;
            const before = changing.get(ref);
            if (before?.value !== value) changing.set(ref, { value, since: now });
            else if (now - before.since >= 1500) {
              holds.delete(ref); changing.delete(ref); changed = true;
              if (hold.departure === 'remove') releasedTracks.push(track.id);
            }
          }
          continue;
        }
        if (!track.resting) { changing.delete(ref); continue; }
        const physical = hold.physical;
        if (!physical) { hold.physical = track; changed = true; continue; }
        const inSameCell = sameCell(physical, track);
        const differentCard = !!physical.cardId && !!track.cardId && track.cardId !== physical.cardId;
        const sameRemovedTrack = hold.departure === 'remove' && physical.id === track.id;
        const unchanged = hold.departure ? (inSameCell || sameRemovedTrack) && !differentCard : samePhysical(physical, track);
        if (unchanged) {
          if (sameRemovedTrack && !inSameCell) hold.anchors = hold.anchors.filter(anchor => !sameCell(anchor, physical));
          if (!inSameCell || physical.id !== track.id || !physical.cardId && track.cardId) {
            hold.physical = { ...track, cardId: track.cardId ?? physical.cardId }; changed = true;
          }
          changing.delete(ref); continue;
        }
        const value = JSON.stringify([track.zone, track.slot, track.faceDown, track.position, track.cardId]);
        const before = changing.get(ref);
        if (!before || before.value !== value) changing.set(ref, { value, since: now });
        else if (now - before.since >= 2000) {
          holds.delete(ref); changing.delete(ref); changed = true;
          if (hold.departure === 'remove') releasedTracks.push(physical.id);
        }
      }
      if (changed) save();
      return releasedTracks;
    },
    blocks(refs: readonly string[], at?: Location) {
      return [...holds.values()].some(h => refs.includes(h.ref) || h.refs?.some(ref => refs.includes(ref)) || !!at && (field(at.zone)||h.departure==='remove'&&watchedPile(at.zone)) &&
        (h.anchors.some(a => sameCell(a, at)) || !!h.physical && sameCell(h.physical, at)));
    },
  };
}

const stores = new Map<string, ReturnType<typeof createManualCorrections>>();
export function correctionsFor(room: RemoteRoom, seat: number) {
  // A new game in the same match gets new physical refs and its own holds.
  const key = `dd-field-corrections:v1:${room.guildId}:${room.slug}:${room.seats.find(s=>s.seat===seat)?.userId ?? ''}:${room.state.match?.games.length ?? 0}:${seat}`;
  let store = stores.get(key);
  if (!store || !store.storageMatches()) { let storage: Storage | undefined; try { storage = sessionStorage; } catch { /* SSR/private mode. */ }
    store = createManualCorrections(storage, key); stores.set(key, store);
  }
  return store;
}

export function automaticCorrectionAction(action: RemoteActionProposal) {
  return action.cam?.by !== 'player' && (action.cam?.by === 'camera' || 'source' in action && action.source === 'auto');
}
function refsOf(action: RemoteActionProposal): string[] {
  if (action.type === 'twin.place') return [action.card.ref, ...(action.fromRef ? [action.fromRef] : []), ...(action.summon?.materialRefs ?? [])];
  if (action.type === 'twin.merge') return [action.keepRef, action.removeRef].filter((r): r is string => !!r);
  if (action.type === 'cards.identified') return action.cards.flatMap(c => c.cardRef ? [c.cardRef] : []);
  return [...('cardRef' in action && action.cardRef ? [action.cardRef] : []), ...('materialRefs' in action ? action.materialRefs : []), ...('materialRef' in action ? [action.materialRef] : []), ...('cardRefs' in action ? action.cardRefs : [])];
}
export function cameraCorrectionBlocked(room: RemoteRoom, action: RemoteActionProposal) {
  if (!automaticCorrectionAction(action) || !('seat' in action)) return false;
  const refs = refsOf(action), store = correctionsFor(room, action.seat);
  if(action.type==='twin.attach'&&action.materialSeat!==undefined&&correctionsFor(room,action.materialSeat).blocks(action.materialRefs))return true;
  if (action.type === 'cards.identified') return action.cards.some(c => store.blocks(c.cardRef ? [c.cardRef] : [], c.zone ? { zone: c.zone, slot: c.slot } : undefined));
  const at = 'zone' in action && typeof action.zone === 'string' ? { zone: action.zone, slot: action.type === 'twin.place' ? action.card.slot : 'slot' in action ? action.slot : undefined } : undefined;
  return store.blocks(refs, at);
}
export function adoptManualCorrection(room:RemoteRoom,action:RemoteActionProposal){
  if(action.type==='undo'){
    const entry=room.state.undoHistory?.find(e=>e.actionId===action.targetActionId);
    for(const seat of room.state.seats){
      const restored=seat.twin.find(c=>field(c.zone)&&entry?.cards.includes(`${seat.seat}:${c.ref}`));
      const touched=entry?.cards.find(ref=>ref.startsWith(`${seat.seat}:`));
      if(restored&&touched)correctionsFor(room,seat.seat).rebind(touched.slice(touched.indexOf(':')+1),restored.ref,true);
    }
    return;
  }
  if(automaticCorrectionAction(action)||action.type!=='twin.place')return;
  const saved=room.state.seats[action.seat].twin.find(c=>c.zone===action.zone&&(c.slot??0)===(action.card.slot??0)&&
    (c.ref===action.card.ref||!!action.card.cardId&&(c.cardId??c.passcode)===action.card.cardId));
  if(saved)correctionsFor(room,action.seat).rebind(action.card.ref,saved.ref);
}
/** Called at the click boundary, before this action waits for older HTTP work. */
export function beginManualCorrection(room: RemoteRoom, action: RemoteActionProposal) {
  if (automaticCorrectionAction(action)) return () => {};
  const undos: (() => void)[] = [];
  const touch = (seat: number, refs: string[], after?: Location, coveredRefs: string[] = []) => {
    if (!refs.length) return;
    const twins = room.state.seats[seat]?.twin ?? [];
    refs = [...new Set(refs.flatMap(ref => [ref, ...(twins.find(c => c.ref === ref)?.materials ?? [])]))];
    const [ref] = refs;
    if (!ref) return;
    const anchors = refs.flatMap(ref => twins.filter(c => c.ref === ref && (!watchedPile(c.zone) ||
      action.type === 'twin.remove' && [...twins].reverse().find(top => top.zone === c.zone)?.ref === ref)));
    const leavesField = action.type === 'twin.move' && !field(action.zone) && anchors.some(a => field(a.zone));
    undos.push(correctionsFor(room, seat).begin(ref, [...anchors, ...(after ? [after] : [])], refs, coveredRefs, action.type === 'twin.remove' ? 'remove' : leavesField ? 'move' : undefined));
  };
  if (action.type === 'undo') {
    const entry = room.state.undoHistory?.find(e => e.actionId === action.targetActionId);
    for (const seat of room.state.seats) {
      const refs = (entry?.cards ?? []).filter(ref => ref.startsWith(`${seat.seat}:`)).map(ref => ref.slice(ref.indexOf(':') + 1));
      refs.sort((a,b) => Number(!seat.twin.some(c => c.ref === a && field(c.zone))) - Number(!seat.twin.some(c => c.ref === b && field(c.zone))));
      touch(seat.seat, refs);
    }
  } else if ('seat' in action && /^(twin\.(place|move|flip|remove|attach|detach|merge)|cards?\.identified)$/.test(action.type)) {
    const refs = refsOf(action);
    const occupied = action.type === 'twin.place' ? room.state.seats[action.seat].twin.filter(c => c.ref !== action.card.ref && field(c.zone) && sameCell(c, { zone: action.zone, slot: action.card.slot })).map(c => c.ref) : [];
    refs.push(...occupied);
    const covered = action.type === 'twin.place' ? [...(action.summon?.materialRefs ?? []), ...occupied] : [];
    touch(action.seat, action.type === 'twin.attach' && action.materialSeat !== undefined && action.materialSeat !== action.seat ? [action.cardRef] : refs,
      action.type === 'twin.place' ? { zone: action.zone, slot: action.card.slot } : action.type === 'twin.move' ? action : undefined, covered);
    if (action.type === 'twin.attach' && action.materialSeat !== undefined && action.materialSeat !== action.seat) touch(action.materialSeat, action.materialRefs);
  }
  return () => { for (const undo of undos.reverse()) undo(); };
}
