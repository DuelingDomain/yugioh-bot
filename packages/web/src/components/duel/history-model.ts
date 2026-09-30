// Pure event grouping for the duel history rail. No React, no DOM.
//
// The engine sends a rolling window of DuelEvent (ids only grow). This module folds fresh events into an
// accumulated list of tiles and separators, so older tiles persist while the window rolls.
//
// Grouping rules:
//   attack   opens a battle tile. Later battle damage and destroy events (zone matches, or zone unknown)
//            merge into that tile until the next attack or phase event.
//   activate opens a chain-link tile. chain-resolving / resolved / negated update the SAME tile by chain index.
//            Effect damage and destroy events that arrive while a link resolves merge into that link's tile.
//   summon / set   one tile each.
//   damage / destroy that belong to no open attack or chain become their own tile.
//   phase    a thin separator (not a tile). "Main Phase 1" also marks the turn start.
import type { DuelCard, DuelCardInfo, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, LOCATION_SZONE, phaseLabel, zoneKey } from "./constants";

export type HistoryCard = DuelCard | DuelCardInfo;
export type SummonKind = "normal" | "tribute" | "special" | "flip";
export type DamageCause = "battle" | "effect" | "cost";
export type ChainStatus = "pending" | "resolving" | "resolved" | "negated";

export interface HistoryHit {
  seat: number;
  amount: number;
  cause: DamageCause;
}

export interface HistoryLoss {
  seat: number | null;
  card: HistoryCard | null;
  role: "attacker" | "target" | "card";
}

export interface HistoryTile {
  type: "tile";
  /** Id of the first event in the group. Stable React key. */
  key: number;
  lastEventId: number;
  kind: "summon" | "set" | "activate" | "attack" | "damage" | "destroy";
  seat: number | null;
  /** The subject: summoned / set / activated card, the attacker, or the destroyed card. */
  card: HistoryCard | null;
  summonKind?: SummonKind;
  text: string;
  description?: string;
  turn: number;
  /** Phase label when this happened; empty when unknown. */
  phase: string;
  chain?: { index: number; size: number; status: ChainStatus };
  /** attack only */
  target?: { seat: number | null; card: HistoryCard | null; direct: boolean };
  hits: HistoryHit[];
  destroyed: HistoryLoss[];
  attackerZone?: string;
  targetZone?: string;
}

export interface HistorySeparator {
  type: "sep";
  key: number;
  label: string;
  /** Set when this separator starts a turn. */
  turn?: number;
  turnSeat?: number | null;
}

export type HistoryItem = HistoryTile | HistorySeparator;

export interface HistoryState {
  items: HistoryItem[];
  lastId: number;
  revision: number;
  /** Tiles whose first event id is above this slide in; older ones (first render, reload) do not. */
  animateAfter: number;
  phase: string | null;
  memory: Record<string, HistoryCard>;
  battleKey: number | null;
  chain: { keys: Record<number, number>; current: number | null; size: number } | null;
}

export interface HistoryContext {
  revision: number;
  turn: number;
  turnSeat: number;
  phase: string;
  seatCount: number;
  /** Cards on the field right now (monsters and spells). Used to look up attackers and targets. */
  cards: readonly DuelCard[];
}

const MAX_ITEMS = 90;

export function emptyHistory(): HistoryState {
  return {
    items: [],
    lastId: -1,
    revision: -1,
    animateAfter: -1,
    phase: null,
    memory: {},
    battleKey: null,
    chain: null,
  };
}

export function isHiddenHistoryCard(card: HistoryCard | null | undefined): boolean {
  if (!card) return true;
  return card.code == null;
}

function fieldKey(zone: DuelZoneRef): string {
  return zoneKey(zone.controller, zone.location, zone.sequence);
}

function snapshotMemory(cards: readonly DuelCard[]): Record<string, HistoryCard> {
  const memory: Record<string, HistoryCard> = {};
  for (const card of cards) {
    if (card.location !== LOCATION_MZONE && card.location !== LOCATION_SZONE) continue;
    memory[zoneKey(card.controller, card.location, card.sequence)] = card;
  }
  return memory;
}

function summonKindFor(event: DuelEvent): SummonKind {
  if (event.summonKind) return event.summonKind;
  const text = event.text.toLowerCase();
  if (text.includes("tribute")) return "tribute";
  if (text.includes("special")) return "special";
  if (text.includes("flip")) return "flip";
  return "normal";
}

/** True when the engine event ids belong to a different duel than the accumulated state. */
export function shouldResetHistory(state: HistoryState, events: readonly DuelEvent[], revision: number): boolean {
  if (state.lastId < 0) return false;
  if (revision < state.revision) return true;
  let max = -1;
  for (const event of events) if (typeof event.id === "number" && event.id > max) max = event.id;
  return events.length > 0 && max < state.lastId;
}

export function ingestHistory(state: HistoryState, events: readonly DuelEvent[], ctx: HistoryContext): HistoryState {
  const fresh = events
    .filter((event) => typeof event.id === "number" && event.id > state.lastId)
    .sort((a, b) => a.id - b.id);
  const seen = new Set<number>();
  const batch = fresh.filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));
  if (batch.length === 0) {
    if (state.revision === ctx.revision) return state;
    return { ...state, revision: ctx.revision, memory: snapshotMemory(ctx.cards) };
  }

  const isFirst = state.lastId < 0;
  const items = state.items.slice();
  const memory = { ...state.memory };
  let battleKey = state.battleKey;
  let chain = state.chain ? { ...state.chain, keys: { ...state.chain.keys } } : null;

  const indexOf = (key: number) => items.findIndex((item) => item.type === "tile" && item.key === key);
  const patch = (key: number, fn: (tile: HistoryTile) => HistoryTile) => {
    const index = indexOf(key);
    if (index < 0) return;
    const item = items[index];
    if (item.type === "tile") items[index] = fn({ ...item });
  };
  const tileAt = (key: number | null | undefined): HistoryTile | null => {
    if (key == null) return null;
    const item = items[indexOf(key)];
    return item && item.type === "tile" ? item : null;
  };

  // Turn numbers: every Main Phase 1 event after this one starts a later turn.
  const mp1After: number[] = new Array(batch.length).fill(0);
  let seenMp1 = 0;
  for (let i = batch.length - 1; i >= 0; i -= 1) {
    mp1After[i] = seenMp1;
    if (batch[i].kind === "phase" && isMainPhaseOne(batch[i].text)) seenMp1 += 1;
  }
  const seatCount = Math.max(2, ctx.seatCount);

  let phase = state.phase;
  if (phase == null) {
    const hasPhaseEvent = batch.some((event) => event.kind === "phase");
    phase = hasPhaseEvent ? "" : phaseLabelText(ctx.phase);
  }

  const lookupZone = (zone: DuelZoneRef | undefined): HistoryCard | null => {
    if (!zone) return null;
    const key = fieldKey(zone);
    return memory[key] ?? snapshotMemory(ctx.cards)[key] ?? null;
  };
  const otherSeat = (seat: number | null | undefined) => (seat == null ? null : (seat + 1) % seatCount);

  const make = (event: DuelEvent, index: number, kind: HistoryTile["kind"], card: HistoryCard | null): HistoryTile => ({
    type: "tile",
    key: event.id,
    lastEventId: event.id,
    kind,
    seat: event.seat ?? null,
    card,
    text: event.text,
    description: event.description,
    turn: Math.max(1, ctx.turn - mp1After[index]),
    phase: phase ?? "",
    hits: [],
    destroyed: [],
  });

  const addHit = (key: number, hit: HistoryHit, eventId: number) =>
    patch(key, (tile) => ({ ...tile, lastEventId: eventId, hits: [...tile.hits, hit] }));

  batch.forEach((event, index) => {
    switch (event.kind) {
      case "summon":
      case "set": {
        const card = event.card ?? null;
        if (event.zone && card) memory[fieldKey(event.zone)] = card;
        const tile = make(event, index, event.kind, card);
        if (event.kind === "summon") tile.summonKind = summonKindFor(event);
        items.push(tile);
        break;
      }
      case "attack": {
        battleKey = event.id;
        const attacker = event.card ?? lookupZone(event.zone);
        const tile = make(event, index, "attack", attacker);
        const direct = !event.target && (/direct/i.test(event.text) || Boolean(event.zone));
        tile.target = event.target
          ? { seat: event.target.controller, card: lookupZone(event.target), direct: false }
          : { seat: otherSeat(event.seat), card: null, direct };
        if (event.zone) tile.attackerZone = fieldKey(event.zone);
        if (event.target) tile.targetZone = fieldKey(event.target);
        items.push(tile);
        break;
      }
      case "activate": {
        const idx = event.chainIndex ?? 1;
        if (!chain || idx <= 1) chain = { keys: {}, current: null, size: 0 };
        const tile = make(event, index, "activate", event.card ?? null);
        chain.keys[idx] = event.id;
        chain.size = Math.max(chain.size, idx);
        tile.chain = { index: idx, size: chain.size, status: "pending" };
        items.push(tile);
        const size = chain.size;
        for (const key of Object.values(chain.keys)) {
          patch(key, (t) => (t.chain ? { ...t, chain: { ...t.chain, size } } : t));
        }
        break;
      }
      case "chain-resolving":
      case "chain-resolved":
      case "chain-negated": {
        const idx = event.chainIndex ?? 1;
        if (!chain) chain = { keys: {}, current: null, size: idx };
        let key = chain.keys[idx];
        if (key == null || !tileAt(key)) {
          // The window started mid-chain: make a tile for the link so its effects have a home.
          const tile = make(event, index, "activate", event.card ?? null);
          tile.chain = { index: idx, size: Math.max(chain.size, idx), status: "pending" };
          items.push(tile);
          chain.keys[idx] = key = event.id;
          chain.size = Math.max(chain.size, idx);
        }
        const status: ChainStatus =
          event.kind === "chain-resolving" ? "resolving" : event.kind === "chain-resolved" ? "resolved" : "negated";
        patch(key, (tile) => ({
          ...tile,
          lastEventId: event.id,
          card: tile.card ?? event.card ?? null,
          chain: tile.chain ? { ...tile.chain, status } : { index: idx, size: idx, status },
        }));
        chain.current = event.kind === "chain-resolving" ? idx : null;
        break;
      }
      case "chain-end":
        chain = null;
        break;
      case "phase": {
        battleKey = null;
        phase = event.text;
        const label = isMainPhaseOne(event.text);
        const last = items[items.length - 1];
        if (!label && last && last.type === "sep" && last.turn == null) items.pop();
        const sep: HistorySeparator = { type: "sep", key: event.id, label: event.text };
        if (label) {
          const turn = Math.max(1, ctx.turn - mp1After[index]);
          sep.turn = turn;
          sep.turnSeat = (((ctx.turnSeat - (ctx.turn - turn)) % seatCount) + seatCount) % seatCount;
        }
        items.push(sep);
        break;
      }
      case "damage": {
        if (!event.amount || event.amount <= 0 || event.seat == null) break;
        const cause: DamageCause = event.cause ?? (chain?.current != null ? "effect" : battleKey != null ? "battle" : "effect");
        const hit: HistoryHit = { seat: event.seat, amount: event.amount, cause };
        const battle = tileAt(battleKey);
        if (cause === "battle" && battle) {
          addHit(battle.key, hit, event.id);
        } else if (cause !== "battle" && chain?.current != null && tileAt(chain.keys[chain.current])) {
          addHit(chain.keys[chain.current], hit, event.id);
        } else {
          const tile = make(event, index, "damage", null);
          tile.hits = [hit];
          items.push(tile);
        }
        break;
      }
      case "destroy": {
        const card = event.card ?? lookupZone(event.zone);
        const key = event.zone ? fieldKey(event.zone) : null;
        const battle = tileAt(battleKey);
        const chainOpen = chain?.current != null && tileAt(chain.keys[chain.current]) != null;
        const battleCause = event.cause === "battle" || (event.cause == null && !chainOpen);
        const inBattle =
          battle != null &&
          battleCause &&
          (key == null || key === battle.attackerZone || key === battle.targetZone || (!battle.attackerZone && !battle.targetZone));
        if (inBattle && battle) {
          let role: HistoryLoss["role"] = "card";
          if (key != null && key === battle.attackerZone) role = "attacker";
          else if (key != null && key === battle.targetZone) role = "target";
          else if (card?.code != null && card.code === battle.card?.code) role = "attacker";
          else if (card?.code != null && card.code === battle.target?.card?.code) role = "target";
          const loss: HistoryLoss = { seat: event.zone?.controller ?? event.seat ?? null, card, role };
          patch(battle.key, (tile) => ({ ...tile, lastEventId: event.id, destroyed: [...tile.destroyed, loss] }));
        } else if (chainOpen && chain?.current != null && event.cause !== "battle") {
          const loss: HistoryLoss = { seat: event.zone?.controller ?? event.seat ?? null, card, role: "card" };
          patch(chain.keys[chain.current], (tile) => ({ ...tile, lastEventId: event.id, destroyed: [...tile.destroyed, loss] }));
        } else {
          const tile = make(event, index, "destroy", card);
          tile.seat = event.zone?.controller ?? event.seat ?? null;
          tile.destroyed = [{ seat: tile.seat, card, role: "card" }];
          items.push(tile);
        }
        break;
      }
      default:
        break;
    }
  });

  const lastId = batch[batch.length - 1].id;
  return {
    items: items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items,
    lastId,
    revision: ctx.revision,
    animateAfter: isFirst ? lastId : state.animateAfter,
    phase,
    memory: snapshotMemory(ctx.cards),
    battleKey,
    chain,
  };
}

function isMainPhaseOne(text: string): boolean {
  return /^main\s*(phase)?\s*1$/i.test(text.trim()) || phaseLabel(text) === "Main 1";
}

function phaseLabelText(phase: string): string {
  const label = phaseLabel(phase);
  return label === "—" ? "" : label;
}

/** Newest first, at most `maxTiles` tiles, with the separators between them. */
export function visibleHistory(items: readonly HistoryItem[], maxTiles = 12): HistoryItem[] {
  let tiles = 0;
  let start = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].type === "tile") {
      tiles += 1;
      if (tiles > maxTiles) {
        start = i + 1;
        break;
      }
    }
  }
  const slice = items.slice(start);
  while (slice.length > 0 && slice[0].type === "sep") slice.shift();
  return slice.reverse();
}
