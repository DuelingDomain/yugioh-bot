import type { DuelCard, DuelCardHint, DuelProtectionCategory, DuelZoneRef } from "@yugidraft/shared/duels";
import { OcgCardHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "./cards.js";

/** Classify the live hint, never the card's printed text (which may describe an inactive effect). */
export function protectionCategories(text: string): DuelProtectionCategory[] {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'");
  const categories = new Set<DuelProtectionCategory>();
  if (/unaffected|immune/.test(normalized)) {
    if (/monsters?/.test(normalized)) categories.add("unaffected-monsters");
    if (/spells?/.test(normalized)) categories.add("unaffected-spells");
    if (/traps?/.test(normalized)) categories.add("unaffected-traps");
    if (categories.size === 0) categories.add("unaffected-effects");
  }
  if (/cannot be|can't be/.test(normalized)) {
    if (/destroyed/.test(normalized)) {
      if (/battle/.test(normalized)) categories.add("cannot-be-destroyed-by-battle");
      if (/effects?/.test(normalized)) categories.add("cannot-be-destroyed-by-effects");
    }
    if (/targeted (?:for|by|with) (?:an? )?attacks?|attacked/.test(normalized)) categories.add("cannot-be-attacked");
    else if (/targeted/.test(normalized)) categories.add("cannot-be-targeted");
  }
  return categories.size ? [...categories] : ["status"];
}

const keyOf = (zone: DuelZoneRef) => `${zone.controller}:${zone.location}:${zone.sequence}`;
const onField = (zone: DuelZoneRef) => zone.location === OcgLocation.MZONE || zone.location === OcgLocation.SZONE;
const indexedPile = (location: number) => location === OcgLocation.HAND || location === OcgLocation.GRAVE
  || location === OcgLocation.REMOVED || location === OcgLocation.EXTRA;
const trackable = (zone: DuelZoneRef & { overlay_sequence?: number }) => zone.overlay_sequence == null
  && (onField(zone) || indexedPile(zone.location));

/** A card instance's descriptor counts. Coordinates point to the instance; passcodes never identify it. */
interface HintCard {
  position: number;
  descriptions: Map<bigint, number>;
}

/**
 * Ordered message-derived memory, shared by legacy, pinned, multiplayer and replay games.
 * Retain hidden/off-field descriptors internally; only projection decides visibility. The core's
 * DESC_REMOVE messages, rather than assumed reset flags, retire individual effects.
 * A MOVE transfers the instance rather than copying a slot's hints.
 * No queries or viewer-dependent reads mutate this memory.
 */
export class CardHints {
  private readonly cards = new Map<string, HintCard>();
  private readonly displaced = new Map<string, HintCard>();
  private readonly removalSources = new Map<OcgMessage, string>();

  /** Rotation resets use the incoming card's NEW coordinates before its MOVE. */
  beginBatch(messages: readonly OcgMessage[]): void {
    // A rotation can straddle process batches. Clearing displaced entries here strands the
    // original occupant and can later attach the incoming card's hints to its outgoing MOVE.
    this.removalSources.clear();
    for (let index = 0; index < messages.length; index++) {
      const move = messages[index]!;
      if (move.type !== OcgMessageType.MOVE || !trackable(move.from) || !trackable(move.to)) continue;
      if (keyOf(move.from) === keyOf(move.to)) continue;
      for (let previous = index - 1; previous >= 0; previous--) {
        const hint = messages[previous]!;
        if (hint.type !== OcgMessageType.CARD_HINT || hint.card_hint !== OcgCardHintType.DESC_REMOVE) break;
        if (keyOf(hint) === keyOf(move.to)) this.removalSources.set(hint, keyOf(move.from));
      }
    }
  }

  observe(message: OcgMessage): void {
    switch (message.type) {
      case OcgMessageType.CARD_HINT: {
        if (!trackable(message) || message.overlay_sequence != null) return;
        const key = keyOf(message);
        if (message.card_hint === OcgCardHintType.DESC_ADD) {
          let card = this.cards.get(key);
          if (!card) this.cards.set(key, card = { position: message.position, descriptions: new Map() });
          card.descriptions.set(message.description, (card.descriptions.get(message.description) ?? 0) + 1);
        } else if (message.card_hint === OcgCardHintType.DESC_REMOVE) {
          const origin = this.removalSources.get(message);
          const descriptions = (origin == null ? this.cards.get(key)
            : this.displaced.get(origin) ?? this.cards.get(origin))?.descriptions;
          const count = descriptions?.get(message.description) ?? 0;
          if (count > 1) descriptions!.set(message.description, count - 1);
          else descriptions?.delete(message.description);
        }
        return;
      }
      case OcgMessageType.MOVE: {
        const from = keyOf(message.from), to = keyOf(message.to);
        // Material locations share their host's field coordinates in the wrapper.
        // Detaching/attaching a material must never take or overwrite that host's memory.
        const source = trackable(message.from), target = trackable(message.to);
        const wasDisplaced = source && this.displaced.has(from);
        const card = source ? this.displaced.get(from) ?? this.cards.get(from) : undefined;
        if (source) {
          this.displaced.delete(from);
          if (!wasDisplaced) this.cards.delete(from);
        }
        if (from !== to) {
          if (source) this.shiftPile(message.from, message.from.sequence + 1, -1);
          if (target) this.shiftPile(message.to, message.to.sequence, 1);
        }
        if (target) {
          const destination = this.cards.get(to);
          if (from !== to && destination && destination !== card) this.displaced.set(to, destination);
          this.cards.delete(to);
          if (card) {
            card.position = message.to.position;
            this.cards.set(to, card);
          }
        }
        return;
      }
      case OcgMessageType.SWAP: {
        const firstKey = keyOf(message.card1), secondKey = keyOf(message.card2);
        const first = this.cards.get(firstKey), second = this.cards.get(secondKey);
        this.cards.delete(firstKey);
        this.cards.delete(secondKey);
        if (first && trackable(message.card2)) {
          first.position = message.card2.position;
          this.cards.set(secondKey, first);
        }
        if (second && trackable(message.card1)) {
          second.position = message.card1.position;
          this.cards.set(firstKey, second);
        }
        return;
      }
      case OcgMessageType.POS_CHANGE:
      case OcgMessageType.SET: {
        const card = trackable(message) ? this.cards.get(keyOf(message)) : undefined;
        if (card) card.position = message.position;
        return;
      }
      case OcgMessageType.REMOVE_CARDS:
        // All coordinates precede the whole removal. Compact each pile from the end.
        for (const card of [...message.cards].sort((a, b) => b.sequence - a.sequence)) {
          if (!trackable(card)) continue;
          const key = keyOf(card);
          if (!this.displaced.delete(key)) this.cards.delete(key);
          this.shiftPile(card, card.sequence + 1, -1);
        }
        return;
      case OcgMessageType.SHUFFLE_SET_CARD:
        for (const card of message.cards) {
          this.cards.delete(keyOf(card.from));
          this.cards.delete(keyOf(card.to));
          this.displaced.delete(keyOf(card.from));
          this.displaced.delete(keyOf(card.to));
        }
        return;
      // Anonymous reorders cannot be correlated by coordinates or passcode (identical
      // copies may have different effects). Forget these piles rather than misattribute hints.
      case OcgMessageType.SHUFFLE_HAND:
        this.clearPile(message.player, OcgLocation.HAND);
        return;
      case OcgMessageType.SHUFFLE_EXTRA:
        // Only the face-down prefix is shuffled. Face-up Pendulum cards stay in place.
        this.clearPile(message.player, OcgLocation.EXTRA, true);
        return;
      case OcgMessageType.SWAP_GRAVE_DECK:
        this.clearPile(message.player, OcgLocation.GRAVE);
        // Returned Fusion/Synchro/Xyz/Link cards insert before face-up Pendulum cards.
        this.clearPile(message.player, OcgLocation.EXTRA);
        return;
      case OcgMessageType.TAG_SWAP:
        this.clearPile(message.player, OcgLocation.HAND);
        this.clearPile(message.player, OcgLocation.EXTRA);
        return;
      case OcgMessageType.RELOAD_FIELD:
      case OcgMessageType.START:
        this.cards.clear();
        this.displaced.clear();
        this.removalSources.clear();
    }
  }

  private clearPile(controller: number, location: number, keepFaceUp = false): void {
    const prefix = `${controller}:${location}:`;
    for (const [key, card] of this.cards) {
      if (key.startsWith(prefix) && !(keepFaceUp && (card.position & OcgPosition.FACEUP) !== 0)) this.cards.delete(key);
    }
  }

  private shiftPile(zone: DuelZoneRef, start: number, delta: number): void {
    if (!indexedPile(zone.location)) return;
    const prefix = `${zone.controller}:${zone.location}:`;
    const moved = [...this.cards].filter(([key]) => key.startsWith(prefix) && Number(key.slice(prefix.length)) >= start);
    for (const [key] of moved) this.cards.delete(key);
    for (const [key, card] of moved) this.cards.set(`${prefix}${Number(key.slice(prefix.length)) + delta}`, card);
  }

  /** Attach before projection returns; hidden or face-down cards carry no status metadata. */
  project(card: DuelCard, cards: CardDatabase): DuelCard {
    if (card.code == null || !onField(card) || (card.position & OcgPosition.FACEUP) === 0) return card;
    const descriptions = this.cards.get(keyOf(card))?.descriptions;
    if (!descriptions?.size) return card;
    const hints: DuelCardHint[] = [...descriptions.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(description => {
      const text = cards.resolveLabel(description) || `Status (${description})`;
      return { descriptionId: description.toString(), text, categories: protectionCategories(text) };
    });
    return { ...card, hints };
  }
}
