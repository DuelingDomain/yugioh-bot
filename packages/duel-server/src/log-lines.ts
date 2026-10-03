import type { DuelSummonKind } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "./cards.js";

/**
 * Text log lines for summons and card moves. Pure: engine.ts appends what these return.
 *
 * Privacy: a line goes to everyone ("all") only when it names nothing the table cannot already see. A card's
 * name is public when it lands face-up (a face-up summon, the Graveyard, a face-up banish) or when it leaves a
 * public place (the Graveyard, face-up on the field, face-up in the banished pile or Extra Deck). Otherwise
 * the public line names no card, and the one seat allowed to see it (the hand it joined) gets a second line.
 */
export interface LogLine {
  text: string;
  audience: "all" | number;
  /**
   * A card publicly left the field for the Graveyard, banishment, Deck or Extra Deck, so it may have been
   * destroyed. The startup script's destruction note can arrive after the MOVE, so the engine keeps this
   * line and rewrites it if a destroy event for that zone follows before the next prompt (before any view
   * is built).
   */
  leftField?: true;
}

type SummonMessage = Extract<OcgMessage, { type: OcgMessageType.SUMMONING | OcgMessageType.SPSUMMONING | OcgMessageType.FLIPSUMMONING }>;
type MoveMessage = Extract<OcgMessage, { type: OcgMessageType.MOVE }>;

const SUMMON_VERB: Record<DuelSummonKind, string> = {
  normal: "Normal Summons",
  tribute: "Tribute Summons",
  special: "Special Summons",
  flip: "Flip Summons",
  fusion: "Fusion Summons",
  synchro: "Synchro Summons",
  xyz: "Xyz Summons",
  link: "Link Summons",
  ritual: "Ritual Summons",
  pendulum: "Pendulum Summons",
};

function isFaceDown(position: number): boolean {
  return (position & OcgPosition.FACEDOWN) !== 0;
}

function nameOf(cards: CardDatabase, code: number): string {
  return cards.get(code)?.name ?? `Card ${code}`;
}

/**
 * The summon line. A face-up summon names its method (Tribute, Fusion, Synchro, Xyz, Link, Ritual, Pendulum):
 * how a face-up monster arrived is public. A face-down summon names neither the card nor the method: everyone
 * gets "a face-down monster", and only its controller gets the name, with the plain verb.
 */
export function summonLogLines(message: SummonMessage, cards: CardDatabase, summonKind: DuelSummonKind | undefined): LogLine[] {
  const player = `Player ${message.controller + 1}`;
  const plain = message.type === OcgMessageType.SUMMONING ? "Normal Summons"
    : message.type === OcgMessageType.SPSUMMONING ? "Special Summons" : "Flip Summons";
  const name = nameOf(cards, message.code);
  if (isFaceDown(message.position)) {
    return [
      { text: `${player} ${plain} a face-down monster`, audience: "all" },
      { text: `${player} ${plain} ${name}`, audience: message.controller },
    ];
  }
  const verb = summonKind ? SUMMON_VERB[summonKind] : plain;
  return [{ text: `${player} ${verb} ${name}`, audience: "all" }];
}

const FIELD = new Set<number>([OcgLocation.MZONE, OcgLocation.SZONE]);
/** Places a face-up card can leave from with its name known to the table. */
const FACE_UP_PUBLIC = new Set<number>([OcgLocation.MZONE, OcgLocation.SZONE, OcgLocation.REMOVED, OcgLocation.EXTRA]);

/** Domain's Deck Master Zone: the core reports it as location 0 (views.ts LOCATION_DECKMASTER is 0x4000). */
function fromDeckMaster(location: number): boolean {
  return location === 0 || location === 0x4000;
}

function leavesPublicly(from: MoveMessage["from"]): boolean {
  if (from.location === OcgLocation.GRAVE || fromDeckMaster(from.location)) return true;
  return FACE_UP_PUBLIC.has(from.location) && !isFaceDown(from.position);
}

/** The text a leftField line becomes when the card turns out to have been destroyed. Public, like the line. */
export function destroyedLogText(cards: CardDatabase, code: number): string {
  return `${nameOf(cards, code)} was destroyed`;
}

/** Destruction whose destination was redirected to face-up banishment. */
export function destroyedAndBanishedLogText(cards: CardDatabase, code: number): string {
  return `${nameOf(cards, code)} was destroyed and banished`;
}

/**
 * Lines for a card that changed place. Field arrivals have their own summon/Set/activation lines, and moves
 * inside one place (shuffles, zone swaps) say nothing.
 *   Graveyard            "X was sent to the Graveyard" (always public). From the field it may later become
 *                        "X was destroyed" (see LogLine.leftField). A card sent from the hand is not called
 *                        discarded: Ritual and Fusion materials leave the hand the same way.
 *   banished face-up     "X was banished", or "X was destroyed and banished" when a destruction is reported
 *                        (face-down: nothing)
 *   hand                 public source: "X returned to Player N's hand" (from the field) or
 *                        "X was added to Player N's hand"; hidden source: a nameless public line, the name to
 *                        that hand's owner only
 *   Deck / Extra Deck    public source: "X returned to the Deck" / "the Extra Deck" (a destroyed Pendulum
 *                        Monster's line may become "X was destroyed"); hidden source: nothing
 * Tributes and materials are only known once the summon that used them arrives, so they read as Graveyard sends.
 */
export function moveLogLines(message: MoveMessage, cards: CardDatabase): LogLine[] {
  const { from, to } = message;
  if (!to.location) return [];
  if (from.controller === to.controller && from.location === to.location) return [];
  const name = () => nameOf(cards, message.card);
  const fromField = FIELD.has(from.location);
  switch (to.location) {
    case OcgLocation.GRAVE: {
      const line: LogLine = { text: `${name()} was sent to the Graveyard`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    case OcgLocation.REMOVED: {
      if (isFaceDown(to.position)) return [];
      const line: LogLine = { text: `${name()} was banished`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    case OcgLocation.HAND: {
      if (from.location === OcgLocation.HAND) return [];
      const owner = to.controller;
      const hand = `Player ${owner + 1}'s hand`;
      if (leavesPublicly(from)) {
        return [{ text: fromField ? `${name()} returned to ${hand}` : `${name()} was added to ${hand}`, audience: "all" }];
      }
      if (!message.card) return [{ text: fromField ? `A face-down card returned to ${hand}` : `Player ${owner + 1} added a card to their hand`, audience: "all" }];
      return fromField
        ? [
            { text: `A face-down card returned to ${hand}`, audience: "all" },
            { text: `${name()} returned to your hand`, audience: owner },
          ]
        : [
            { text: `Player ${owner + 1} added a card to their hand`, audience: "all" },
            { text: `You added ${name()} to your hand`, audience: owner },
          ];
    }
    case OcgLocation.DECK:
    case OcgLocation.EXTRA: {
      if (!leavesPublicly(from)) return [];
      const line: LogLine = { text: `${name()} returned to the ${to.location === OcgLocation.DECK ? "Deck" : "Extra Deck"}`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    default:
      return [];
  }
}
