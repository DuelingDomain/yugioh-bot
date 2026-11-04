import { availableEffectCandidates } from "./effect-tracking.js";
import { ygoBattleAllowed } from "./phases.js";
import { remoteAssert, type RemoteAction } from "./actions.js";
import { remotePhysicalSlot, remotePublicCard } from "./deck-checks.js";
import type { RemotePosition, RemoteState, RemoteUndoEntry } from "./types.js";

export const REMOTE_UNDO_LIMIT = 20;
export function remotePosition(state: RemoteState): RemotePosition {
  const { updatedAt: _at, undo: _undo, undoHistory: _history, ...position } = state;
  // Match the persisted JSON representation, including absent optional fields.
  return JSON.parse(JSON.stringify(position));
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Three-way inverse: restore only this action's changes, preserving unrelated later edits. */
function restore(before: unknown, after: unknown, current: unknown): unknown {
  if (equal(before, after)) return structuredClone(current);
  if (equal(current, after)) return structuredClone(before);
  if (before === undefined && object(after) && object(current)) before = {};
  if (before === undefined && Array.isArray(after) && Array.isArray(current)) before = [];
  if (object(before) && object(after) && object(current)) {
    const result = structuredClone(current);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = restore(before[key], after[key], current[key]);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    // Physical cards, seats, instances, flags and effect origins have stable identities.
    const all = [...before, ...after, ...current];
    const key = ["ref", "id", "seat"].find(k => all.length && all.every(v => object(v) && v[k] !== undefined) &&
      [before, after, current].every(items => new Set(items.map(v => v[k])).size === items.length));
    if (key) {
      const result = structuredClone(current);
      for (const id of new Set([...before, ...after].map(v => v[key]))) {
        const old = before.find(v => v[key] === id), applied = after.find(v => v[key] === id);
        const index = result.findIndex(v => v[key] === id);
        const value = restore(old, applied, index < 0 ? undefined : result[index]);
        if (value === undefined) { if (index >= 0) result.splice(index, 1); }
        else if (index >= 0) result[index] = value;
        else result.splice(Math.min(before.findIndex(v => v[key] === id), result.length), 0, value);
      }
      return result;
    }
  }
  remoteAssert(false, "A later action changed state needed by this undo; undo that action first", 409, "UNDO_CONFLICT");
}

/** Qualified refs avoid collisions between players using the same camera-generated ref. */
function touchedCards(action: RemoteAction, before: RemotePosition, after: RemotePosition): string[] {
  const refs = new Set<string>();
  const add = (seat: number, ref?: string) => { if (ref) refs.add(`${seat}:${ref}`); };
  switch (action.type) {
    case "twin.place": add(action.seat, action.card.ref); break;
    case "twin.move": case "twin.flip": case "twin.remove": case "card.identified": add(action.seat, action.cardRef); break;
    case "cards.identified": for (const card of action.cards) add(action.seat, card.cardRef); break;
    case "pile.lift": for (const ref of action.cardRefs) add(action.seat, ref); break;
    // Only the cards whose place changed: a reorder must not block Undo of earlier pile actions.
    case "pile.order": { const old = before.seats[action.seat]?.twin.filter(c => c.zone === action.zone).map(c => c.ref) ?? [];
      action.cardRefs.forEach((ref, i) => { if (old[i] !== ref) add(action.seat, ref); }); break; }
    case "effect.activated": add(action.actorSeat, action.source.cardRef); break;
    case "effect.choose": case "effect.announce": {
      const origin = before.effectTracking?.origins.find(o => o.id === action.originId);
      if (origin) add(origin.seat, origin.ref); break;
    }
    case "twin.merge": for (const i of before.deckChecks.instances)
      if ([action.keepInstanceId, action.removeInstanceId].includes(i.id)) for (const ref of i.refs) add(i.seat, ref);
      break;
    case "attack.declare": add(action.attackerSeat, action.attackerCardRef); add(action.targetSeat, action.targetCardRef); break;
    case "attack.resolve": if (before.attack) {
      add(before.attack.attackerSeat, before.attack.attackerCardRef); add(before.attack.targetSeat, before.attack.targetCardRef);
    } break;
  }
  for (const seat of before.seats) for (const ref of new Set([...seat.twin, ...after.seats[seat.seat].twin].map(c => c.ref))) {
    if (!equal(seat.twin.find(c => c.ref === ref), after.seats[seat.seat].twin.find(c => c.ref === ref))) add(seat.seat, ref);
  }
  return [...refs];
}

function prune(history: RemoteUndoEntry[], turn: number): RemoteUndoEntry[] {
  const counts = new Map<number, number>();
  const kept = [...history].sort((a,b)=>b.order-a.order).filter(entry => {
    const count = (counts.get(entry.actorSeat) ?? 0) + 1; counts.set(entry.actorSeat, count);
    return count <= REMOTE_UNDO_LIMIT && entry.turn >= turn - 1 && entry.turn <= turn;
  }).reverse();
  const ids = new Set(kept.map(e => e.actionId));
  for (const entry of kept) {
    if (entry.blockedBy?.some(id => !ids.has(id))) entry.blocked = true;
    entry.blockedBy = entry.blockedBy?.filter(id => ids.has(id));
  }
  return kept;
}

export function rememberRemoteAction(before: RemoteState, next: RemoteState, action: RemoteAction): void {
  const previous = remotePosition(before), after = remotePosition(next);
  const cards = touchedCards(action, previous, after);
  const history = structuredClone(before.undoHistory ?? []);
  // A camera correction of a card it just placed (the first read named it early)
  // joins that placement: one Undo still removes the card in one step.
  if (action.type === "card.identified" && action.source === "auto") {
    const ref = `${action.seat}:${action.cardRef}`, newest = [...history].sort((a,b)=>b.order-a.order)[0];
    if (newest && !newest.undone && newest.actorSeat === action.actorSeat && newest.action.type === "twin.place" && newest.action.source === "auto" &&
      `${newest.action.seat}:${newest.action.card.ref}` === ref && cards.every(c => newest.cards.includes(c)) && before.undo?.actionId === newest.actionId) {
      newest.after = after; newest.at = next.updatedAt;
      next.undoHistory = prune(history, next.turn);
      next.undo = { actionId: newest.actionId, at: next.updatedAt, before: newest.before! };
      return;
    }
  }
  for (const entry of history) if (!entry.undone && entry.cards.some(ref => cards.includes(ref)))
    (entry.blockedBy ??= []).push(action.idempotencyKey);
  history.push({ actionId: action.idempotencyKey, actorSeat: action.actorSeat, at: next.updatedAt, turn: before.turn,
    action, cards, order: Math.max(0, ...history.map(e=>e.order)) + 1, before: previous, after, blockedBy: [] });
  next.undoHistory = prune(history, next.turn);
  next.undo = { actionId: action.idempotencyKey, at: next.updatedAt, before: previous };
}

function restoredPosition(state: RemoteState, entry: RemoteUndoEntry): RemotePosition {
  const before = entry.before ?? (state.undo?.actionId === entry.actionId ? state.undo.before : undefined);
  const after = entry.after ?? (state.undo?.actionId === entry.actionId ? remotePosition(state) : undefined);
  remoteAssert(before && after, "Undo history is unavailable", 409, "UNDO_UNAVAILABLE");
  // Candidate lists and the current game's result are derived from the restored
  // board. An earlier Undo may already have reopened this game; do not inverse
  // the same result twice. Declarations still follow normal inverse semantics.
  const withoutDerivedState = (position: RemotePosition) => {
    const copy = structuredClone(position);
    for (const origin of copy.effectTracking?.origins ?? []) if (origin.pool) delete origin.candidates;
    copy.ended = state.ended; copy.winnerSeat = state.winnerSeat;
    copy.match = structuredClone(state.match);
    if (position.match?.pendingResult) copy.match.pendingResult = structuredClone(position.match.pendingResult);
    else delete copy.match.pendingResult;
    return copy;
  };
  const restored = restore(withoutDerivedState(before), withoutDerivedState(after), withoutDerivedState(remotePosition(state))) as RemotePosition;
  // Returning a card to an ordered pile restores its old place. Other cards
  // that entered that pile later keep their newer positions, including reentries.
  const later = (state.undoHistory ?? []).filter(item => !item.undone && item.order > entry.order && item.before && item.after);
  for (const seat of before.seats) {
    const twins = restored.seats[seat.seat].twin;
    for (let i = seat.twin.length - 1; i >= 0; i--) {
      const old = seat.twin[i];
      if (!["graveyard", "banished"].includes(old.zone) || after.seats[seat.seat].twin.find(card => card.ref === old.ref)?.zone === old.zone) continue;
      const index = twins.findIndex(card => card.ref === old.ref && card.zone === old.zone);
      if (index < 0) continue;
      const newer = new Set(later.flatMap(item => item.after!.seats[seat.seat].twin.filter(card => card.zone === old.zone &&
        item.before!.seats[seat.seat].twin.find(previous => previous.ref === card.ref)?.zone !== old.zone).map(card => card.ref)));
      const [card] = twins.splice(index, 1);
      const anchor = (neighbor: typeof old) => neighbor.zone !== old.zone || newer.has(neighbor.ref) ? -1 :
        twins.findIndex(current => current.ref === neighbor.ref && current.zone === old.zone);
      const following = seat.twin.slice(i + 1).map(anchor).filter(n => n >= 0);
      const preceding = seat.twin.slice(0, i).map(anchor).filter(n => n >= 0);
      const first = twins.findIndex(current => current.zone === old.zone);
      const destination = following.length ? Math.min(...following) : preceding.length ? Math.max(...preceding) + 1 : first < 0 ? twins.length : first;
      twins.splice(destination, 0, card);
    }
  }
  const living = restored.seats.filter(s=>!s.eliminated);
  restored.ended = living.length <= 1;
  restored.winnerSeat = restored.ended ? living[0]?.seat ?? null : null;
  // In FFA, undoing an earlier elimination can reopen a game ended by another
  // player's later action. The three-way inverse keeps that later result, so
  // remove it when the board again has more than one living seat.
  if (!restored.ended && restored.match && ["result", "done"].includes(restored.match.phase)) {
    restored.match.games.pop(); restored.match.phase = "duel";
    delete restored.match.winnerSeat; delete restored.match.firstChooser; delete restored.match.firstSeat;
  }
  remoteAssert(!restored.attack || (restored.phase === "battle" && restored.turnSeat === restored.attack.attackerSeat &&
    ygoBattleAllowed(restored) && !restored.seats[restored.attack.attackerSeat].eliminated && !restored.seats[restored.attack.targetSeat].eliminated),
    "Resolve or undo the later attack before undoing this action", 409, "UNDO_CONFLICT");
  for (const origin of restored.effectTracking?.origins ?? []) if (origin.pool)
    origin.candidates = availableEffectCandidates({...restored,updatedAt:state.updatedAt,undo:null}, origin.pool, origin.seat, origin.minimumCopies, origin.searchSource);
  // A later move of another card may have occupied the slot this undo would restore.
  for (const seat of restored.seats) for (const card of seat.twin) {
    const slot = remotePhysicalSlot(card.zone, card.slot);
    if (slot === undefined && card.zone !== "field") continue;
    const collides = (cards: typeof seat.twin) => cards.some(c => c.ref !== card.ref && c.zone === card.zone &&
      (card.zone === "field" || remotePhysicalSlot(c.zone, c.slot) === slot));
    const old = before.seats[seat.seat].twin;
    remoteAssert(!collides(seat.twin) || (old.some(c => c.ref === card.ref && c.zone === card.zone && c.slot === card.slot) && collides(old)),
      "Cannot undo: the original physical field slot is occupied", 409, "UNDO_CONFLICT");
  }
  // A Trap Monster's held Spell & Trap Zone counts as taken: never restore a hold onto a used zone, or a card onto a held one.
  for (const seat of restored.seats) {
    const held = (cards: typeof seat.twin) => cards.some(a => a.trapZone !== undefined && cards.some(b => b.ref !== a.ref &&
      (b.trapZone === a.trapZone || b.zone === "spell-trap" && remotePhysicalSlot(b.zone, b.slot) === a.trapZone)));
    remoteAssert(!held(seat.twin) || held(before.seats[seat.seat].twin), "Cannot undo: that Spell & Trap Zone is in use", 409, "UNDO_CONFLICT");
  }
  return restored;
}

export function remoteUndoReason(state: RemoteState, entry: RemoteUndoEntry, actorSeat: number): string | undefined {
  const gameNumber = (position: RemotePosition) => position.match.games.length + (position.ended ? 0 : 1);
  if (state.match?.phase === "siding" || (entry.before?.match && gameNumber(entry.before) !== gameNumber(state))) return "Undo cannot cross games";
  if (entry.actorSeat !== actorSeat) return "You can only undo your own actions";
  if (entry.undone) return "This action has already been undone";
  if (entry.turn < state.turn - 1 || entry.turn > state.turn) return "Undo is limited to the current and previous turn";
  if (entry.blocked || entry.blockedBy?.length) return "A later action touched the same card; undo that action first";
  const newest = [...(state.undoHistory ?? [])].sort((a,b)=>b.order-a.order).find(e => e.actorSeat === actorSeat && !e.undone);
  if (newest?.actionId !== entry.actionId && entry.cards.length !== 1) return "Undo your newer actions first; only single-card actions can be targeted out of order";
  try { restoredPosition(state, entry); } catch (error) { return (error as Error).message; }
}

/** Newest first, with complete action params even when the room's event page has rolled over. */
export function remoteUndoHistory(state: RemoteState, actorSeat: number): RemoteUndoEntry[] {
  return [...(state.undoHistory ?? [])].sort((a,b)=>b.order-a.order).filter(e => e.actorSeat === actorSeat && !e.undone).map(entry => {
    const { before: _before, after: _after, blockedBy: _blockedBy, blocked: _blocked, ...summary } = entry;
    return { ...summary, reason: entry.before && entry.after ? remoteUndoReason(state, entry, actorSeat) : entry.reason };
  });
}

export function undoRemoteAction(state: RemoteState, action: Extract<RemoteAction, {type: "undo"}>): RemoteState {
  const entry = state.undoHistory?.find(e => e.actionId === action.targetActionId);
  remoteAssert(entry, "Undo is limited to your last 20 recent actions in the current and previous turn", 409, "UNDO_UNAVAILABLE");
  const reason = remoteUndoReason(state, entry, action.actorSeat);
  remoteAssert(!reason, reason ?? "Undo unavailable", 409, "UNDO_CONFLICT");
  const restored = restoredPosition(state, entry);
  const history = structuredClone(state.undoHistory!);
  for (const item of history) {
    item.blockedBy = item.blockedBy?.filter(id => id !== entry.actionId);
    if (item.turn > restored.turn) item.turn = restored.turn;
    if (item.actionId === entry.actionId) { item.undone = true; delete item.before; delete item.after; }
  }
  const next: RemoteState = { ...restored, updatedAt: action.at ?? state.updatedAt, undo: null, undoHistory: prune(history, restored.turn) };
  const latest = [...next.undoHistory!].reverse().find(e => !e.undone && !remoteUndoReason(next, e, e.actorSeat));
  if (latest?.before) next.undo = { actionId: latest.actionId, at: latest.at, before: restoredPosition(next, latest) };
  return next;
}

const summonName = (kind: string) => `${kind === "xyz" ? "Xyz" : kind[0].toUpperCase() + kind.slice(1)} Summon`;
/** Public log labels use identities only when the physical card was public. */
export function remoteUndoLabel(action: RemoteAction, position?: RemotePosition): string {
  const ref = action.type === "twin.place" ? action.card.ref : "cardRef" in action ? action.cardRef : undefined;
  const seat = "seat" in action ? action.seat : action.actorSeat;
  const twin = position?.seats[seat].twin.find(c=>c.ref===ref);
  const name = twin && remotePublicCard(twin) ? twin.name ?? position?.deckChecks.instances.find(i=>i.seat===seat && i.refs.includes(twin.ref))?.name ?? "Card" : "Card";
  const zone = (z: string, slot?: number) => ({monster:"M", "spell-trap":"S", pendulum:"P", "extra-monster":"EMZ"}[z] ?? z) + (slot ?? "");
  switch (action.type) {
    case "twin.move": return `${name} → ${zone(action.zone, action.slot)}`;
    case "twin.place": return action.summon ? `${summonName(action.summon.kind)}: ${name} (${action.summon.materialRefs.length} material${action.summon.materialRefs.length === 1 ? "" : "s"})` : `${name} placed → ${zone(action.zone, action.card.slot)}`;
    case "twin.attach": return `${summonName(action.kind)}: ${name} (${action.materialRefs.length} material${action.materialRefs.length === 1 ? "" : "s"})`;
    case "twin.detach": return `${name}: material detached`;
    case "twin.flip": return `${name} flipped ${action.faceUp ? "up" : "down"}`;
    case "twin.remove": return `${name} removed`;
    case "twin.equip": return action.target ? `${name} equipped` : `${name} unequipped`;
    case "hand.add": return "Added card to hand";
    case "hand.reveal": return "Revealed card in hand";
    case "hand.forget": return "Forgot known hand card";
    case "hand.count": return "Changed hand count";
    case "hand.draw": return `Drew ${action.count} card${action.count===1?'':'s'}`;
    case "deck.count": return "Changed Deck count";
    case "pile.order": return `${action.zone === "graveyard" ? "Graveyard" : "Banished"} order changed`;
    case "pile.lift": return `${action.zone === "graveyard" ? "Graveyard" : "Banished"} picked up (${action.cardRefs.length} card${action.cardRefs.length === 1 ? "" : "s"})`;
    case "lp.change": return `${action.delta < 0 ? "−" : "+"}${Math.abs(action.delta)} LP`;
    case "phase.set": return action.phase;
    case "turn.end": return "Passed the turn";
    default: return action.type;
  }
}
