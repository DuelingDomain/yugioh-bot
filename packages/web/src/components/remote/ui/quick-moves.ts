import type { RemoteActionProposal } from "@yugidraft/shared/remote";
import { cardCode, leavePosition, pileEntryFace, type TwinCard } from "./model";

/** One card move that both the board zone menu and the webcam card menu offer, in the order of how often players need it. */
export type QuickMove = { id: "activate" | "give" | "return" | "position" | "grave" | "banish" | "hand" | "remove"; label: string; run: () => void };

const FIELD = new Set(["monster", "extra-monster", "spell-trap", "pendulum", "field"]);
const SENDS: { id: "grave" | "banish" | "hand"; zone: string; label: string }[] = [
  { id: "grave", zone: "graveyard", label: "Send to GY" }, { id: "banish", zone: "banished", label: "Banish" }, { id: "hand", zone: "hand", label: "Return to hand" }];

/**
 * The important moves for a card on the field, from the existing remote actions only (no new rule):
 * activate the card (effect.activated; a Set card is turned face up first), give control (twin.control, picked on an opponent's field), return control, send to GY / banish / hand,
 * and remove for a given proxy. Who may do what follows the engine: the field's player, and the owner of a proxy on another field.
 * A webcam card shows only what the camera cannot show: the player turns a card to Defense or face down by hand, so those two moves
 * (`position`) are offered with `board` (the virtual board menu) and nowhere else.
 */
export function quickMoves({ card, seat, mySeat, solo, live, isLink, canGive, ownerAlive, board = false, act, give, giveBack, announce }: {
  card: TwinCard; seat: number; mySeat: number; solo: boolean; live: boolean; isLink: boolean; canGive: boolean; ownerAlive: boolean; /** The virtual board menu: also offers the battle position. */ board?: boolean;
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
  if (code && (solo || seat === mySeat)) moves.push({ id: "activate", label: "Activate effect", run: () => void (async () => {
    await act({ type: "effect.activated", actorSeat, source: { cardId: code, cardRef: card.ref } });
  })() });
  if (!proxy && seat === mySeat && canGive && ["monster", "extra-monster", "spell-trap"].includes(card.zone)) moves.push({ id: "give", label: "Give control", run: () => give(card) });
  // Return control asks for a Main Monster or Spell & Trap Zone, so a proxy in a Field or Pendulum Zone does not get it.
  if (proxy && ownerAlive && ["monster", "extra-monster", "spell-trap"].includes(card.zone)) moves.push({ id: "return", label: seat === mySeat ? "Return control" : "Take back", run: () => giveBack(seat, card) });
  if (board && card.faceUp !== false && (card.zone === "monster" || card.zone === "extra-monster") && (card.position === "defense" || !isLink))
    moves.push({ id: "position", label: card.position === "defense" ? "Change to Attack" : "Change to Defense",
      run: () => void act({ type: "twin.flip", actorSeat, seat, cardRef: card.ref, faceUp: true, position: card.position === "defense" ? "attack" : "defense" }) });
  for (const send of SENDS) moves.push({ id: send.id, label: send.label, run: () => { announce?.(seat, card.ref);
    void act({ type: "twin.move", actorSeat, seat, zone: send.zone, cardRef: card.ref, ...(pileEntryFace(card.zone, send.zone) !== undefined ? { faceUp: pileEntryFace(card.zone, send.zone) } : {}), ...leavePosition(card, send.zone) } as RemoteActionProposal); } });
  // A proxy is only a stand-in for a paper card the other player holds: its owner and the player whose field it is on may both delete it.
  if (proxy) moves.push({ id: "remove", label: "Remove proxy", run: () => void act({ type: "twin.remove", actorSeat, seat, cardRef: card.ref }) });
  return moves;
}
