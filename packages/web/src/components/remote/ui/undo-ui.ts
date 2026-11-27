import { remoteUndoLabel, type RemoteAction, type RemoteState, type RemoteSystemAction, type RemoteUndoEntry } from "@yugidraft/shared/remote";
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
    case "pile.lift": return action.cardRefs;
    case "monsters.tribute": return action.targets.map(t => t.cardRef);
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
export function shortUndoLabel(event: { action: unknown }, cardName: (seat: number, ref: string) => string | undefined, name: (seat: number) => string): string | null {
  const a = event.action as AnyAction;
  switch (a.type) {
    case "twin.move": {
      const moved = a.setRef ? cardName(a.seat, a.setRef) : undefined;
      return `${a.name ?? moved ?? cardName(a.seat, a.cardRef) ?? "Card"} → ${zoneShort(a.zone, a.slot)}`;
    }
    case "twin.place": return `${a.card.name ?? cardName(a.seat, a.card.ref) ?? "Card"} placed → ${zoneShort(a.zone, a.card.slot)}`;
    case "twin.flip": return `${cardName(a.seat, a.cardRef) ?? "Card"} flipped ${a.faceUp ? "up" : "down"}`;
    case "twin.remove": return `${cardName(a.seat, a.cardRef) ?? "Card"} removed`;
    case "monsters.tribute": return `Tribute (${a.targets.length})`;
    case "pile.lift": return remoteUndoLabel(a);
    case "lp.change": return `${name(a.seat)} ${a.delta < 0 ? "−" : "+"}${Math.abs(a.delta)} LP`;
    case "phase.set": return PHASE_LONG[a.phase] ?? a.phase;
    case "chain.ok": return "OK";
    default: return null;
  }
}

const SENT_LABEL: Record<string, string> = { graveyard: "Sent to GY", banished: "Banished", hand: "Sent to hand", deck: "Sent to deck" };
/** A short text for the bottom-bar Undo chip when the action is a remove or a send; null for the rest (the caller keeps the longer log line). */
export function undoChipText(event: { action: unknown }): string | null {
  const a = event.action as AnyAction;
  if (a.type === "twin.remove") return "Undo · Removed";
  if (a.type === "twin.move" && SENT_LABEL[a.zone as string] && !a.setRef) return `Undo · ${SENT_LABEL[a.zone as string]}`;
  return null;
}

/**
 * The one place that knows how to go back a phase: phase.set to the earlier phase. The caller picks the target,
 * the previous phase from `previousYgoPhase(state)` or the earlier phase the player clicked.
 */
export function phaseBackAction(actorSeat: number, phase: string): RemoteAction {
  return { type: "phase.set", actorSeat, phase } as RemoteAction;
}

/**
 * My own recent actions, newest first, from the server's undo history (it already holds the rejection reason
 * for an action that cannot be undone now). A solo table plays every seat, so it shows all of them.
 */
export function ownUndoEntries(state: RemoteState, solo: boolean, mySeat: number): RemoteUndoEntry[] {
  return [...(state.undoHistory ?? [])].filter(entry => !entry.undone && (solo || entry.actorSeat === mySeat)).sort((a, b) => b.order - a.order);
}
