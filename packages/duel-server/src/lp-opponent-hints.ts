import type { DuelCard, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { OcgCardHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";

const key = (zone: DuelZoneRef) => `${zone.controller}:${zone.location}:${zone.sequence}`;
const inList = (zone: DuelZoneRef) => (zone.location & (OcgLocation.DECK | OcgLocation.HAND | OcgLocation.GRAVE | OcgLocation.REMOVED | OcgLocation.EXTRA)) !== 0;
const at = (a: DuelZoneRef, b: DuelZoneRef) => a.controller === b.controller && a.location === b.location;
const onField = (zone: DuelZoneRef) => zone.location === OcgLocation.MZONE || zone.location === OcgLocation.SZONE;

/** Public card hints emitted by aux.MPLPOpponentHint; other engine hints remain untouched. */
export class LpOpponentHints {
  private readonly seats = new Map<string, number>();

  observe(message: OcgMessage): void {
    if (message.type === OcgMessageType.CARD_HINT) {
      const seat = Number(message.description - 0xfffd0000n);
      if (!Number.isInteger(seat) || seat < 0 || seat > 3) return;
      if (message.card_hint === OcgCardHintType.DESC_ADD) this.seats.set(key(message), seat);
      if (message.card_hint === OcgCardHintType.DESC_REMOVE && this.seats.get(key(message)) === seat) this.seats.delete(key(message));
    } else if (message.type === OcgMessageType.MOVE) {
      const { from, to } = message;
      // Overlay moves use the host's coordinates; detaching is not a move of the host.
      this.remap(zone => {
        if (from.overlay_sequence == null && key(zone) === key(from)) {
          return onField(from) && onField(to) && to.overlay_sequence == null ? to : null;
        }
        let sequence = zone.sequence;
        if (from.overlay_sequence == null && inList(from) && at(zone, from) && sequence > from.sequence) sequence -= 1;
        if (to.overlay_sequence == null && inList(to) && at(zone, to) && sequence >= to.sequence) sequence += 1;
        return { ...zone, sequence };
      });
    } else if (message.type === OcgMessageType.REMOVE_CARDS) {
      // All source coordinates describe the list before any of these removals.
      const removed = message.cards.filter(card => card.overlay_sequence == null);
      this.remap(zone => removed.some(card => key(card) === key(zone)) ? null : {
        ...zone, sequence: zone.sequence - removed.filter(card => inList(card) && at(zone, card) && card.sequence < zone.sequence).length,
      });
    } else if (message.type === OcgMessageType.SWAP) {
      this.remap(zone => key(zone) === key(message.card1) ? message.card2 : key(zone) === key(message.card2) ? message.card1 : zone);
    } else if (message.type === OcgMessageType.SHUFFLE_SET_CARD) {
      // The hidden order is deliberately omitted by the core. Forget it; the Lua
      // helper re-emits the correct card's hint when that card becomes face-up.
      this.remap(zone => message.cards.some(card => key(card.from) === key(zone)) ? null : zone);
    } else if (message.type === OcgMessageType.SWAP_GRAVE_DECK) {
      this.remap(zone => zone.controller === message.player && (zone.location === OcgLocation.DECK || zone.location === OcgLocation.GRAVE || zone.location === OcgLocation.EXTRA) ? null : zone);
    }
    // RELOAD_FIELD is a snapshot, not a flag reset. Keep the tracked labels:
    // unchanged Lua flags emit no new DESC_ADD, and the stock snapshot decoder
    // only exposes two seats. Moves, removals and flag resets remain authoritative.
  }

  private remap(transform: (zone: DuelZoneRef) => DuelZoneRef | null): void {
    const moved = [...this.seats].map(([slot, seat]) => {
      const [controller, location, sequence] = slot.split(":").map(Number);
      return { zone: transform({ controller, location, sequence }), seat };
    });
    this.seats.clear();
    for (const { zone, seat } of moved) if (zone) this.seats.set(key(zone), seat);
  }

  project(card: DuelCard | null, seats: readonly DuelSeatView[]): void {
    if (!card?.code || (card.position & OcgPosition.FACEUP) === 0) return;
    let seat = this.seats.get(key(card));
    if (seat == null) return;
    // Match MPGetLP/is_alive: a pending loss still has usable LP until the
    // core eliminates that seat. Every LP hint uses the same living fallback.
    if (seat === card.controller || !seats[seat] || seats[seat].eliminated) {
      seat = seats.filter(other => other.seat !== card.controller && !other.eliminated)
        .sort((a, b) => b.lp - a.lp || a.seat - b.seat)[0]?.seat;
    }
    if (seat != null) card.lpOpponent = seat;
  }
}
