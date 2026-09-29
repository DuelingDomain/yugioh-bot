import type { DuelCard, DuelCardInfo, DuelEngineView, DuelEvent, DuelMode, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgQueryFlags,
  ocgPhaseString,
  type OcgCardQueryInfo,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgLocation as OcgLocationValue,
  type OcgMessage,
  type OcgPhase,
  type OcgQueryFlags as OcgQueryFlagsValue,
} from "ocgcore-wasm";
import { raceLabel, type CardDatabase } from "./cards.js";

export const LOCATION_DECKMASTER = 0x4000;
export const DOMAIN_LEAVE_TAX_STEP = 500;
export const DOMAIN_RECALL_DESC = 0x444D5243;

export interface DomainSeatState {
  inZone: boolean;
  code: number;
  returns: number;
  nextCost: number;
}

export interface LogEntry {
  id: number;
  text: string;
  audience: "all" | number;
}

export type RevealMap = Map<number, Map<string, number>>;

export function slotKey(controller: number, location: number, sequence: number): string {
  return `${controller}:${location}:${sequence}`;
}

export function createRevealMap(): RevealMap {
  return new Map([
    [0, new Map<string, number>()],
    [1, new Map<string, number>()],
  ]);
}

export function noteReveal(reveals: RevealMap, viewer: number, controller: number, location: number, sequence: number, code: number): void {
  reveals.get(viewer)?.set(slotKey(controller, location, sequence), code);
}

export function slotRevealed(reveals: RevealMap, viewer: number | null, controller: number, location: number, sequence: number, code?: number): boolean {
  if (viewer == null) return false;
  const stored = reveals.get(viewer)?.get(slotKey(controller, location, sequence));
  if (stored == null) return false;
  return code == null || code === 0 || stored === code;
}

export function moveReveals(
  reveals: RevealMap,
  from: { controller: number; location: number; sequence: number },
  to: { controller: number; location: number; sequence: number; position?: number },
  code: number,
): void {
  const origin = slotKey(from.controller, from.location, from.sequence);
  const forget = to.location === OcgLocation.DECK || (to.location === OcgLocation.EXTRA && isFacedownPosition(to.position));
  for (const tracked of reveals.values()) {
    const stored = tracked.get(origin);
    if (stored == null) continue;
    tracked.delete(origin);
    if (forget || (code !== 0 && stored !== code)) continue;
    tracked.set(slotKey(to.controller, to.location, to.sequence), stored);
  }
}

export function clearRevealsAt(reveals: RevealMap, controller: number, location: number): void {
  const prefix = `${controller}:${location}:`;
  for (const tracked of reveals.values()) {
    for (const key of [...tracked.keys()]) {
      if (key.startsWith(prefix)) tracked.delete(key);
    }
  }
}

const QUERY_FLAGS = (
  OcgQueryFlags.CODE |
  OcgQueryFlags.POSITION |
  OcgQueryFlags.LEVEL |
  OcgQueryFlags.RANK |
  OcgQueryFlags.ATTRIBUTE |
  OcgQueryFlags.RACE |
  OcgQueryFlags.ATTACK |
  OcgQueryFlags.DEFENSE |
  OcgQueryFlags.OVERLAY_CARD |
  OcgQueryFlags.COUNTERS |
  OcgQueryFlags.OWNER |
  OcgQueryFlags.IS_PUBLIC |
  OcgQueryFlags.LSCALE |
  OcgQueryFlags.RSCALE |
  OcgQueryFlags.LINK |
  OcgQueryFlags.IS_HIDDEN
) as OcgQueryFlagsValue;

export function isFacedownPosition(position: number | undefined): boolean {
  return position != null && (position & OcgPosition.FACEDOWN) !== 0;
}

export function cardIsVisible(args: {
  viewer: number | null;
  controller: number;
  location: number;
  position: number;
  isPublic?: boolean;
  isHidden?: boolean;
  revealed?: boolean;
}): boolean {
  if (args.revealed) return true;
  if (args.isPublic) return true;
  const own = args.viewer !== null && args.viewer === args.controller;
  if (args.location === OcgLocation.DECK) return false;
  if (args.location === OcgLocation.HAND) return own;
  if (args.location === OcgLocation.GRAVE) return true;
  if (args.location === OcgLocation.EXTRA) return own || (!args.isHidden && !isFacedownPosition(args.position));
  if (args.location === OcgLocation.REMOVED) return own || !isFacedownPosition(args.position);
  if (args.location === OcgLocation.MZONE || args.location === OcgLocation.SZONE || args.location === LOCATION_DECKMASTER) {
    return own || !isFacedownPosition(args.position);
  }
  return own;
}

export function redactCard(card: DuelCard, visible: boolean): DuelCard {
  if (visible) return card;
  return {
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
  };
}

function queryToCard(
  controller: number,
  location: number,
  sequence: number,
  query: Partial<OcgCardQueryInfo> | null | undefined,
  cards: CardDatabase,
  materials: DuelCard[] | undefined,
): DuelCard | null {
  if (!query) return null;
  const position = query.position ?? 0;
  if (!query.code && !position) return null;
  const info = query.code ? cards.get(query.code) : undefined;
  const counters = query.counters
    ? Object.entries(query.counters).map(([type, count]) => ({ type: Number(type), count }))
    : undefined;
  const level = query.level || query.rank || query.link?.rating;
  const card: DuelCard = {
    controller,
    location,
    sequence,
    position,
    code: query.code,
    name: info?.name,
    description: info?.description,
    attack: query.attack,
    defense: query.defense,
    level,
    type: info?.type,
    attribute: query.attribute ?? info?.attribute,
    race: query.race != null ? raceLabel(query.race) : info?.race,
    counters: counters && counters.length > 0 ? counters : undefined,
    materials,
  };
  if (query.rank) card.rank = query.rank;
  if (query.link) {
    card.linkRating = query.link.rating;
    card.linkMarker = query.link.marker as number;
  }
  return card;
}

function queryLocation(
  lib: OcgCoreSync,
  handle: OcgDuelHandle,
  controller: 0 | 1,
  location: OcgLocationValue,
) {
  return lib.duelQueryLocation(handle, { flags: QUERY_FLAGS, controller, location });
}

function overlayMaterials(controller: 0 | 1, cards: CardDatabase, overlayCards?: number[]): DuelCard[] {
  if (!overlayCards?.length) return [];
  const materials: DuelCard[] = [];
  overlayCards.forEach((code, overlaySequence) => {
    const material = queryToCard(controller, OcgLocation.OVERLAY, overlaySequence, { code }, cards, undefined);
    if (material) materials.push(material);
  });
  return materials;
}

function projectList(
  viewer: number | null,
  controller: number,
  location: number,
  queries: Array<Partial<OcgCardQueryInfo> | null>,
  cards: CardDatabase,
  reveals: RevealMap,
): Array<DuelCard | null> {
  return queries.map((query, sequence) => {
    const card = queryToCard(controller, location, sequence, query, cards, undefined);
    if (!card) return null;
    const visible = cardIsVisible({
      viewer,
      controller,
      location,
      position: card.position,
      isPublic: query?.isPublic,
      isHidden: query?.isHidden,
      revealed: slotRevealed(reveals, viewer, controller, location, sequence, query?.code),
    });
    return redactCard(card, visible);
  });
}

function compact(list: Array<DuelCard | null>): DuelCard[] {
  return list.filter((card): card is DuelCard => card != null);
}

export function phaseName(phase: OcgPhase): string {
  return ocgPhaseString.get(phase) ?? String(phase);
}

export interface StoredChainLink {
  index: number;
  seat: number;
  code: number;
  description?: string;
}

export interface StoredDuelEvent {
  id: number;
  kind: DuelEvent["kind"];
  seat?: number;
  card?: DuelCardInfo;
  chainIndex?: number;
  text: string;
  publicText: string;
  description?: string;
  revealCardTo: "all" | number;
}

export function projectStoredEvent(event: StoredDuelEvent, viewer: number | null): DuelEvent {
  const reveal = event.revealCardTo === "all" || (viewer != null && viewer === event.revealCardTo);
  const projected: DuelEvent = {
    id: event.id,
    kind: event.kind,
    text: reveal ? event.text : event.publicText,
  };
  if (event.seat != null) projected.seat = event.seat;
  if (event.chainIndex != null) projected.chainIndex = event.chainIndex;
  if (reveal && event.card) projected.card = event.card;
  if (reveal && event.description) projected.description = event.description;
  return projected;
}

function chainLinkEvent(
  id: number,
  kind: "chain-resolving" | "chain-resolved" | "chain-negated",
  chainSize: number,
  chain: StoredChainLink[],
  cards: CardDatabase,
  verb: string,
): StoredDuelEvent {
  const link = chain[chainSize - 1];
  const info = link ? cards.get(link.code) : undefined;
  const label = info?.name ?? (link ? `Card ${link.code}` : `Chain link ${chainSize}`);
  const text = `Chain link ${chainSize} (${label}) ${verb}`;
  return {
    id,
    kind,
    seat: link?.seat,
    card: info,
    chainIndex: chainSize,
    text,
    publicText: text,
    description: link?.description,
    revealCardTo: "all",
  };
}

export function observeDuelEvent(message: OcgMessage, cards: CardDatabase, chain: StoredChainLink[], id: number): StoredDuelEvent | null {
  switch (message.type) {
    case OcgMessageType.SUMMONING:
    case OcgMessageType.SPSUMMONING:
    case OcgMessageType.FLIPSUMMONING: {
      const verb =
        message.type === OcgMessageType.SUMMONING
          ? "Normal Summons"
          : message.type === OcgMessageType.SPSUMMONING
            ? "Special Summons"
            : "Flip Summons";
      const info = cards.get(message.code);
      const text = `Player ${message.controller + 1} ${verb} ${info?.name ?? `Card ${message.code}`}`;
      const hidden = (message.position & OcgPosition.FACEDOWN) !== 0;
      return {
        id, kind: "summon", seat: message.controller, card: info, text,
        publicText: hidden ? `Player ${message.controller + 1} ${verb} a face-down monster` : text,
        revealCardTo: hidden ? message.controller : "all",
      };
    }
    case OcgMessageType.SET: {
      const info = cards.get(message.code);
      const publicText = `Player ${message.controller + 1} Sets a card`;
      const text = info ? `Player ${message.controller + 1} Sets ${info.name}` : publicText;
      return { id, kind: "set", seat: message.controller, card: info, text, publicText, revealCardTo: message.controller };
    }
    case OcgMessageType.CHAINING: {
      const info = cards.get(message.code);
      const description = cards.resolveLabel(message.description) || undefined;
      chain.length = message.chain_size;
      chain[message.chain_size - 1] = {
        index: message.chain_size,
        seat: message.controller,
        code: message.code,
        description,
      };
      const text = `${info?.name ?? `Card ${message.code}`} is activating`;
      return {
        id,
        kind: "activate",
        seat: message.controller,
        card: info,
        chainIndex: message.chain_size,
        text,
        publicText: text,
        description,
        revealCardTo: "all",
      };
    }
    case OcgMessageType.CHAIN_SOLVING:
      return chainLinkEvent(id, "chain-resolving", message.chain_size, chain, cards, "is resolving");
    case OcgMessageType.CHAIN_SOLVED:
      return chainLinkEvent(id, "chain-resolved", message.chain_size, chain, cards, "resolved");
    case OcgMessageType.CHAIN_NEGATED:
      return chainLinkEvent(id, "chain-negated", message.chain_size, chain, cards, "was negated");
    case OcgMessageType.CHAIN_DISABLED:
      return chainLinkEvent(id, "chain-negated", message.chain_size, chain, cards, "was disabled");
    case OcgMessageType.CHAIN_END:
      chain.length = 0;
      return { id, kind: "chain-end", text: "Chain ended", publicText: "Chain ended", revealCardTo: "all" };
    case OcgMessageType.ATTACK: {
      const seat = message.card.controller;
      const text = message.target
        ? `Player ${seat + 1} declares an attack`
        : `Player ${seat + 1} declares a direct attack`;
      return { id, kind: "attack", seat, text, publicText: text, revealCardTo: "all" };
    }
    default:
      return null;
  }
}


export function projectView(args: {
  lib: OcgCoreSync;
  handle: OcgDuelHandle;
  cards: CardDatabase;
  viewer: number | null;
  revision: number;
  turn: number;
  turnSeat: number;
  phase: string;
  lp: [number, number];
  prompt: DuelPrompt | null;
  promptSeat: number | null;
  log: LogEntry[];
  events: StoredDuelEvent[];
  result: DuelEngineView["result"];
  reveals: RevealMap;
  mode: DuelMode;
  domainState?: DomainSeatState[];
}): DuelEngineView {
  const field = args.lib.duelQueryField(args.handle);
  const seats: DuelSeatView[] = [0, 1].map((seat) => {
    const controller = seat as 0 | 1;
    const player = field.players[controller];
    const monsters = queryLocation(args.lib, args.handle, controller, OcgLocation.MZONE).map((query, sequence) => {
      const overlays = overlayMaterials(controller, args.cards, query?.overlayCards);
      const card = queryToCard(controller, OcgLocation.MZONE, sequence, query, args.cards, overlays);
      if (!card) return null;
      const visible = cardIsVisible({
        viewer: args.viewer,
        controller,
        location: OcgLocation.MZONE,
        position: card.position,
        isPublic: query?.isPublic,
        isHidden: query?.isHidden,
        revealed: slotRevealed(args.reveals, args.viewer, controller, OcgLocation.MZONE, sequence, query?.code),
      });
      const projected = redactCard(card, visible);
      if (!visible) delete projected.materials;
      else if (projected.materials) {
        projected.materials = projected.materials.map((material) => redactCard(material, visible));
      }
      return projected;
    });
    const spells = projectList(args.viewer, controller, OcgLocation.SZONE, queryLocation(args.lib, args.handle, controller, OcgLocation.SZONE), args.cards, args.reveals);
    const hand = compact(projectList(args.viewer, controller, OcgLocation.HAND, queryLocation(args.lib, args.handle, controller, OcgLocation.HAND), args.cards, args.reveals));
    const graveyard = compact(projectList(args.viewer, controller, OcgLocation.GRAVE, queryLocation(args.lib, args.handle, controller, OcgLocation.GRAVE), args.cards, args.reveals));
    const banished = compact(projectList(args.viewer, controller, OcgLocation.REMOVED, queryLocation(args.lib, args.handle, controller, OcgLocation.REMOVED), args.cards, args.reveals));
    const extraQueries = queryLocation(args.lib, args.handle, controller, OcgLocation.EXTRA);
    const extra = compact(projectList(args.viewer, controller, OcgLocation.EXTRA, extraQueries, args.cards, args.reveals)).filter((card) => {
      if (args.viewer === controller) return true;
      return card.code != null;
    });
    const domain = args.domainState?.[seat];
    const view: DuelSeatView = {
      seat,
      lp: args.lp[seat],
      hand,
      deckCount: player.deck_size,
      extraCount: player.extra_size,
      extra,
      monsters: monsters.length === 7 ? monsters : [...monsters, ...Array.from({ length: Math.max(0, 7 - monsters.length) }, () => null)],
      spells: spells.length === 8 ? spells : [...spells, ...Array.from({ length: Math.max(0, 8 - spells.length) }, () => null)],
      graveyard,
      banished,
    };
    if (args.mode === "domain" && domain) {
      const info = args.cards.get(domain.code);
      if (info) view.deckMaster = { card: info, inZone: domain.inZone, returns: domain.returns, nextCost: domain.nextCost };
    }
    return view;
  });

  const chain = field.chain.map((link, index) => {
    const info = args.cards.get(link.code);
    const description = args.cards.resolveLabel(link.description) || undefined;
    return {
      index: index + 1,
      seat: link.controller,
      code: link.code,
      name: info?.name,
      description,
    };
  });

  return {
    revision: args.revision,
    turn: args.turn,
    turnSeat: args.turnSeat,
    phase: args.phase,
    seats,
    prompt: args.viewer !== null && args.viewer === args.promptSeat ? args.prompt : null,
    chain,
    events: args.events.map((event) => projectStoredEvent(event, args.viewer)),
    log: args.log
      .filter((entry) => entry.audience === "all" || entry.audience === args.viewer)
      .map(({ id, text }) => ({ id, text })),
    result: args.result,
  };
}
