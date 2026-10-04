// Pure chain state for the duel board. No React, no DOM.
//
// The engine sends a rolling window of DuelEvent plus a snapshot `chain` (index, seat, code, name).
// Chain events are public: an "activate" with a chainIndex opens link N (card, controller and the
// zone it activated from), "chain-resolving" / "chain-resolved" / "chain-negated" move that link
// through its life (highest link first), and "chain-end" clears the chain.
//
// applyChainEvent folds one event into the state, so a player can play a batch out one beat at a
// time. deriveChainState folds a whole window at once (first paint, reconnect, replay of a window).
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_MZONE, LOCATION_REMOVED, LOCATION_SZONE, zoneKey } from "./constants";
import { CHAIN_TIMING } from "./duel-timing";

export type ChainLinkStatus = "pending" | "resolving" | "resolved";

export interface ChainLinkState {
  /** Chain Link number, 1 = the first activation. */
  index: number;
  seat: number;
  /** null when the activation left the event window and the snapshot has no card either. */
  code: number | null;
  name: string | null;
  card: DuelCardInfo | null;
  description?: string;
  /** Where the card was when it activated (hand slot, field zone, pile card, ...). null when unknown. */
  zone: DuelZoneRef | null;
  /** Current public target coordinates; identities stay in the viewer's redacted board. */
  targets: DuelZoneRef[];
  status: ChainLinkStatus;
  /** Negated or disabled. Stays set after the link resolves. */
  negated: boolean;
}

export interface ChainState {
  /** Ordered by index, links[0] is Chain Link 1. */
  links: ChainLinkState[];
  /** The link that is resolving right now, null between links and while the chain is still building. */
  resolving: number | null;
}

export const EMPTY_CHAIN: ChainState = { links: [], resolving: null };

type ChainEventKind = "activate" | "target" | "chain-resolving" | "chain-resolved" | "chain-negated" | "chain-end";

/** True for an event that changes the chain. A plain "activate" without a chainIndex is not one. */
export function isChainEvent(event: DuelEvent): boolean {
  if (event.kind === "chain-end") return true;
  if (event.kind === "activate" || event.kind === "target" || event.kind === "chain-resolving" || event.kind === "chain-resolved" || event.kind === "chain-negated") {
    return typeof event.chainIndex === "number" && event.chainIndex >= 1;
  }
  return false;
}

function placeholder(index: number): ChainLinkState {
  return { index, seat: 0, code: null, name: null, card: null, zone: null, targets: [], status: "pending", negated: false };
}

/** Links 1..index, adding placeholders for any the window lost. Does not copy existing links. */
function ensureLinks(links: ChainLinkState[], index: number): ChainLinkState[] {
  if (links.length >= index) return links.slice();
  const next = links.slice();
  for (let i = links.length + 1; i <= index; i += 1) next.push(placeholder(i));
  return next;
}

export function applyChainEvent(state: ChainState, event: DuelEvent): ChainState {
  if (!isChainEvent(event)) return state;
  const kind = event.kind as ChainEventKind;
  if (kind === "chain-end") return EMPTY_CHAIN;
  const index = event.chainIndex as number;

  if (kind === "activate") {
    // Link N replaces anything from N up: a new chain restarts at 1, a repeated activation is idempotent.
    const kept = state.links.slice(0, index - 1);
    const links = ensureLinks(kept, index - 1);
    const card = event.card ?? null;
    links.push({
      index,
      seat: event.seat ?? 0,
      code: card && card.code > 0 ? card.code : null,
      name: card?.name ?? null,
      card,
      description: event.description,
      zone: event.zone ? { ...event.zone } : null,
      targets: event.targets?.map((zone) => ({ ...zone })) ?? [],
      status: "pending",
      negated: false,
    });
    return { links, resolving: null };
  }

  const links = ensureLinks(state.links, index);
  const link = { ...links[index - 1] };
  links[index - 1] = link;
  if (kind === "target") {
    link.targets = event.targets?.map((zone) => ({ ...zone })) ?? [];
    if (event.seat != null && link.code == null) link.seat = event.seat;
    return { links, resolving: state.resolving };
  }
  if (kind === "chain-resolving") {
    link.status = "resolving";
    if (event.seat != null && link.code == null) link.seat = event.seat;
    return { links, resolving: index };
  }
  if (kind === "chain-resolved") {
    link.status = "resolved";
    return { links, resolving: state.resolving === index ? null : state.resolving };
  }
  link.negated = true;
  return { links, resolving: state.resolving };
}

function fromSnapshot(link: DuelChainLink): ChainLinkState {
  return {
    index: link.index,
    seat: link.seat,
    code: link.code != null && link.code > 0 ? link.code : null,
    name: link.name ?? null,
    card: null,
    description: link.description,
    zone: link.zone ? { ...link.zone } : null,
    targets: link.targets?.map((zone) => ({ ...zone })) ?? [],
    status: "pending",
    negated: false,
  };
}

/** The snapshot as one link per index, ascending. A bad index is dropped, a repeated one keeps the last entry. */
function snapshotEntries(snapshot: readonly DuelChainLink[]): ChainLinkState[] {
  const byIndex = new Map<number, ChainLinkState>();
  for (const link of snapshot) {
    if (!Number.isInteger(link.index) || link.index < 1) continue;
    byIndex.set(link.index, fromSnapshot(link));
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * The chain after a whole event window. The snapshot chain fills links the window no longer holds
 * (and is the whole chain when the window has none), so a reload mid-chain still shows it.
 *
 * The result always holds exactly one link per number, 1..n. The snapshot is the engine's chain at
 * the same revision as the window, so it also decides how long the chain is: a window link above
 * its top is left over from a chain whose "chain-end" was lost, and is dropped.
 */
export function deriveChainState(events: readonly DuelEvent[], snapshot: readonly DuelChainLink[] = []): ChainState {
  const ordered = events.filter(isChainEvent).sort((a, b) => a.id - b.id);
  let state = ordered.reduce(applyChainEvent, EMPTY_CHAIN);
  if (state === EMPTY_CHAIN && ordered.length > 0 && ordered[ordered.length - 1].kind === "chain-end") return EMPTY_CHAIN;
  const entries = snapshotEntries(snapshot);
  if (entries.length === 0) return state;
  const top = entries[entries.length - 1].index;
  if (state.links.length === 0) return { links: fillGaps(entries, top), resolving: null };
  let links: ChainLinkState[] | null = state.links.length > top ? state.links.slice(0, top) : null;
  for (const entry of entries) {
    const current = (links ?? state.links)[entry.index - 1];
    links ??= state.links.slice();
    while (links.length < entry.index) links.push(placeholder(links.length + 1));
    const known = links[entry.index - 1];
    // Current snapshot targets override stale events, including an explicit empty list. Older
    // snapshots without the field still fall back to events. Preserve playback status and cards.
    const hasTargets = snapshot.findLast((link) => link.index === entry.index)?.targets != null;
    links[entry.index - 1] = {
      ...(current && current.code != null ? current : entry),
      status: known.status, negated: known.negated, zone: known.zone ?? entry.zone,
      targets: hasTargets ? entry.targets : known.targets,
    };
  }
  if (links) state = { links, resolving: state.resolving != null && state.resolving > links.length ? null : state.resolving };
  return state;
}

/** Links 1..top from sorted entries, with a placeholder for any number the entries skip. */
function fillGaps(entries: readonly ChainLinkState[], top: number): ChainLinkState[] {
  const out: ChainLinkState[] = [];
  let at = 0;
  for (let index = 1; index <= top; index += 1) {
    out.push(entries[at]?.index === index ? entries[at++] : placeholder(index));
  }
  return out;
}

/** The chain as a stack, top of the chain first: the highest link is on top, Chain Link 1 at the bottom. */
export function chainStackRows(state: ChainState): ChainLinkState[] {
  return state.links.slice().sort((a, b) => b.index - a.index);
}

/**
 * The link the stack callout is about: the one that is resolving; between resolutions, the link that resolved last
 * (the lowest index among the resolved links, since a chain resolves from the top down); while the chain is still
 * building, the top of the chain (the activation that just happened). null when no chain is open.
 */
export function chainFocusLink(state: ChainState): ChainLinkState | null {
  if (state.links.length === 0) return null;
  if (state.resolving != null) return state.links[state.resolving - 1] ?? null;
  const resolved = state.links.find((link) => link.status === "resolved");
  return resolved ?? state.links[state.links.length - 1];
}

/** What every surface calls a link's card: its name, or "A card" when the name is unknown. Never a passcode. */
export function chainCardName(link: Pick<ChainLinkState, "name">): string {
  return link.name?.trim() || "A card";
}

export type ChainCallout = {
  /** "Chain 1" */
  label: string;
  title: string;
  /** "You" / "Opponent" / the player's name. */
  owner: string;
  /** What the engine says happened to this link: activation, resolving, resolved or negated. */
  action: string;
};

/**
 * What the callout says about a link, from the real chain data only. MSG_CHAINING carries the card,
 * its zone, the controller, the chain count and the effect description; it does not say whether the
 * effect is a trigger, a quick effect or an ignition effect, so an activation is always "activates its
 * effect" (and "activates an effect" when even the card is unknown).
 */
export function chainCallout(
  link: ChainLinkState,
  mySeat: number | null,
  playerName: (seat: number) => string,
  named = false,
): ChainCallout {
  const known = link.name != null || link.code != null;
  const title = chainCardName(link);
  const owner = chainSeatLabel(link.seat, mySeat, playerName, named);
  let action = known ? "activates its effect" : "activates an effect";
  if (link.negated) action = "was negated";
  else if (link.status === "resolving") action = "is resolving";
  else if (link.status === "resolved") action = "resolved";
  const label = `Chain ${link.index}`;
  return { label, title, owner, action };
}

export type ChainAnchor = {
  /** The zone the card activated from; on the board it is found by its data-zones key. */
  zone: DuelZoneRef;
  /** Used when that exact slot is gone (the card left it): the whole hand or pile of that player. */
  fallback?: { kind: "hand"; controller: number } | { kind: "pile"; controller: number; location: number };
};

const PILES = new Set<number>([LOCATION_GRAVE, LOCATION_REMOVED, LOCATION_EXTRA, LOCATION_DECK]);

/** Where the board puts a link's badge, or null when the activation zone is unknown (stack panel only). */
export function chainAnchor(link: ChainLinkState): ChainAnchor | null {
  const zone = link.zone;
  if (!zone) return null;
  if (zone.location === LOCATION_HAND) return { zone, fallback: { kind: "hand", controller: zone.controller } };
  if (PILES.has(zone.location)) {
    return { zone, fallback: { kind: "pile", controller: zone.controller, location: zone.location } };
  }
  return { zone };
}

/** The data-zones key of an anchor's zone. */
export function anchorKey(anchor: ChainAnchor): string {
  return zoneKey(anchor.zone.controller, anchor.zone.location, anchor.zone.sequence);
}

/**
 * "You" / "Opponent" for a seated player, the player name for a spectator. At a table of 3 or 4 seats "Opponent" says
 * nothing (`named`): every rival reads by name.
 */
export function chainSeatLabel(seat: number, mySeat: number | null, playerName: (seat: number) => string, named = false): string {
  if (mySeat == null) return playerName(seat);
  if (seat === mySeat) return "You";
  return named ? playerName(seat) : "Opponent";
}

/**
 * How long the board holds on each chain event before the next one plays. This is the pace of a
 * chain resolution (there is no centre banner for it): a link pulses while it resolves (1150), a
 * negated one then shows its slash (950), and a resolved one ticks and clears away while the next
 * link is marked "up next" (720). One link is about 1.9 s, so each step can be followed. A backlog
 * plays the beats faster, but an activation, a resolving link and a negation never below
 * CHAIN_TIMING.readableFloorMs.
 */
const STEP_MS: Record<ChainEventKind, number> = {
  activate: CHAIN_TIMING.activateMs,
  target: 0,
  "chain-resolving": CHAIN_TIMING.resolvingMs,
  "chain-resolved": CHAIN_TIMING.resolvedMs,
  "chain-negated": CHAIN_TIMING.negatedMs,
  "chain-end": CHAIN_TIMING.endMs,
};
const STEP_FLOOR_MS = CHAIN_TIMING.floorMs;
/** The beats a viewer reads (what was activated, what became of it) squeeze less than the rest. */
const READABLE_FLOOR_MS: Readonly<Record<string, number>> = CHAIN_TIMING.readableFloorMs;
/** A backlog of more than this many beats is played faster, down to the floor. */
const BACKLOG_BEATS = CHAIN_TIMING.backlogBeats;
/** A link's own effect (a card move, a destroy) starts this long after its badge starts to pulse. */
const EFFECT_LEAD_MS = CHAIN_TIMING.effectLeadMs;
const EFFECT_LEAD_REDUCED_MS = CHAIN_TIMING.effectLeadReducedMs;

/** How long to hold the board on a chain event before the next one plays. */
export function chainStepDelay(kind: string, remaining: number, reducedMotion: boolean): number {
  if (kind === "target") return 0;
  const base = STEP_MS[kind as ChainEventKind] ?? CHAIN_TIMING.fallbackMs;
  const floor = READABLE_FLOOR_MS[kind] ?? STEP_FLOOR_MS;
  const length = reducedMotion ? Math.max(floor, Math.round(base * 0.8)) : base;
  if (remaining <= BACKLOG_BEATS) return length;
  return Math.max(floor, Math.round((length * BACKLOG_BEATS) / remaining));
}

/** How long after a link starts resolving its effect (a move, a destroy) starts on the board. */
export function chainEffectLead(reducedMotion: boolean): number {
  return reducedMotion ? EFFECT_LEAD_REDUCED_MS : EFFECT_LEAD_MS;
}

/**
 * The link that resolves after the current one: the highest link still waiting, once resolution has
 * begun (a chain that is still being built has no "up next"). null when no link waits.
 */
export function nextToResolve(state: ChainState): number | null {
  if (!state.links.some((link) => link.status !== "pending")) return null;
  for (let i = state.links.length - 1; i >= 0; i -= 1) {
    if (state.links[i].status === "pending") return state.links[i].index;
  }
  return null;
}

/** Cheap equality key: two states with the same key draw the same board. */
export function chainStateKey(state: ChainState): string {
  return state.links
    .map((link) => {
      const z = link.zone ? zoneKey(link.zone.controller, link.zone.location, link.zone.sequence) : "-";
      const targets = link.targets.map((zone) => zoneKey(zone.controller, zone.location, zone.sequence)).join(",");
      return `${link.index}:${link.seat}:${link.code ?? 0}:${link.name ?? ""}:${link.description ?? ""}:${link.status}:${link.negated ? 1 : 0}:${z}:${targets}`;
    })
    .join("|");
}

type Point = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };

/**
 * Badge geometry, shared with chain-fx.module.css (.badge): the badge hangs on the card's top right
 * corner, a third of its width outside, and each further link on the same card steps left by 82%.
 */
const BADGE_OUT = 0.34;
const BADGE_STEP = 0.82;

/** Centre of a link's badge, from the card box, the badge size and its place in the fan on that card. */
export function badgeCenter(box: Box, size: number, shift: number): Point {
  return {
    x: box.left + box.width + size * (BADGE_OUT - shift * BADGE_STEP) - size / 2,
    y: box.top - size * BADGE_OUT + size / 2,
  };
}

/** A quadratic arc from one badge to the next, or null when they are too close for a line to read. */
export function chainWirePath(from: Point, to: Point, minGap: number): string | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < minGap) return null;
  const sag = Math.min(40, dist * 0.18);
  const cx = (from.x + to.x) / 2 - (dy / dist) * sag;
  const cy = (from.y + to.y) / 2 + (dx / dist) * sag;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(from.x)} ${r(from.y)} Q${r(cx)} ${r(cy)} ${r(to.x)} ${r(to.y)}`;
}

export type CalloutPlace = {
  /** Sideways shift in px that keeps the tag on the board. */
  dx: number;
  /** "near": the side it opens on by default; "far": the other side; "hidden": no side is clear of a prompt. */
  side: "near" | "far" | "hidden";
};

const CALLOUT_GAP = 8;
const CALLOUT_EDGE = 4;
const CALLOUT_CLEAR = 6;

function rectsOverlap(a: Box, b: Box, pad: number): boolean {
  return a.left < b.left + b.width + pad && a.left + a.width + pad > b.left &&
    a.top < b.top + b.height + pad && a.top + a.height + pad > b.top;
}

/**
 * Where the row of numbered chips goes: the top left corner, moved clear of anything it would cover (a life-point
 * plate, an open prompt panel). It first slides right past the thing in its way; when the row no longer fits on the
 * board that way, it goes back to the left edge and drops below it. Ten steps at most, so a crowded board still ends.
 */
export function placeChips(
  size: { width: number; height: number },
  board: { width: number; height: number },
  obstacles: readonly Box[],
): { left: number; top: number } {
  const EDGE = 4;
  const GAP = 6;
  let left = EDGE;
  let top = EDGE;
  for (let step = 0; step < 10; step += 1) {
    const hit = obstacles.find(
      (o) => left < o.left + o.width + GAP && left + size.width > o.left - GAP && top < o.top + o.height + GAP && top + size.height > o.top - GAP,
    );
    if (!hit) break;
    const right = hit.left + hit.width + GAP;
    if (right + size.width <= board.width - EDGE) {
      left = right;
    } else {
      left = EDGE;
      top = hit.top + hit.height + GAP;
    }
  }
  return { left, top: Math.max(EDGE, Math.min(top, Math.max(EDGE, board.height - size.height - EDGE))) };
}

/**
 * Where the callout tag of the focus card goes. All boxes are in board pixels. The tag is centred on its card and
 * opens below it on the upper half of the board (`half` "high") and above it on the lower half. It slides sideways to
 * stay on the board. It must never sit over an open prompt panel (the Yes/No bar, the card choices): clicks pass
 * through the tag, so a covered button would still be pressed with the player unable to read it. If the default
 * side is covered it opens on the other side when that side is on the board and clear, else it is hidden (the stack
 * panel keeps the same words).
 */
export function placeCallout(input: {
  card: Box;
  board: { width: number; height: number };
  tag: { width: number; height: number };
  half: "high" | "low";
  panels: readonly Box[];
}): CalloutPlace {
  const { card, board, tag, half, panels } = input;
  const centre = card.left + card.width / 2;
  const hw = tag.width / 2;
  const dx = Math.round(Math.max(CALLOUT_EDGE + hw - centre, Math.min(0, board.width - CALLOUT_EDGE - hw - centre)));
  const left = centre + dx - hw;
  const below: Box = { left, top: card.top + card.height + CALLOUT_GAP, width: tag.width, height: tag.height };
  const above: Box = { left, top: card.top - CALLOUT_GAP - tag.height, width: tag.width, height: tag.height };
  const near = half === "high" ? below : above;
  const far = half === "high" ? above : below;
  const clear = (rect: Box) => panels.every((panel) => !rectsOverlap(rect, panel, CALLOUT_CLEAR));
  if (clear(near)) return { dx, side: "near" };
  const onBoard = far.top >= 0 && far.top + far.height <= board.height;
  if (onBoard && clear(far)) return { dx, side: "far" };
  return { dx, side: "hidden" };
}

/**
 * How much of a box the open prompt panels cover, 0 to 1. A target mark under a panel is not drawn over it: the
 * ring would float on top of the question.
 */
export function coveredFraction(box: Box, panels: readonly Box[]): number {
  const area = box.width * box.height;
  if (area <= 0) return 0;
  let covered = 0;
  for (const panel of panels) {
    const w = Math.min(box.left + box.width, panel.left + panel.width) - Math.max(box.left, panel.left);
    const h = Math.min(box.top + box.height, panel.top + panel.height) - Math.max(box.top, panel.top);
    if (w > 0 && h > 0) covered += w * h;
  }
  return Math.min(1, covered / area);
}

/** Below this many px of free space left of the field, the stack is a row of numbered chips. At or above, a full panel. */
const GUTTER_FULL_MIN = 190;
const GUTTER_COMPACT_BELOW = 170;

/**
 * Which form the chain stack takes, from the free width left of the board's leftmost zone, pile or LP panel. The
 * two thresholds differ (hysteresis), so a gutter that sits on the line does not flip the stack every frame. A stack
 * that would meet an open prompt surface (`blocked`) is always the chips, which dodge it.
 */
export function chainStackSize(gutter: number, previous: "full" | "compact" | undefined, blocked = false): "full" | "compact" {
  if (blocked) return "compact";
  if (previous === "full") return gutter < GUTTER_COMPACT_BELOW ? "compact" : "full";
  if (previous === "compact") return gutter >= GUTTER_FULL_MIN ? "full" : "compact";
  return gutter >= GUTTER_FULL_MIN ? "full" : "compact";
}

/** What a screen reader says for one link, e.g. "Chain Link 2: Card, Opponent, negated. Effect text". */
export function chainLinkLabel(
  link: ChainLinkState,
  mySeat: number | null,
  playerName: (seat: number) => string,
  detail = true,
  named = false,
  partner: number | null = null,
): string {
  const parts = [chainCardName(link), chainSeatLabel(link.seat, mySeat, playerName, named)];
  if (detail) {
    if (link.status === "resolving") parts.push("resolving");
    if (link.negated) parts.push("negated");
    if (link.status === "resolved") parts.push("resolved");
  }
  const targets = chainTargetLabel(link, mySeat, playerName, { named, partner });
  const text = `Chain Link ${link.index}: ${parts.join(", ")}${targets ? `. ${targets}` : ""}`;
  return detail && link.description ? `${text}. ${link.description}` : text;
}

/** Who stands behind the words "your", "partner's" and "opponent's" when a target place is named. */
export type TargetNaming = {
  /** A table of 3 or 4: a rival reads by name, never "opponent's". */
  named?: boolean;
  /** The viewer's Tag partner: their zones read "partner's". */
  partner?: number | null;
};

/**
 * Where a link's targets are, as short place names ("your Field Zone", "Ryo Sato's Monster Zone 2"). Coordinates
 * only: looking up target names here could leak a face-down card's identity.
 */
export function chainTargetPlaces(
  link: ChainLinkState,
  mySeat: number | null,
  playerName: (seat: number) => string,
  naming: TargetNaming = {},
): string[] {
  return link.targets.map((zone) => {
    let whose: string;
    if (mySeat == null) whose = `${playerName(zone.controller)}'s `;
    else if (zone.controller === mySeat) whose = "your ";
    else if (naming.partner != null && zone.controller === naming.partner) whose = "partner's ";
    else whose = naming.named ? `${playerName(zone.controller)}'s ` : "opponent's ";
    let place: string;
    switch (zone.location) {
      case LOCATION_MZONE: place = zone.sequence >= 5 ? `Extra Monster Zone ${zone.sequence - 4}` : `Monster Zone ${zone.sequence + 1}`; break;
      case LOCATION_SZONE: place = zone.sequence === 5 ? "Field Zone" : zone.sequence >= 6 ? `Pendulum Zone ${zone.sequence - 5}` : `Spell & Trap Zone ${zone.sequence + 1}`; break;
      case LOCATION_GRAVE: place = `Graveyard card ${zone.sequence + 1}`; break;
      case LOCATION_REMOVED: place = `banished card ${zone.sequence + 1}`; break;
      case LOCATION_HAND: place = `hand card ${zone.sequence + 1}`; break;
      case LOCATION_DECK: place = "Deck"; break;
      case LOCATION_EXTRA: place = "Extra Deck"; break;
      default: place = `zone ${zone.location}:${zone.sequence}`;
    }
    return `${whose}${place}`;
  });
}

export function chainTargetLabel(
  link: ChainLinkState,
  mySeat: number | null,
  playerName: (seat: number) => string,
  naming: TargetNaming = {},
): string | null {
  if (link.targets.length === 0) return null;
  return `Chain Link ${link.index} targets ${chainTargetPlaces(link, mySeat, playerName, naming).join(", ")}`;
}

export type ChainFlow = {
  /** The card that activated. */
  source: string;
  /** What the engine says the effect does, or null when it sent no text or the card is unknown. */
  effect: string | null;
  /** Public target places, empty when the link has none. */
  targets: string[];
};

/**
 * One link as "source, then effect, then targets" for the stack. Only public data: the effect text of an activation
 * (the card is face-up on the chain once it activates), and target coordinates. An unknown card shows no effect
 * text, and a target never shows a card name.
 */
export function chainFlow(link: ChainLinkState, mySeat: number | null, playerName: (seat: number) => string, naming: TargetNaming = {}): ChainFlow {
  const known = link.name != null && link.name.trim() !== "";
  return {
    source: chainCardName(link),
    effect: known ? link.description?.trim() || null : null,
    targets: chainTargetPlaces(link, mySeat, playerName, naming),
  };
}

/**
 * The one sentence a live region should say for this step of the chain, or null when nothing the
 * player needs to hear changed.
 */
export function chainAnnouncement(
  prev: ChainState,
  next: ChainState,
  mySeat: number | null,
  playerName: (seat: number) => string,
  named = false,
  partner: number | null = null,
): string | null {
  if (next.links.length === 0) return prev.links.length > 0 ? "Chain ended" : null;
  const top = next.links[next.links.length - 1];
  const prevTop = prev.links[prev.links.length - 1];
  if (!prevTop || prevTop.index !== top.index || prevTop.code !== top.code) {
    return chainLinkLabel(top, mySeat, playerName, false, named, partner);
  }
  const targeted = next.links.find((link) => JSON.stringify(link.targets) !== JSON.stringify(prev.links[link.index - 1]?.targets));
  if (targeted) return chainTargetLabel(targeted, mySeat, playerName, { named, partner }) ?? `Chain Link ${targeted.index} has no current targets`;
  const negated = next.links.find((link) => link.negated && !prev.links[link.index - 1]?.negated);
  if (negated) return `Chain Link ${negated.index} was negated`;
  if (next.resolving != null && next.resolving !== prev.resolving) {
    const link = next.links[next.resolving - 1];
    return `Chain Link ${link.index} resolving: ${chainCardName(link)}, ${chainSeatLabel(link.seat, mySeat, playerName, named)}`;
  }
  return null;
}
