import { remoteActionSchema, remoteAssert, type RemoteAction } from "../actions.js";
import type { GameModule, RemotePosition, RemoteSeatState, RemoteState } from "../types.js";
import { resolveAttack } from "../attack-resolver.js";
import { parseRemoteCommand } from "../command-parser.js";
import { initialDeckChecks, remotePhysicalSlot, type RemoteReductionContext } from "../deck-checks.js";
import { applyLiveDeckChecks } from "../live-deck-checks.js";

import { applyRemoteEffectTracking, availableEffectCandidates } from "../effect-tracking.js";

const phases = [
  { id: "draw", name: "Draw" }, { id: "standby", name: "Standby" }, { id: "main1", name: "Main 1" },
  { id: "battle", name: "Battle" }, { id: "main2", name: "Main 2" }, { id: "end", name: "End" },
] as const;
const zones = [
  { id: "monster", name: "Monster", shape: "row" }, { id: "spell-trap", name: "Spell / Trap", shape: "row" },
  { id: "extra-monster", name: "Extra Monster", shape: "row" }, { id: "field", name: "Field", shape: "single" },
  { id: "graveyard", name: "Graveyard", shape: "pile" }, { id: "banished", name: "Banished", shape: "pile" },
  { id: "hand", name: "Hand (hidden)", shape: "pile" }, { id: "deck", name: "Deck (hidden)", shape: "pile" },
  { id: "extra", name: "Extra Deck", shape: "pile" }, { id: "pendulum", name: "Pendulum", shape: "row" },
  { id: "hand-reveal", name: "Hand reveal", shape: "pile" },
] as const;
export function ygoBattleAllowed(state: RemotePosition): boolean {
  return state.seatCount === 2 ? state.turn > 1 : state.seats.every(s => s.eliminated || state.startedSeats.includes(s.seat));
}
function position(state: RemoteState): RemotePosition {
  const { updatedAt: _at, undo: _undo, ...board } = state;
  return structuredClone(board);
}
function reduce(state: RemoteState, input: RemoteAction, context?: RemoteReductionContext): RemoteState {
  const parsed = remoteActionSchema.safeParse(input);
  remoteAssert(parsed.success, "Invalid remote action");
  const action = parsed.data;
  const at = action.at ?? state.updatedAt;
  remoteAssert(at >= state.updatedAt, "Action time precedes state");
  remoteAssert(state.seats[action.actorSeat], "Invalid actor seat");
  if (action.type === "undo") {
    const undo = state.undo;
    remoteAssert(undo && undo.actionId === action.targetActionId && at - undo.at <= 5000, "Undo expired or action is no longer the latest reversible action", 409, "UNDO_UNAVAILABLE");
    return { ...structuredClone(undo.before), updatedAt: at, undo: null };
  }
  remoteAssert(!state.ended, "Game has ended", 409);
  remoteAssert(!state.seats[action.actorSeat].eliminated, "Actor seat is eliminated", 403);
  let next: RemoteState = { ...structuredClone(state), updatedAt: at };
  next.deckChecks ??= initialDeckChecks();
  const ownTurn = () => remoteAssert(action.actorSeat === state.turnSeat || state.seats[state.turnSeat].eliminated, "Only the turn player can advance", 403);
  const seat = (n: number) => {
    const s = next.seats[n]; remoteAssert(s && !s.eliminated, "Target seat is unavailable", 409); return s;
  };
  const ownField = (n: number) => { remoteAssert(n === action.actorSeat, "Only the field owner can edit their twin", 403); return seat(n); };
  const validZone = (z: string) => remoteAssert(zones.some(item => item.id === z), "Unknown zone");
  const freeSlot = (s: RemoteSeatState, zone: string, slot?: number, exceptRef?: string) => {
    const shape = zones.find(item => item.id === zone)?.shape;
    if (shape === "pile") return;
    const physicalSlot = remotePhysicalSlot(zone, slot);
    remoteAssert(shape !== "row" || slot === undefined || physicalSlot !== undefined, "Invalid physical slot");
    // Legacy row twins without a slot do not identify a physical position.
    if (shape === "row" && physicalSlot === undefined) return;
    remoteAssert(!s.twin.some(card => card.ref !== exceptRef && card.zone === zone &&
      (shape === "single" || remotePhysicalSlot(card.zone, card.slot) === physicalSlot)),
    "Physical field slot is occupied", 409, "TWIN_SLOT_OCCUPIED");
  };
  const endTurn = () => {
    ownTurn(); remoteAssert(!state.attack, "Resolve the attack first", 409);
    let n = state.turnSeat;
    do { n = (n + 1) % state.seatCount; } while (next.seats[n].eliminated);
    next.turnSeat = n; next.turn++; next.phase = "draw";
    if (!next.startedSeats.includes(n)) next.startedSeats.push(n);
  };
  const setPhase = (phase: string) => {
    ownTurn(); remoteAssert(!state.attack, "Resolve the attack first", 409);
    remoteAssert(phases.some(p => p.id === phase), "Unknown phase");
    remoteAssert(phase !== "battle" || ygoBattleAllowed(state), "Battle Phase is unavailable in the opening turns", 409);
    next.phase = phase;
  };
  switch (action.type) {
    case "phase.set": setPhase(action.phase); break;
    case "phase.advance": {
      const index = phases.findIndex(p => p.id === state.phase);
      if (index === phases.length - 1) endTurn();
      else {
        let nextIndex = index + 1;
        if (phases[nextIndex].id === "battle" && !ygoBattleAllowed(state)) nextIndex++;
        setPhase(phases[nextIndex].id);
      }
      break;
    }
    case "turn.end": endTurn(); break;
    case "lp.change": {
      const s = seat(action.seat);
      remoteAssert(s.resources.lp + action.delta <= 999999, "LP exceeds supported maximum");
      s.resources.lp = Math.max(0, s.resources.lp + action.delta);
      s.eliminated = s.resources.lp === 0;
      break;
    }
    case "player.concede": next.seats[action.actorSeat].eliminated = true; break;
    case "attack.declare":
      ownTurn(); seat(action.targetSeat);
      remoteAssert(action.attackerSeat === action.actorSeat && action.targetSeat !== action.actorSeat, "Invalid attacker or target seat");
      remoteAssert(state.phase === "battle" && ygoBattleAllowed(state) && !state.attack, "Attack requires an available Battle Phase and no pending attack", 409);
      remoteAssert(action.direct === true ? !action.targetCardRef : !!action.targetCardRef, "Choose a target card or a direct attack");
      if (action.attackerCardRef) remoteAssert(seat(action.attackerSeat).twin.some(c => c.ref === action.attackerCardRef), "Unknown attacker card");
      if (action.targetCardRef) remoteAssert(seat(action.targetSeat).twin.some(c => c.ref === action.targetCardRef), "Unknown target card");
      next.attack = { id: action.idempotencyKey, attackerSeat: action.attackerSeat, attackerCardRef: action.attackerCardRef, targetSeat: action.targetSeat, targetCardRef: action.targetCardRef, direct: action.direct };
      break;
    case "attack.resolve":
      remoteAssert(state.attack?.id === action.attackId, "Attack is no longer pending", 409);
      remoteAssert(action.actorSeat === state.attack.attackerSeat || action.actorSeat === state.attack.targetSeat, "Only the attacker or target can resolve an attack", 403);
      next.attack = null; break;
    case "card.identified": case "cards.identified": {
      seat(action.seat);
      const sightings = action.type === "card.identified" ? [action] : action.cards;
      for (const card of sightings) {
        remoteAssert(card.cardId || card.passcode, "A cardId or passcode is required");
        if (card.zone) validZone(card.zone);
        if (card.cardRef) remoteAssert(ownField(action.seat).twin.some(c => c.ref === card.cardRef), "Unknown twin card", 409);
      }
      break;
    }
    case "effect.activated": case "effect.choose": case "effect.announce": case "effect.context.clear": case "effect.note.dismiss": break;
    case "deck.add": ownField(action.seat); break;
    case "deck.flag.dismiss": break;
    case "twin.merge": ownField(action.seat); break;
    case "twin.place": {
      const s = ownField(action.seat); validZone(action.zone);
      remoteAssert(s.twin.length < 100 && !s.twin.some(c => c.ref === action.card.ref), "Duplicate card ref or field is full", 409);
      freeSlot(s, action.zone, action.card.slot);
      s.twin.push({ ...action.card, zone: action.zone }); break;
    }
    case "twin.move": case "twin.flip": case "twin.remove": {
      const s = ownField(action.seat); const card = s.twin.find(c => c.ref === action.cardRef);
      remoteAssert(card, "Unknown twin card", 409);
      if (action.type === "twin.move") {
        validZone(action.zone);
        const slot = action.slot ?? (card.zone === action.zone ? card.slot : undefined);
        freeSlot(s, action.zone, slot, card.ref);
        if (card.zone !== action.zone) delete card.slot;
        if (action.slot !== undefined) card.slot = action.slot;
        card.zone = action.zone;
        if(["deck","extra"].includes(card.zone)) delete card.publicIdentity;
        if (action.position !== undefined) card.position = action.position;
      }
      if (action.type === "twin.flip") card.faceUp = action.faceUp;
      if (action.type === "twin.remove") s.twin = s.twin.filter(c => c.ref !== action.cardRef);
      break;
    }
    case "log.note": return next;
  }
  applyRemoteEffectTracking(next, state, action, context);
  next = applyLiveDeckChecks(next, action, context);
  for(const origin of next.effectTracking?.origins ?? []) if(origin.pool)
    origin.candidates=availableEffectCandidates(next,origin.pool,origin.seat,origin.minimumCopies);
  for (const s of next.seats) if (s.eliminated) s.twin = [];
  if (next.attack && (next.seats[next.attack.attackerSeat].eliminated || next.seats[next.attack.targetSeat].eliminated)) next.attack = null;
  const living = next.seats.filter(s => !s.eliminated);
  if (living.length <= 1) { next.ended = true; next.winnerSeat = living[0]?.seat ?? null; next.attack = null; }
  next.undo = { actionId: action.idempotencyKey, at, before: position(state) };
  return next;
}
export const ygoModule: GameModule = {
  id: "ygo", name: "Yu-Gi-Oh!", phases, seatsAllowed: [2, 3, 4],
  resources: [{ id: "lp", name: "LP", start: 8000, min: 0, loseAtZero: true }], zones,
  initialState({ seatCount, firstSeat = 0 }) {
    remoteAssert([2, 3, 4].includes(seatCount) && Number.isInteger(firstSeat) && firstSeat >= 0 && firstSeat < seatCount, "Invalid seats");
    return { gameId: "ygo", seatCount, phase: "draw", turn: 1, turnSeat: firstSeat, startedSeats: [firstSeat],
      seats: Array.from({ length: seatCount }, (_, seat) => ({ seat, resources: { lp: 8000 }, eliminated: false, twin: [] })),
      ended: false, winnerSeat: null, attack: null, identified: null, deckChecks: initialDeckChecks(), showCardsSetFromDeck: true, updatedAt: 0, undo: null };
  }, reduce, parseCommand: parseRemoteCommand, resolveAttack,
};
