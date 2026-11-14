import type { RemoteAction, RemoteEvent, RemoteSystemAction } from "@yugidraft/shared/remote";
import { PHASE_LONG, sg } from "./model";
import { landingLabel } from "./placement";
import { MERGED } from "./twins";

export type LogKind = "LP" | "PH" | "CD" | "AT" | "VX";
export type Described = { kind: LogKind; text: string; undoable: boolean };

/** One plain line per foundation event. `name` turns a seat number into a player name. */
export function describeEvent(event: RemoteEvent, name: (seat: number) => string, card: (id: number | undefined) => string | undefined, refName: (seat: number, ref: string) => string | undefined = () => undefined): Described | null {
  const a = event.action as RemoteAction | RemoteSystemAction;
  const who = event.actorSeat === null ? "Table" : name(event.actorSeat);
  switch (a.type) {
    case "effect.activated": return {kind:"CD",text:`${who} activated ${a.source.name ?? card(a.source.cardId) ?? "a card effect"}${a.fromHand ? " from hand" : ""}`,undoable:true};
    case "effect.choose": return {kind:"CD",text:event.messages?.join("; ") ?? "Updated a private card choice",undoable:true};
    case "effect.announce": return {kind:"CD",text:`${who} announced a searched card`,undoable:true};
    case "effect.note.dismiss": return {kind:"CD",text:"Effect note dismissed",undoable:true};
    case "effect.context.clear": return {kind:"CD",text:"Effect context cleared",undoable:true};
    case "phase.set": return { kind: "PH", text: `${who} moved to ${PHASE_LONG[a.phase] ?? a.phase}${a.cam?.ui === "voice" ? " · voice" : ""}`, undoable: true };
    case "phase.advance": return { kind: "PH", text: `${who} moved to the next phase`, undoable: true };
    case "turn.end": return { kind: "PH", text: `${who} passed the turn${a.cam?.ui === "voice" ? " · voice" : ""}`, undoable: true };
    case "lp.change": return { kind: "LP", text: `${name(a.seat)} ${sg(a.delta)} LP`, undoable: true };
    case "attack.declare": return { kind: "AT", text: a.direct ? `${who} attacks ${name(a.targetSeat)} directly` : `${who} attacks ${name(a.targetSeat)}`, undoable: true };
    case "attack.resolve": return { kind: "AT", text: `Attack ${a.outcome === "cancelled" ? "cancelled" : "resolved"}`, undoable: true };
    case "card.identified": {
      const found = card(a.cardId ?? a.passcode) ?? a.name;
      return { kind: "CD", text: `${found ?? "A card"} identified on ${name(a.seat)}'s field${a.source === "auto" ? " · auto" : ""}`, undoable: true };
    }
    case "cards.identified": return { kind: "CD", text: `${a.cards.length} cards identified`, undoable: true };
    case "deck.add": return { kind: "CD", text: `${card(a.cardId) ?? "Card"} added to ${name(a.seat)}'s decklist`, undoable: true };
    case "deck.flag.dismiss": return { kind: "CD", text: "Deck warning dismissed", undoable: true };
    case "twin.place": return { kind: "CD", text: a.summon ? summonLine(a.summon.kind, a.card.name ?? card(a.card.cardId ?? a.card.passcode) ?? refName(a.seat, a.card.ref) ?? "a card", a.seat, a.summon.materialRefs, refName) : a.zoneRule ? `${a.card.name ?? card(a.card.cardId ?? a.card.passcode) ?? "A card"}: ${a.zoneRule}${a.source === 'auto' ? ' · auto' : ''}` : `${a.card.name ?? card(a.card.cardId ?? a.card.passcode) ?? "A card"} placed on ${name(a.seat)}'s field${a.source === 'auto' ? ' · auto' : ''}`, undoable: true };
    case "twin.move": return { kind: "CD", text: a.zoneRule?`${a.name??'A card'}: ${a.zoneRule}${a.source==='auto'?' · auto':''}`:a.source==='auto'&&a.zone==='deck'?`${a.name??'A card'} returned to Deck · auto`:a.source==='auto'&&['graveyard','banished','hand','extra'].includes(a.zone)?`${a.name??'A card'} left the field → ${{graveyard:'GY',banished:'banish',hand:'hand',extra:'Extra Deck'}[a.zone]} · auto`:`${a.name ?? "A card"} on ${name(a.seat)}'s field moved to ${landingLabel({ zone: a.zone, slot: a.slot })}${a.faceUp === false ? " face-down" : ""}${a.position === "defense" ? " in defense" : ""}`, undoable: true };
    case "twin.attach": return { kind: "CD", text: summonLine(a.kind, refName(a.seat, a.cardRef) ?? "a card", a.seat, a.materialRefs, refName), undoable: true };
    case "twin.detach": return { kind: "CD", text: `${who} detached a material from ${refName(a.seat, a.cardRef) ?? "a card"}`, undoable: true };
    case "pile.order": return { kind: "CD", text: `${a.zone === "graveyard" ? "Graveyard" : "Banished"} order changed`, undoable: true };
    case "twin.flip": return { kind: "CD", text: a.faceUp && a.position && a.source !== "auto" ? `A card on ${name(a.seat)}'s field changed to ${a.position} position` : `A card on ${name(a.seat)}'s field turned ${a.faceUp ? "face up" : "face down"}`, undoable: true };
    case "twin.remove": return { kind: "CD", text: `A card was removed from ${name(a.seat)}'s field`, undoable: true };
    case "twin.equip": return { kind: "CD", text: a.target ? `An Equip Card on ${name(a.seat)}'s field is linked to ${name(a.target.seat)}'s monster` : `An Equip link on ${name(a.seat)}'s field was cleared`, undoable: true };
    case "twin.control": return { kind: "CD", text: `${refName(a.seat, a.cardRef) ?? "A card"} changed control: ${name(a.seat)} to ${name(a.toSeat)}`, undoable: true };
    case "pile.lift": return { kind: "CD", text: `${a.zone === "graveyard" ? "Graveyard" : "Banished"} picked up (${a.cardRefs.length} card${a.cardRefs.length === 1 ? "" : "s"}) · auto`, undoable: true };
    case "twin.merge": return { kind: "CD", text: a.reason.startsWith(MERGED) ? `${a.reason} on ${name(a.seat)}'s field` : "Duplicate cards merged", undoable: true };
    case "log.note": return { kind: "CD", text: a.text, undoable: false };
    case "player.concede": return { kind: "PH", text: `${who} conceded`, undoable: false };
    case "player.leave": return { kind: "PH", text: `${who} left the match`, undoable: false };
    case "undo": return { kind: "PH", text: `${who} undid the last action`, undoable: false };
    case "admin.watching": return { kind: "PH", text: a.watching ? `Admin ${a.name} started watching` : `Admin ${a.name} stopped watching`, undoable: false };
    case "table.started": {
      const opening = a.opening;
      if (!opening) return { kind: "PH", text: "The duel started", undoable: false };
      const last = opening.rounds[opening.rounds.length - 1] ?? [];
      const rolls = last.map((roll, seat) => `${name(seat)} ${roll}`).join(", ");
      return { kind: "PH", text: `Die roll${opening.rounds.length > 1 ? ` (${opening.rounds.length} rounds)` : ""}: ${rolls} · ${name(opening.winnerSeat)} chooses who goes first`, undoable: false };
    }
    case "match.first": return { kind: "PH", text: a.seatGoesFirst === a.actorSeat ? `${who} chose to go first` : `${who} chose that ${name(a.seatGoesFirst)} goes first`, undoable: false };
    case "table.ended": return { kind: "PH", text: "The table closed", undoable: false };
    default: return null;
  }
}

const SUMMON_NAME = { xyz: "Xyz", synchro: "Synchro", link: "Link", fusion: "Fusion" } as const;
/** "Xyz Summon: X (2 materials)" or, for the others, "Synchro Summon: X + Y → Z (materials to GY)". */
function summonLine(kind: keyof typeof SUMMON_NAME, top: string, seat: number, materialRefs: readonly string[], refName: (seat: number, ref: string) => string | undefined) {
  const label = `${SUMMON_NAME[kind]} Summon`;
  if (kind === "xyz") return `${label}: ${top} (${materialRefs.length} material${materialRefs.length === 1 ? "" : "s"})`;
  return `${label}: ${materialRefs.map(ref => refName(seat, ref) ?? "a card").join(" + ")} → ${top} (materials to GY)`;
}

/** Short label for the Undo button: what the action did. */
export function undoLabel(text: string) { return text.length > 44 ? text.slice(0, 43) + "…" : text; }
