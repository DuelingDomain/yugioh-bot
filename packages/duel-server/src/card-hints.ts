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
const faceDown = (position: number) => (position & OcgPosition.FACEDOWN) !== 0;

/** A card instance's descriptor counts. Coordinates point to the instance; passcodes never identify it. */
interface HintCard {
  descriptions: Map<bigint, number>;
}

/**
 * Ordered message-derived memory, shared by legacy, pinned, multiplayer and replay games.
 * Only field statuses are retained. A MOVE transfers the instance rather than copying a slot's hints;
 * departures/face-down resets discard it, so removal messages at a new location cannot strand old hints.
 * No queries or viewer-dependent reads mutate this memory.
 */
export class CardHints {
  private readonly field = new Map<string, HintCard>();
  private readonly displaced = new Map<string, HintCard>();
  private readonly removalSources = new Map<OcgMessage, string>();

  /** Rotation resets use the incoming card's NEW coordinates before its MOVE. */
  beginBatch(messages: readonly OcgMessage[]): void {
    this.displaced.clear();
    this.removalSources.clear();
    for (let index = 0; index < messages.length; index++) {
      const move = messages[index]!;
      if (move.type !== OcgMessageType.MOVE || !onField(move.from) || !onField(move.to)) continue;
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
        if (!onField(message) || message.overlay_sequence != null) return;
        const key = keyOf(message);
        if (message.card_hint === OcgCardHintType.DESC_ADD) {
          if (faceDown(message.position)) return;
          let card = this.field.get(key);
          if (!card) this.field.set(key, card = { descriptions: new Map() });
          card.descriptions.set(message.description, (card.descriptions.get(message.description) ?? 0) + 1);
        } else if (message.card_hint === OcgCardHintType.DESC_REMOVE) {
          const origin = this.removalSources.get(message);
          const descriptions = (origin == null ? this.field.get(key)
            : this.displaced.get(origin) ?? this.field.get(origin))?.descriptions;
          const count = descriptions?.get(message.description) ?? 0;
          if (count > 1) descriptions!.set(message.description, count - 1);
          else descriptions?.delete(message.description);
        }
        return;
      }
      case OcgMessageType.MOVE: {
        const from = keyOf(message.from), to = keyOf(message.to);
        const wasDisplaced = this.displaced.has(from);
        const card = this.displaced.get(from) ?? this.field.get(from);
        this.displaced.delete(from);
        const destination = this.field.get(to);
        if (from !== to && destination && destination !== card) this.displaced.set(to, destination);
        if (!wasDisplaced) this.field.delete(from);
        this.field.delete(to);
        if (card && onField(message.from) && onField(message.to) && !faceDown(message.to.position)) this.field.set(to, card);
        return;
      }
      case OcgMessageType.SWAP: {
        const firstKey = keyOf(message.card1), secondKey = keyOf(message.card2);
        const first = this.field.get(firstKey), second = this.field.get(secondKey);
        this.field.delete(firstKey);
        this.field.delete(secondKey);
        if (first && onField(message.card2) && !faceDown(message.card2.position)) this.field.set(secondKey, first);
        if (second && onField(message.card1) && !faceDown(message.card1.position)) this.field.set(firstKey, second);
        return;
      }
      case OcgMessageType.POS_CHANGE:
        if (faceDown(message.position)) this.field.delete(keyOf(message));
        return;
      case OcgMessageType.SET:
        this.field.delete(keyOf(message));
        return;
      case OcgMessageType.REMOVE_CARDS:
        for (const card of message.cards) this.field.delete(keyOf(card));
        return;
      case OcgMessageType.SHUFFLE_SET_CARD:
        for (const card of message.cards) {
          this.field.delete(keyOf(card.from));
          this.field.delete(keyOf(card.to));
        }
        return;
      case OcgMessageType.RELOAD_FIELD:
      case OcgMessageType.START:
        this.field.clear();
    }
  }

  /** Attach before projection returns; hidden or face-down cards carry no status metadata. */
  project(card: DuelCard, cards: CardDatabase): DuelCard {
    if (card.code == null || !onField(card) || (card.position & OcgPosition.FACEUP) === 0) return card;
    const descriptions = this.field.get(keyOf(card))?.descriptions;
    if (!descriptions?.size) return card;
    const hints: DuelCardHint[] = [...descriptions.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(description => {
      const text = cards.resolveLabel(description) || `Status (${description})`;
      return { descriptionId: description.toString(), text, categories: protectionCategories(text) };
    });
    return { ...card, hints };
  }
}
