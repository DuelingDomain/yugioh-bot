import type { RemoteActionProposal } from "@yugidraft/shared/remote";
import { cardCode, leavePosition, pileEntryFace, type TwinCard } from "./model";

/** One card move that both the board zone menu and the Tap-mode card popup offer, in the order of how often players need it. */
export type QuickMove = { id: "activate" | "give" | "return" | "set" | "position" | "grave" | "banish" | "hand" | "deck" | "remove"; label: string; run: () => void };

/** The short labels of the "Send to" row, the same in the zone menu and the card menu. */
export const SEND_LABELS: Partial<Record<QuickMove["id"], string>> = { grave: "GY", banish: "Banish", hand: "Hand", deck: "Deck" };

const FIELD = new Set(["monster", "extra-monster", "spell-trap", "pendulum", "field"]);
const SENDS = [
  { id: "grave", zone: "graveyard", label: "To GY" },
  { id: "banish", zone: "banished", label: "Banish" },
  { id: "hand", zone: "hand", label: "To hand" },
  { id: "deck", zone: "deck", label: "To deck" },
] as const;

/**
 * The important moves for a card on the field, from the existing remote actions only (no new rule):
 * activate the card (effect.activated; a Set card is turned face up first), give control (twin.control, picked on an opponent's field), return control, battle position, send to GY / banish / hand,
 * set (turn face down), and remove. The holder and the owner of a given proxy may edit it.
 */
export function quickMoves({ card, seat, mySeat, solo, live, isLink, canGive, ownerAlive, act, give, giveBack, announce }: {
  card: TwinCard; seat: number; mySeat: number; solo: boolean; live: boolean; isLink: boolean; canGive: boolean; ownerAlive: boolean;
  act: (action: RemoteActionProposal) => unknown; give: (card: TwinCard) => void; giveBack: (holder: number, card: TwinCard) => void;
  announce?: (seat: number, ref: string) => void;
}): QuickMove[] {
  if (!live || card.token || !FIELD.has(card.zone)) return [];
  const proxy = card.ownerSeat !== undefined;
  const edit = solo || seat === mySeat || card.ownerSeat === mySeat;
  if (!edit) return [];
  const actorSeat = solo ? seat : mySeat;
  const moves: QuickMove[] = [];
  // The same signal as the E key and the card dialog's Activate, so the chain shows "<card> activated". The server turns a Set card face up in the same action.
  const code = cardCode(card);
  if (code && (solo || seat === mySeat)) moves.push({ id: "activate", label: card.faceUp === false ? "Flip and activate" : "Activate effect", run: () => void (async () => {
    await act({ type: "effect.activated", actorSeat, source: { cardId: code, cardRef: card.ref } });
  })() });
  if (!proxy && seat === mySeat && canGive && ["monster", "extra-monster", "spell-trap"].includes(card.zone)) moves.push({ id: "give", label: "Give control to opponent", run: () => give(card) });
  // Return control asks for a Main Monster or Spell & Trap Zone, so a proxy in a Field or Pendulum Zone does not get it.
  if (proxy && ownerAlive && ["monster", "extra-monster", "spell-trap"].includes(card.zone)) moves.push({ id: "return", label: seat === mySeat ? "Return control" : "Take back", run: () => giveBack(seat, card) });
  if (card.faceUp !== false && (card.zone === "monster" || card.zone === "extra-monster") && (card.position === "defense" || !isLink))
    moves.push({ id: "position", label: card.position === "defense" ? "Change to Attack" : "Change to Defense",
      run: () => void act({ type: "twin.flip", actorSeat, seat, cardRef: card.ref, faceUp: true, position: card.position === "defense" ? "attack" : "defense" }) });
  if (card.faceUp !== false && !proxy && ["monster", "spell-trap"].includes(card.zone))
    moves.push({ id: "set", label: "Set (face down)", run: () => void act({ type: "twin.flip", actorSeat, seat, cardRef: card.ref, faceUp: false, ...(card.zone === "monster" ? { position: "defense" as const } : {}) }) });
  for (const send of SENDS) moves.push({ id: send.id, label: send.label, run: () => {
    announce?.(seat, card.ref);
    const faceUp = send.zone === "deck" ? false : pileEntryFace(card.zone, send.zone);
    void act({ type: "twin.move", actorSeat, seat, zone: send.zone, cardRef: card.ref, ...(faceUp !== undefined ? { faceUp } : {}), ...leavePosition(card, send.zone) });
  } });
  moves.push({ id: "remove", label: proxy ? "Remove proxy" : "Remove", run: () => void act({ type: "twin.remove", actorSeat, seat, cardRef: card.ref }) });
  return moves;
}
