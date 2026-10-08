// What the "Now resolving" panel says: the effect text of a link, what happened when it resolved, and the
// rows around it. Pure: no React, no DOM, no timers. Only data the viewer may already see goes in:
//  - the name and printed text of a link come from its activation (public: the card is face-up on the chain);
//  - an outcome names a card only when the event carries it (the server projects events per viewer, so a
//    face-down or hidden card reaches the client without a name);
//  - a target is named only when the viewer's redacted board shows it face-up. A passcode is never rendered.
import type { DuelCard, DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { chainEffectText, chainFullText, chainKindLabel, type EffectText, type FullEffectText } from "./chain-effect-text";
import {
  LOCATION_GRAVE,
  LOCATION_MZONE,
  LOCATION_REMOVED,
  LOCATION_SZONE,
  zoneKey,
} from "./constants";
import {
  chainCardName,
  chainSeatLabel,
  chainTargetPlaces,
  type ChainLinkState,
  type ChainState,
  type TargetNaming,
} from "./chain-state";

// ---------------------------------------------------------------------------------------------------------------
// Targets: names only for cards that are face-up and public
// ---------------------------------------------------------------------------------------------------------------

const FACEDOWN = 0x2 | 0x8;

function cardAt(zone: DuelZoneRef, seats: readonly DuelSeatView[]): DuelCard | null {
  const seat = seats.find((candidate) => candidate.seat === zone.controller);
  if (!seat) return null;
  switch (zone.location) {
    case LOCATION_MZONE: return seat.monsters[zone.sequence] ?? null;
    case LOCATION_SZONE: return seat.spells[zone.sequence] ?? null;
    case LOCATION_GRAVE: return seat.graveyard.find((card) => card.sequence === zone.sequence) ?? null;
    case LOCATION_REMOVED: return seat.banished.find((card) => card.sequence === zone.sequence) ?? null;
    // A hand, a Deck and an Extra Deck are never public, even when this viewer may look at their own.
    default: return null;
  }
}

/**
 * The name of the card standing at a target zone, or null. Only a card the whole table can see counts: it has a
 * name in this viewer's projection and it is not face-down (a viewer's own Set card is not public either).
 */
export function publicTargetName(zone: DuelZoneRef, seats: readonly DuelSeatView[] | undefined): string | null {
  if (!seats) return null;
  const card = cardAt(zone, seats);
  if (!card || !card.name?.trim()) return null;
  if ((card.position & FACEDOWN) !== 0) return null;
  return card.name.trim();
}

/**
 * Remembers the public name of each target while it can be seen, so "Targets Gaia" survives the moment the target is
 * destroyed and its zone is empty. Cleared when the chain is. Only names that passed publicTargetName are stored.
 */
export type TargetMemory = Map<string, string>;

export function rememberTargetNames(memory: TargetMemory, links: readonly ChainLinkState[], seats: readonly DuelSeatView[] | undefined): void {
  for (const link of links) {
    for (const zone of link.targets) {
      const name = publicTargetName(zone, seats);
      if (name != null) memory.set(`${link.index}:${zoneKey(zone.controller, zone.location, zone.sequence)}`, name);
    }
  }
}

export interface HeroTarget {
  /** null: not a public card (face-down, in a hand, unknown), so only the place is said. */
  name: string | null;
  place: string;
}

export function chainHeroTargets(
  link: ChainLinkState,
  memory: TargetMemory,
  who: Who,
): HeroTarget[] {
  const places = chainTargetPlaces(link, who.mySeat, who.playerName, who.naming);
  return link.targets.map((zone, i) => ({
    name: memory.get(`${link.index}:${zoneKey(zone.controller, zone.location, zone.sequence)}`) ?? null,
    place: places[i],
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes: what happened when a link resolved
// ---------------------------------------------------------------------------------------------------------------

export interface Who {
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** A table of 3 or 4: a rival reads by name. */
  named?: boolean;
  naming?: TargetNaming;
}

export interface LinkOutcome {
  /** What the hero says, one line per effect (at most three). */
  lines: string[];
  /** The one-line version for the stack row. */
  row: string;
  /** "neg": the link was negated. "ok": the effect did something. "quiet": nothing to report but that it resolved. */
  tone: "neg" | "ok" | "quiet";
}

interface LinkWindow {
  resolving: number;
  resolved: number;
}

const SUMMON_VERB: Record<string, string> = {
  normal: "Summoned", tribute: "Summoned", flip: "Flip Summoned", fusion: "Fusion Summoned", synchro: "Synchro Summoned",
  xyz: "Xyz Summoned", link: "Link Summoned", ritual: "Ritual Summoned", pendulum: "Pendulum Summoned", special: "Special Summoned",
};

function listCards(verb: string, names: Array<string | null>): string {
  if (names.length === 1) return `${verb} ${names[0] ?? "a card"}`;
  if (names.every((name) => name != null)) {
    const known = names as string[];
    return known.length === 2 ? `${verb} ${known[0]} and ${known[1]}` : `${verb} ${known[0]} and ${known.length - 1} others`;
  }
  return `${verb} ${names.length} cards`;
}

const isDestroy = (event: DuelEvent): boolean =>
  event.kind === "destroy" || (event.kind === "move" && event.reason === "destroy");

/** The events of the chain that is open now (or just closed): from the latest Chain Link 1, including late notes after its end. */
function lastChainEvents(events: readonly DuelEvent[]): DuelEvent[] {
  const ordered = events.slice().sort((a, b) => a.id - b.id);
  let from = 0;
  ordered.forEach((event, i) => {
    if (event.kind === "activate" && event.chainIndex === 1) from = i;
  });
  return ordered.slice(from);
}

/**
 * What each link of the open chain did, from the events of the window. Chain events carry the order; every other
 * event is attributed to the link that was resolving when it happened (between its "chain-resolving" and
 * "chain-resolved"), and a destroy that arrives late is attributed by the card that caused it. A negation is
 * reported on the negated link ("Negated by ...") and on the link that negated it ("Negated ...").
 */
export function chainOutcomes(events: readonly DuelEvent[], state: ChainState, who: Who): Map<number, LinkOutcome> {
  const out = new Map<number, LinkOutcome>();
  if (state.links.length === 0) return out;
  const chain = lastChainEvents(events);
  const windows = new Map<number, LinkWindow>();
  const negations: Array<{ id: number; index: number; by: number | null }> = [];
  const open: number[] = [];
  for (const event of chain) {
    const index = event.chainIndex;
    if (event.kind === "chain-resolving" && index != null) {
      windows.set(index, { resolving: event.id, resolved: Number.POSITIVE_INFINITY });
      open.push(index);
    } else if (event.kind === "chain-resolved" && index != null) {
      const win = windows.get(index);
      if (win) win.resolved = event.id;
      const at = open.lastIndexOf(index);
      if (at >= 0) open.splice(at, 1);
    } else if (event.kind === "chain-negated" && index != null) {
      // The engine reports a negation while the negating link resolves, naming the negated one.
      const by = open.length > 0 ? open[open.length - 1] : null;
      negations.push({ id: event.id, index, by: by === index ? null : by });
    }
  }
  const byIndex = new Map(state.links.map((link) => [link.index, link]));
  const used = new Set<number>();
  const loopOrder = state.links.map((link) => link.index).sort((a, b) => b - a);
  const nameOf = (index: number): string | null => {
    const link = byIndex.get(index);
    return link?.name?.trim() ? link.name.trim() : null;
  };
  const sameCard = (event: DuelEvent, link: ChainLinkState): boolean =>
    (event.card != null && link.code != null && event.card.code === link.code) ||
    (event.zone != null && link.zone != null && zoneKey(event.zone.controller, event.zone.location, event.zone.sequence) === zoneKey(link.zone.controller, link.zone.location, link.zone.sequence));

  const negatedBy = new Map<number, number | null>();
  for (const negation of negations) negatedBy.set(negation.index, negation.by);
  // Negated links the negating link also destroyed. The negator resolves first (it is higher in the chain), so
  // the set is complete when the negated link reports.
  const destroyedByNegator = new Set<number>();

  for (const index of loopOrder) {
    const link = byIndex.get(index)!;
    const win = windows.get(index);
    // The next link down resolves after this one: a late note for this card can only land before it.
    const lateEnd = windows.get(index - 1)?.resolving ?? Number.POSITIVE_INFINITY;
    const mine: DuelEvent[] = [];
    if (win) {
      for (const event of chain) {
        if (used.has(event.id)) continue;
        if (event.kind === "chain-resolving" || event.kind === "chain-resolved" || event.kind === "chain-negated" || event.kind === "chain-end" || event.kind === "activate" || event.kind === "target") continue;
        const inside = event.id > win.resolving && event.id < win.resolved;
        const late = event.id >= win.resolved && event.id < lateEnd && isDestroy(event) && event.sourceCode != null && event.sourceCode === link.code;
        if (inside || late) mine.push(event);
      }
    }
    const lines: string[] = [];

    // Cards this link negated, and whether it destroyed them as well.
    for (const negation of negations.filter((candidate) => candidate.by === index)) {
      const target = byIndex.get(negation.index);
      if (!target) continue;
      const at = mine.findIndex((event) => isDestroy(event) && sameCard(event, target));
      if (at >= 0) {
        used.add(mine[at].id);
        mine.splice(at, 1);
        destroyedByNegator.add(negation.index);
      }
      lines.push(`Negated ${nameOf(negation.index) ?? `Chain Link ${negation.index}`}${at >= 0 ? " and destroyed it" : ""}`);
    }

    if (negatedBy.has(index) || link.negated) {
      // A negated link did nothing of its own; whatever moved around it is its cleanup.
      for (const event of mine) used.add(event.id);
      const negator = negatedBy.get(index) ?? null;
      const negatorName = negator != null ? nameOf(negator) : null;
      const hero = negator != null
        ? `Negated by ${negatorName ?? `Chain Link ${negator}`}${destroyedByNegator.has(index) ? ", then destroyed" : ""}`
        : "Negated";
      out.set(index, { lines: [hero], row: negator != null ? `Negated by Chain Link ${negator}` : "Negated", tone: "neg" });
      continue;
    }

    lines.push(...effectLines(mine, link, who));
    for (const event of mine) used.add(event.id);
    if (lines.length === 0) {
      out.set(index, { lines: ["Resolved"], row: "Resolved", tone: "quiet" });
    } else {
      const kept = lines.slice(0, 3);
      out.set(index, { lines: kept, row: kept[0], tone: "ok" });
    }
  }
  return out;
}

function sameZone(a: DuelZoneRef, b: DuelZoneRef | null): boolean {
  return b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
}

/** The lines for the effects of one link: destroyed, sent, banished, returned, summoned, damage, recovered. */
function effectLines(events: readonly DuelEvent[], link: ChainLinkState, who: Who): string[] {
  const destroyed: Array<string | null> = [];
  const graveyard: Array<string | null> = [];
  const banished: Array<string | null> = [];
  const toHand: Array<string | null> = [];
  // Cards that reach a hand, per seat (the seat the card goes to), in the order the seats first appear.
  const added = new Map<number, Array<string | null>>();
  const drawn = new Map<number, number>();
  const toDeck: Array<string | null> = [];
  const summoned: Array<{ verb: string; name: string | null }> = [];
  const damage: string[] = [];
  const recovered: string[] = [];
  const destroyEvents = events.filter((event) => event.kind === "destroy");
  for (const event of events) {
    const name = event.card?.name?.trim() || null;
    if (event.kind === "destroy") {
      destroyed.push(name);
    } else if (event.kind === "move") {
      // The source card leaving its own zone for the Graveyard after its effect is cleanup, not what the effect did. A
      // card of the same name that is drawn or searched (Pot of Greed drawing a Pot of Greed) is an effect. Old events carry
      // no link zone, so there the card's own move is skipped as before.
      if (event.card != null && link.code != null && event.card.code === link.code && (event.from == null || link.zone == null || sameZone(event.from, link.zone))) continue;
      if (event.reason === "destroy") {
        if (destroyEvents.length === 0) destroyed.push(name);
        continue;
      }
      const to = event.zone?.location;
      if (to === LOCATION_GRAVE) graveyard.push(name);
      else if (to === LOCATION_REMOVED) banished.push(name);
      else if (to === 0x2) {
        // The hand is the card's way in: a draw, a card fetched from the Deck, Graveyard or banished pile, or a bounce from the field.
        const from = event.from?.location;
        const seat = event.zone?.controller ?? link.seat;
        if (event.reason === "draw") drawn.set(seat, (drawn.get(seat) ?? 0) + 1);
        else if (from === LOCATION_MZONE || from === LOCATION_SZONE) toHand.push(name);
        else added.set(seat, [...(added.get(seat) ?? []), name]);
      }
      else if (to === 0x1 || to === 0x40) toDeck.push(name);
    } else if (event.kind === "summon") {
      summoned.push({ verb: SUMMON_VERB[event.summonKind ?? "special"] ?? "Special Summoned", name });
    } else if (event.kind === "damage") {
      if (event.cause === "battle" || event.cause === "cost" || !event.amount || event.seat == null) continue;
      damage.push(`${chainSeatLabel(event.seat, who.mySeat, who.playerName, who.named)} took ${event.amount} damage`);
    } else if (event.kind === "recover") {
      if (!event.amount || event.seat == null) continue;
      recovered.push(event.seat === link.seat ? `Gained ${event.amount} LP` : `${chainSeatLabel(event.seat, who.mySeat, who.playerName, who.named)} gained ${event.amount} LP`);
    }
  }
  const lines: string[] = [];
  if (destroyed.length > 0) lines.push(listCards("Destroyed", destroyed));
  if (graveyard.length > 0) lines.push(`${listCards("Sent", graveyard)} to the Graveyard`);
  if (banished.length > 0) lines.push(listCards("Banished", banished));
  // The link's owner "Drew 2 cards"; another seat is named, like the damage lines.
  for (const [seat, count] of drawn) {
    const label = seat === link.seat ? "Drew" : `${chainSeatLabel(seat, who.mySeat, who.playerName, who.named)} drew`;
    lines.push(`${label} ${count} ${count === 1 ? "card" : "cards"}`);
  }
  // A card the effect searched or recovered ("Added"), against one it bounced back from the field ("Returned").
  for (const [seat, cards] of added) {
    const label = seat === link.seat ? "Added" : `${chainSeatLabel(seat, who.mySeat, who.playerName, who.named)} added`;
    lines.push(`${listCards(label, cards)} to the hand`);
  }
  if (toHand.length > 0) lines.push(`${listCards("Returned", toHand)} to the hand`);
  if (toDeck.length > 0) lines.push(`${listCards("Returned", toDeck)} to the Deck`);
  for (const item of summoned) lines.push(`${item.verb} ${item.name ?? "a card"}`);
  lines.push(...damage, ...recovered);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------------------------

export type PanelTone = "wait" | "now" | "neg" | "done";

export interface HeroView {
  index: number;
  total: number;
  tone: PanelTone;
  /** "Activated", "Now resolving", "Negated" or "Just resolved". */
  eyebrow: string;
  name: string;
  /** "You" / "Opponent" / a player's name. */
  owner: string;
  seat: number;
  /** "Normal Trap". */
  kind: string | null;
  /** Art source. null for a card the client does not know: no art, no passcode. */
  code: number | null;
  effect: EffectText | null;
  /** The full text for the panel: the engine's words for this activation and every printed line. null when there is none. */
  full: FullEffectText | null;
  targets: HeroTarget[];
  /** The text of each option the link's player chose; public to every seat. Empty when none was chosen. */
  chosen: string[];
  /** The result of the link, or null when it is not known yet (the link is waiting or just started). */
  outcome: LinkOutcome | null;
  /** The link is resolving and has not reported a result yet. */
  waiting: boolean;
  status: ChainLinkState["status"];
  negated: boolean;
}

export interface RowView {
  index: number;
  name: string;
  owner: string;
  seat: number;
  tone: PanelTone;
  code: number | null;
  /** The one-line result, once the link has one to show. */
  result: string | null;
  /** What the link will do, one line, for a link that has not resolved yet. null when unknown. */
  effect: string | null;
  status: ChainLinkState["status"];
  negated: boolean;
  mine: boolean;
  isHero: boolean;
}

export interface PanelView {
  hero: HeroView;
  /** Top of the chain first: the order links resolve in. */
  rows: RowView[];
  /** The full detail of every link, in the same order as rows: what each one does, who played it and what it targets. */
  details: HeroView[];
  /** One per link, Chain Link 1 first. */
  pips: PanelTone[];
  total: number;
}

export function linkTone(link: Pick<ChainLinkState, "status" | "negated">): PanelTone {
  if (link.negated) return "neg";
  if (link.status === "resolving") return "now";
  if (link.status === "resolved") return "done";
  return "wait";
}

const EYEBROW: Record<PanelTone, string> = { wait: "Activated", now: "Now resolving", neg: "Negated", done: "Just resolved" };
/** A chain of one is a lone effect: it is not "Just resolved" from a chain. */
const SINGLE_EYEBROW: Record<PanelTone, string> = { wait: "Activated", now: "Resolving", neg: "Negated", done: "Resolved" };

export interface PanelInput {
  state: ChainState;
  /** The link the hero is about (chainFocusLink). */
  focus: ChainLinkState;
  outcomes: ReadonlyMap<number, LinkOutcome>;
  /** The resolving link may show its result: its effect has had time to play. A resolved or negated link always may. */
  resultsReady: boolean;
  targets: TargetMemory;
  who: Who;
}

export function buildPanelView(input: PanelInput): PanelView {
  const { state, focus, outcomes, resultsReady, targets, who } = input;
  const total = state.links.length;
  const known = (link: ChainLinkState): boolean => link.name != null && link.name.trim() !== "";
  const showResult = (link: ChainLinkState): boolean =>
    link.status === "resolved" || link.negated || (link.status === "resolving" && resultsReady && link.index === state.resolving);
  const heroFor = (link: ChainLinkState): HeroView => {
    const tone = linkTone(link);
    const found = showResult(link) ? outcomes.get(link.index) ?? null : null;
    // "Resolved" says nothing the eyebrow will not say a beat later, so while the link is still resolving it keeps "Resolving...".
    const outcome = found != null && found.tone === "quiet" && link.status === "resolving" ? null : found;
    return {
      index: link.index,
      total,
      tone,
      eyebrow: (total === 1 ? SINGLE_EYEBROW : EYEBROW)[tone],
      name: chainCardName(link),
      owner: chainSeatLabel(link.seat, who.mySeat, who.playerName, who.named),
      seat: link.seat,
      kind: known(link) ? chainKindLabel(link.cardType) : null,
      code: known(link) ? link.code : null,
      effect: chainEffectText(link),
      full: chainFullText(link),
      targets: chainHeroTargets(link, targets, who),
      // Behind the same gate as the name, the text and the bullets: nothing of an unknown card shows.
      chosen: known(link) ? [...new Set((link.chosenOptions ?? []).map((option) => option.text.trim()).filter((text) => text !== ""))] : [],
      outcome,
      waiting: link.status === "resolving" && outcome == null,
      status: link.status,
      negated: link.negated,
    };
  };
  const hero = heroFor(focus);
  const rows = state.links
    .slice()
    .sort((a, b) => b.index - a.index)
    .map((link): RowView => ({
      index: link.index,
      name: chainCardName(link),
      owner: chainSeatLabel(link.seat, who.mySeat, who.playerName, who.named),
      seat: link.seat,
      tone: linkTone(link),
      code: known(link) ? link.code : null,
      result: showResult(link) && link.index !== focus.index ? outcomes.get(link.index)?.row ?? null : null,
      effect: chainEffectText(link)?.text ?? null,
      status: link.status,
      negated: link.negated,
      mine: who.mySeat != null && link.seat === who.mySeat,
      isHero: link.index === focus.index,
    }));
  const details = state.links.slice().sort((a, b) => b.index - a.index).map((link) => (link.index === focus.index ? hero : heroFor(link)));
  return { hero, rows, details, pips: state.links.map(linkTone), total };
}

export interface StripView {
  index: number;
  total: number;
  name: string;
  /** "Resolving", "Activated", "Negated", "Resolved". */
  stateLabel: string;
  tone: PanelTone;
  /** The effect, or the result when there is one. One line, cut by the layout. */
  summary: string;
}

const STATE_LABEL: Record<PanelTone, string> = { wait: "Activated", now: "Resolving", neg: "Negated", done: "Resolved" };

export function buildStripView(view: PanelView): StripView {
  const { hero } = view;
  const summary = hero.outcome ? hero.outcome.lines[0] : hero.effect?.text ?? "";
  return { index: hero.index, total: hero.total, name: hero.name, stateLabel: STATE_LABEL[hero.tone], tone: hero.tone, summary };
}

/** The label of the strip button for a screen reader. */
export function stripLabel(view: StripView): string {
  const base = `Chain Link ${view.index} of ${view.total}: ${view.name}, ${view.stateLabel.toLowerCase()}`;
  return `${base}${view.summary ? `. ${view.summary}` : ""}. Show chain details`;
}

/**
 * Does the local player have an open prompt (a pick, an option, a yes/no) that is not the chain response window? The
 * panel then shrinks to its compact form, so the prompt's own windows (the card peek) have the room to read a card.
 */
export function ownPromptOpen(prompt: { seat: number; context?: { type?: string } | null } | null | undefined, mySeat: number | null): boolean {
  return prompt != null && mySeat != null && prompt.seat === mySeat && prompt.context?.type !== "chain";
}
