import { partnerSeatOf, seatCountFor, type DuelFormat, type DuelSummonKind, type DuelZoneRef } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, OcgQueryFlags, type OcgCoreSync, type OcgDuelHandle, type OcgMessage, type OcgQueryFlags as OcgQueryFlagsValue } from "ocgcore-wasm";
import type { CardDatabase } from "./cards.js";
import { cardIsVisible, isNoDuelist, playerLabel, slotRevealed, type RevealMap, type StoredDuelEvent } from "./views.js";
import { fillPlaceholders, hasPlaceholders } from "./text.js";
import type { TargetVisibility } from "./target-names.js";

/**
 * Text log lines for hints, summons and card moves. Hint visibility is read once and frozen in the line;
 * summon and move formatting is pure. engine.ts appends what these return.
 *
 * Privacy: a line goes to everyone ("all") only when it names nothing the table cannot already see. A card's
 * name is public when it lands face-up (a face-up summon, the Graveyard, a face-up banish) or when it leaves a
 * public place (the Graveyard, face-up on the field, face-up in the banished pile or Extra Deck). Otherwise
 * the public line names no card, and the one seat allowed to see it (the hand it joined) gets a second line.
 */
export interface LogLine {
  text: string;
  audience: "all" | number;
  /** Viewer-specific names, frozen when the line is written. `text` is safe for spectators. */
  privateText?: Record<number, string>;
  /**
   * A card publicly left the field for the Graveyard, banishment, Deck or Extra Deck, so it may have been
   * destroyed. Xyz materials are excluded even though their parsed location is the host's field zone.
   * The startup script's destruction note can arrive after the MOVE, so the engine keeps this
   * line and rewrites it if a destroy event for that zone follows before the next prompt (before any view
   * is built).
   */
  leftField?: true;
}

const TARGET_QUERY_LOCATIONS: ReadonlySet<number> = new Set([
  OcgLocation.DECK, OcgLocation.HAND, OcgLocation.MZONE, OcgLocation.SZONE,
  OcgLocation.GRAVE, OcgLocation.REMOVED, OcgLocation.EXTRA,
]);

/** Raw queries only: viewer-scoped confirmations can still change between messages in a process batch. */
export type TargetQueryCache = Map<string, ReturnType<OcgCoreSync["duelQueryLocation"]>>;

interface LogQueryContext {
  lib: OcgCoreSync;
  handle: OcgDuelHandle;
  /** Clear before every core process or other core mutation. */
  queryCache?: TargetQueryCache;
}

function queryLogLocation(args: LogQueryContext, controller: number, location: number): ReturnType<OcgCoreSync["duelQueryLocation"]> {
  const key = `${controller}:${location}`;
  let queries = args.queryCache?.get(key);
  if (!queries) {
    queries = args.lib.duelQueryLocation(args.handle, {
      controller: controller as 0 | 1, location: location as OcgLocation,
      flags: (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.IS_PUBLIC | OcgQueryFlags.IS_HIDDEN) as OcgQueryFlagsValue,
    });
    args.queryCache?.set(key, queries);
  }
  return queries;
}

/** Freeze the independently visible code at the target's slot before a delayed Lua note can name it. */
export function visibleTargetCardCodes(args: LogQueryContext & {
  format: DuelFormat;
  reveals: RevealMap;
}, zone: DuelZoneRef): TargetVisibility {
  const visible = new Map<number | null, number>();
  if (zone.controller < 0 || zone.controller >= seatCountFor(args.format)) return visible;
  // Overlay coordinates and Domain's serialized location 0 are not ordinary queryable card slots.
  if (!TARGET_QUERY_LOCATIONS.has(zone.location)) return visible;
  const queries = queryLogLocation(args, zone.controller, zone.location);
  const query = queries[zone.sequence];
  if (!query?.code) return visible;
  const viewers = [...Array.from({ length: seatCountFor(args.format) }, (_, seat) => seat), null];
  for (const viewer of viewers) {
    if (cardIsVisible({
      viewer, controller: zone.controller, location: zone.location,
      position: query.position || OcgPosition.FACEDOWN_DEFENSE,
      isPublic: query.isPublic, isHidden: query.isHidden,
      revealed: slotRevealed(args.reveals, viewer, zone.controller, zone.location, zone.sequence, query.code),
      partner: viewer != null && partnerSeatOf(args.format, viewer) === zone.controller,
    })) visible.set(viewer, query.code);
  }
  return visible;
}

export interface HintVisibility {
  viewers: readonly (number | null)[];
  isKnown(viewer: number | null, code: number): boolean;
}

/** Incremental event-ring identities; live visibility is queried only for a requested code/viewer. */
export function createLogCardVisibility(args: LogQueryContext & {
  format: DuelFormat;
  reveals: RevealMap;
  deckMasters: readonly number[];
}): HintVisibility & { addEvent(event: StoredDuelEvent): void; removeEvent(event: StoredDuelEvent): void } {
  const viewers = [...Array.from({ length: seatCountFor(args.format) }, (_, seat) => seat), null];
  const deckMasters = new Set(args.deckMasters);
  const known = new Map(viewers.map((viewer) => [viewer, new Map<number, number>()]));
  const updateEvent = (event: StoredDuelEvent, delta: number) => {
    if (!event.card) return;
    const audience = event.revealCardTo;
    for (const [viewer, codes] of known) {
      if (audience !== "all" && (viewer == null || !(typeof audience === "number" ? audience === viewer : audience.includes(viewer)))) continue;
      const count = (codes.get(event.card.code) ?? 0) + delta;
      if (count > 0) codes.set(event.card.code, count);
      else codes.delete(event.card.code);
    }
  };
  return {
    viewers,
    addEvent: (event) => updateEvent(event, 1),
    removeEvent: (event) => updateEvent(event, -1),
    isKnown(viewer, code) {
      if (deckMasters.has(code) || known.get(viewer)?.has(code)) return true;
      for (let controller = 0; controller < seatCountFor(args.format); controller++) {
        for (const location of TARGET_QUERY_LOCATIONS) {
          const queries = queryLogLocation(args, controller, location);
          for (let sequence = 0; sequence < queries.length; sequence++) {
            const query = queries[sequence];
            if (query?.code !== code) continue;
            if (cardIsVisible({
              viewer, controller, location, position: query.position || OcgPosition.FACEDOWN_DEFENSE,
              isPublic: query.isPublic, isHidden: query.isHidden,
              revealed: slotRevealed(args.reveals, viewer, controller, location, sequence, code),
              partner: viewer != null && partnerSeatOf(args.format, viewer) === controller,
            })) return true;
          }
        }
      }
      return false;
    },
  };
}

/** Hints may resolve to a literal card name, a card-string fallback, or a template with HINT_CARD. */
export function hintLogLine(
  hint: bigint,
  hintCard: number | undefined,
  cards: CardDatabase,
  visibility: HintVisibility,
): LogLine | undefined {
  const template = cards.resolveLabel(hint) || cards.system(Number(hint)) || "";
  if (!template) return undefined;
  const direct = hint > 0n && hint <= 0xffffffffn ? Number(hint) : undefined;
  const source = direct != null && cards.get(direct) ? direct : Number(hint >> 20n);
  const names = new Map<number, string>();
  for (const code of [source, hintCard]) {
    if (!code || names.has(code)) continue;
    const name = cards.get(code)?.name;
    if (name) names.set(code, name);
  }
  const hintName = hintCard ? names.get(hintCard) : undefined;
  const placeholders = hasPlaceholders(template.replaceAll("%%", "\u0000"));
  const needsVisibility = [...names.values()].some((name) => template.includes(name)) || (placeholders && !!hintName);
  // Still normalize whitespace and escaped percent signs exactly as the full renderer does.
  if (!needsVisibility) return { text: fillPlaceholders(template, ["a card"]), audience: "all" };
  const render = (viewer: number | null) => {
    const known = new Map<number, boolean>();
    const isKnown = (code: number) => {
      if (!known.has(code)) known.set(code, visibility.isKnown(viewer, code));
      return known.get(code)!;
    };
    let text = template;
    for (const [code, name] of names) {
      if (text.includes(name) && !isKnown(code)) text = text.replaceAll(name, "a card");
    }
    const name = hintCard && hintName && hasPlaceholders(text.replaceAll("%%", "\u0000")) && isKnown(hintCard) ? hintName : undefined;
    return fillPlaceholders(text, [name ?? "a card"]);
  };
  const text = render(null);
  const privateText: Record<number, string> = {};
  for (const viewer of visibility.viewers) {
    if (viewer == null) continue;
    const named = render(viewer);
    if (named !== text) privateText[viewer] = named;
  }
  return { text, audience: "all", ...(Object.keys(privateText).length ? { privateText } : {}) };
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

function isFaceUp(position: number): boolean {
  return (position & OcgPosition.FACEUP) !== 0 && !isFaceDown(position);
}

function nameOf(cards: CardDatabase, code: number): string {
  return cards.get(code)?.name ?? `Card ${code}`;
}

/**
 * The summon line. A face-up summon names its method (Tribute, Fusion, Synchro, Xyz, Link, Ritual, Pendulum):
 * how a face-up monster arrived is public. A face-down summon names neither the card nor the method: everyone
 * gets "a face-down monster", and only its controller gets the name, with the plain verb.
 */
export function summonLogLines(message: SummonMessage, cards: CardDatabase, summonKind: DuelSummonKind | undefined, format?: DuelFormat): LogLine[] {
  const player = playerLabel(format, message.controller);
  const plain = message.type === OcgMessageType.SUMMONING ? "Normal Summons"
    : message.type === OcgMessageType.SPSUMMONING ? "Special Summons" : "Flip Summons";
  const name = nameOf(cards, message.code);
  if (!isFaceUp(message.position)) {
    const monster = isFaceDown(message.position) ? "a face-down monster" : "a monster";
    const lines: LogLine[] = [{ text: `${player} ${plain} ${monster}`, audience: "all" }];
    // Nobody owns a monster of "no duelist"; no seat may see its name.
    if (!isNoDuelist(format, message.controller)) lines.push({ text: `${player} ${plain} ${name}`, audience: message.controller });
    return lines;
  }
  const verb = summonKind ? SUMMON_VERB[summonKind] : plain;
  return [{ text: `${player} ${verb} ${name}`, audience: "all" }];
}

const FIELD = new Set<number>([OcgLocation.MZONE, OcgLocation.SZONE]);
/** Places a face-up card can leave from with its name known to the table. */
const FACE_UP_PUBLIC = new Set<number>([OcgLocation.MZONE, OcgLocation.SZONE, OcgLocation.REMOVED, OcgLocation.EXTRA]);

/** Domain's Deck Master Zone: the core reports it as location 0 (views.ts LOCATION_DECKMASTER is 0x4000). */
function fromDeckMaster(location: number, code: number, deckMasters: readonly number[]): boolean {
  // Location 0 also describes an unplaced card. Only a configured Deck Master makes it public.
  return location === 0x4000 || (location === 0 && deckMasters.includes(code));
}

function leavesPublicly(from: MoveMessage["from"], code: number, deckMasters: readonly number[]): boolean {
  if (from.location === OcgLocation.GRAVE || fromDeckMaster(from.location, code, deckMasters)) return true;
  return FACE_UP_PUBLIC.has(from.location) && isFaceUp(from.position);
}

/** The text a leftField line becomes when the card turns out to have been destroyed. Public, like the line. */
export function destroyedLogText(cards: CardDatabase, code: number, controller?: number, format?: DuelFormat): string {
  const player = controller == null ? "" : `${playerLabel(format, controller)}'s `;
  return `${player}${nameOf(cards, code)} was destroyed`;
}

/** Destruction whose destination was redirected to face-up banishment. */
export function destroyedAndBanishedLogText(cards: CardDatabase, code: number, controller?: number, format?: DuelFormat): string {
  const player = controller == null ? "" : `${playerLabel(format, controller)}'s `;
  return `${player}${nameOf(cards, code)} was destroyed and banished`;
}

/**
 * Lines for a card that changed place. Field arrivals have their own summon/Set/activation lines, and moves
 * inside one place (shuffles, zone swaps) say nothing.
 *   Graveyard            "Player N's X was sent to the Graveyard" (always public). From the field it may later become
 *                        "Player N's X was destroyed" (see LogLine.leftField). A card sent from the hand is not called
 *                        discarded: Ritual and Fusion materials leave the hand the same way.
 *   banished face-up     "Player N's X was banished", or "Player N's X was destroyed and banished" when a destruction is reported
 *                        (face-down: nothing)
 *   hand                 public source: "X returned to Player N's hand" (from the field) or
 *                        "X was added to Player N's hand"; hidden source: a nameless public line, the name to
 *                        that hand's owner only
 *   Deck / Extra Deck    public source: "X returned to the Deck" / "the Extra Deck" (a destroyed Pendulum
 *                        Monster's line may become "Player N's X was destroyed"); hidden source: nothing
 * Tributes and materials are only known once the summon that used them arrives, so they read as Graveyard sends.
 * Graveyard sends, banishes and destruction rewrites name the previous controller, even if the card returns
 * to a different owner's pile.
 * Passing the format opts into controller labels. Omitting it preserves the legacy engine's pinned wording.
 */
export function moveLogLines(message: MoveMessage, cards: CardDatabase, format?: DuelFormat, deckMasters: readonly number[] = []): LogLine[] {
  const { from, to } = message;
  if (!to.location) return [];
  if (from.controller === to.controller && from.location === to.location) return [];
  const name = () => nameOf(cards, message.card);
  const player = format == null ? "" : `${playerLabel(format, from.controller)}'s `;
  const fromField = from.overlay_sequence == null && FIELD.has(from.location);
  switch (to.location) {
    case OcgLocation.GRAVE: {
      const line: LogLine = { text: `${player}${name()} was sent to the Graveyard`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    case OcgLocation.REMOVED: {
      if (!isFaceUp(to.position)) return [];
      const line: LogLine = { text: `${player}${name()} was banished`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    case OcgLocation.HAND: {
      if (from.location === OcgLocation.HAND) return [];
      const owner = to.controller;
      const who = playerLabel(format, owner);
      const hand = `${who}'s hand`;
      if (leavesPublicly(from, message.card, deckMasters)) {
        return [{ text: fromField ? `${name()} returned to ${hand}` : `${name()} was added to ${hand}`, audience: "all" }];
      }
      if (!message.card) return [{ text: fromField ? `A face-down card returned to ${hand}` : `${who} added a card to their hand`, audience: "all" }];
      return fromField
        ? [
            { text: `A face-down card returned to ${hand}`, audience: "all" },
            { text: `${name()} returned to your hand`, audience: owner },
          ]
        : [
            { text: `${who} added a card to their hand`, audience: "all" },
            { text: `You added ${name()} to your hand`, audience: owner },
          ];
    }
    case OcgLocation.DECK:
    case OcgLocation.EXTRA: {
      if (!leavesPublicly(from, message.card, deckMasters)) return [];
      const line: LogLine = { text: `${name()} returned to the ${to.location === OcgLocation.DECK ? "Deck" : "Extra Deck"}`, audience: "all" };
      if (fromField) line.leftField = true;
      return [line];
    }
    default:
      return [];
  }
}
