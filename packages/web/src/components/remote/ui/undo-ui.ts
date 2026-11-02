import type { RemoteAction, RemoteEvent, RemoteSystemAction } from "@yugidraft/shared/remote";
import { PHASE_LONG } from "./model";

type AnyAction = RemoteAction | RemoteSystemAction;

/** Short zone names for the Undo label: "Dark Magician → M3". */
function zoneShort(zone: string, slot?: number): string {
  const n = slot ?? "";
  switch (zone) {
    case "monster": return `M${n}`;
    case "spell-trap": return `S${n}`;
    case "pendulum": return `P${n}`;
    case "extra-monster": return `EMZ${n}`;
    case "field": return "Field";
    case "graveyard": return "GY";
    case "banished": return "Banished";
    case "hand": return "Hand";
    case "extra": return "Extra Deck";
    case "deck": return "Deck";
    default: return zone;
  }
}

/** Refs of the physical cards an action touches. Empty for actions that are not about one card. */
export function actionCardRefs(action: AnyAction): string[] {
  switch (action.type) {
    case "twin.move": case "twin.flip": case "twin.remove": return [action.cardRef];
    case "twin.place": return action.card.ref ? [action.card.ref] : [];
    case "card.identified": return action.cardRef ? [action.cardRef] : [];
    case "effect.activated": return action.source.cardRef ? [action.source.cardRef] : [];
    case "attack.declare": return [action.attackerCardRef, action.targetCardRef].filter((ref): ref is string => !!ref);
    default: return [];
  }
}

/**
 * The short label on the field Undo button. Returns null when the action has no short form,
 * so the caller falls back to the longer log line.
 */
export function shortUndoLabel(event: RemoteEvent, cardName: (seat: number, ref: string) => string | undefined, name: (seat: number) => string): string | null {
  const a = event.action as AnyAction;
  switch (a.type) {
    case "twin.move": return `${a.name ?? cardName(a.seat, a.cardRef) ?? "Card"} → ${zoneShort(a.zone, a.slot)}`;
    case "twin.place": return `${a.card.name ?? cardName(a.seat, a.card.ref) ?? "Card"} placed → ${zoneShort(a.zone, a.card.slot)}`;
    case "twin.flip": return `${cardName(a.seat, a.cardRef) ?? "Card"} flipped ${a.faceUp ? "up" : "down"}`;
    case "twin.remove": return `${cardName(a.seat, a.cardRef) ?? "Card"} removed`;
    case "lp.change": return `${name(a.seat)} ${a.delta < 0 ? "−" : "+"}${Math.abs(a.delta)} LP`;
    case "phase.set": return PHASE_LONG[a.phase] ?? a.phase;
    default: return null;
  }
}

/**
 * The one place that knows how to go back a phase: phase.set to the earlier phase. The caller picks the target,
 * the previous phase from `previousYgoPhase(state)` or the earlier phase the player clicked.
 */
export function phaseBackAction(actorSeat: number, phase: string): RemoteAction {
  return { type: "phase.set", actorSeat, phase } as RemoteAction;
}
