import type { RemoteAction, RemoteEvent, RemoteSystemAction } from "@yugidraft/shared/remote";
import { PHASE_LONG, sg } from "./model";

export type LogKind = "LP" | "PH" | "CD" | "AT" | "VX";
export type Described = { kind: LogKind; text: string; undoable: boolean };

/** One plain line per foundation event. `name` turns a seat number into a player name. */
export function describeEvent(event: RemoteEvent, name: (seat: number) => string, card: (id: number | undefined) => string | undefined): Described | null {
  const a = event.action as RemoteAction | RemoteSystemAction;
  const who = event.actorSeat === null ? "Table" : name(event.actorSeat);
  switch (a.type) {
    case "phase.set": return { kind: "PH", text: `${who} moved to ${PHASE_LONG[a.phase] ?? a.phase}`, undoable: true };
    case "phase.advance": return { kind: "PH", text: `${who} moved to the next phase`, undoable: true };
    case "turn.end": return { kind: "PH", text: `${who} passed the turn`, undoable: true };
    case "lp.change": return { kind: "LP", text: `${name(a.seat)} ${sg(a.delta)} LP`, undoable: true };
    case "attack.declare": return { kind: "AT", text: a.direct ? `${who} attacks ${name(a.targetSeat)} directly` : `${who} attacks ${name(a.targetSeat)}`, undoable: true };
    case "attack.resolve": return { kind: "AT", text: `Attack ${a.outcome === "cancelled" ? "cancelled" : "resolved"}`, undoable: true };
    case "card.identified": {
      const found = card(a.cardId ?? a.passcode) ?? a.name;
      return { kind: "CD", text: `${found ?? "A card"} identified on ${name(a.seat)}'s field`, undoable: true };
    }
    case "cards.identified": return { kind: "CD", text: `${a.cards.length} cards identified`, undoable: true };
    case "deck.add": return { kind: "CD", text: `${card(a.cardId) ?? "Card"} added to ${name(a.seat)}'s decklist`, undoable: true };
    case "deck.flag.dismiss": return { kind: "CD", text: "Deck warning dismissed", undoable: true };
    case "twin.place": return { kind: "CD", text: `${a.card.name ?? card(a.card.cardId ?? a.card.passcode) ?? "A card"} placed on ${name(a.seat)}'s field`, undoable: true };
    case "twin.move": return { kind: "CD", text: `A card on ${name(a.seat)}'s field moved to ${a.zone}`, undoable: true };
    case "twin.flip": return { kind: "CD", text: `A card on ${name(a.seat)}'s field turned ${a.faceUp ? "face up" : "face down"}`, undoable: true };
    case "twin.remove": return { kind: "CD", text: `A card was removed from ${name(a.seat)}'s field`, undoable: true };
    case "twin.merge": return { kind: "CD", text: "Duplicate cards merged", undoable: true };
    case "log.note": return { kind: "CD", text: a.text, undoable: true };
    case "player.concede": return { kind: "PH", text: `${who} conceded`, undoable: false };
    case "undo": return { kind: "PH", text: `${who} undid the last action`, undoable: false };
    case "table.started": return { kind: "PH", text: "The duel started", undoable: false };
    case "table.ended": return { kind: "PH", text: "The table closed", undoable: false };
    default: return null;
  }
}

/** Short label for the Undo button: what the action did. */
export function undoLabel(text: string) { return text.length > 44 ? text.slice(0, 43) + "…" : text; }
