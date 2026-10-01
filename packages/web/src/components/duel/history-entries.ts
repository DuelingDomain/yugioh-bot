// Pure display mapping for the duel history list. No React, no DOM.
//
// history-model.ts folds engine events into tiles and separators. This module turns those into what the
// list draws: grouped by turn (newest first), each entry with an icon kind, thumbnails, signed LP numbers,
// the acting side and a full sentence for screen readers.
//
// Privacy: the server only sends card identity the viewer may see. On top of that, an opponent's Set card,
// face-down position change and drawn card never get a face here, and a spectator never sees a Set card.
import { formatLp } from "./constants";
import {
  isHiddenHistoryCard,
  type HistoryCard,
  type HistoryItem,
  type HistoryTile,
  type MoveDest,
} from "./history-model";

export type HistorySide = "you" | "opp";

export type HistoryIconKind =
  | "normal" | "tribute" | "special" | "flip" | "fusion" | "synchro" | "xyz" | "link" | "ritual" | "pendulum"
  | "set" | "activate" | "chain" | "attack" | "direct" | "destroy"
  | "banish" | "grave" | "draw" | "hand" | "deck"
  | "lp-loss" | "lp-gain" | "position" | "flip-up";

export interface HistoryThumb {
  role: "main" | "attacker" | "target" | "portrait";
  /** The card to inspect. Null for a card back or a portrait. */
  card: HistoryCard | null;
  /** The art to load. Null shows a card back (or the portrait). */
  code: number | null;
  name: string | null;
  struck: boolean;
  side: HistorySide;
}

export interface HistoryLpChange {
  side: HistorySide;
  seat: number;
  /** Negative for LP lost or paid, positive for LP gained. */
  delta: number;
  cause: "battle" | "effect" | "cost" | "heal";
  /** "-3,000" or "+1,000" */
  text: string;
}

export interface HistoryTag {
  label: string;
  tone: "chain" | "loss" | "quiet";
}

export interface HistoryEntry {
  type: "entry";
  key: number;
  lastEventId: number;
  icon: HistoryIconKind;
  side: HistorySide;
  actor: string;
  verb: string;
  /** The short line: card name, "Attacker → Target", or the player for LP rows. */
  title: string;
  /** One full sentence for screen readers. */
  sentence: string;
  thumbs: HistoryThumb[];
  lp: HistoryLpChange[];
  tags: HistoryTag[];
  negated: boolean;
  turn: number;
}

export interface HistoryPhaseRow {
  type: "phase";
  key: number;
  label: string;
  battle: boolean;
}

export type HistoryRow = HistoryEntry | HistoryPhaseRow;

export interface HistoryGroup {
  key: string;
  turn: number | null;
  seat: number | null;
  /** "Turn 3 · You" */
  label: string;
  /** Newest row first. */
  rows: HistoryRow[];
}

export interface HistoryView {
  /** Newest turn first. */
  groups: HistoryGroup[];
  /** Key of the newest entry (not phase row). Null when there is none. */
  latestKey: number | null;
  entryCount: number;
}

export interface HistoryViewOptions {
  mySeat: number | null;
  /** Display name for a seat ("You" for the viewer). */
  who: (seat: number | null) => string;
  seatCount?: number;
}

export function sideOf(seat: number | null, mySeat: number | null): HistorySide {
  if (seat == null) return "opp";
  if (mySeat == null) return seat === 0 ? "you" : "opp";
  return seat === mySeat ? "you" : "opp";
}

const SUMMON_VERB = {
  normal: "Normal Summon",
  tribute: "Tribute Summon",
  special: "Special Summon",
  flip: "Flip Summon",
  fusion: "Fusion Summon",
  synchro: "Synchro Summon",
  xyz: "Xyz Summon",
  link: "Link Summon",
  ritual: "Ritual Summon",
  pendulum: "Pendulum Summon",
} as const;

const SUMMON_PAST = {
  normal: "Normal Summoned",
  tribute: "Tribute Summoned",
  special: "Special Summoned",
  flip: "Flip Summoned",
  fusion: "Fusion Summoned",
  synchro: "Synchro Summoned",
  xyz: "Xyz Summoned",
  link: "Link Summoned",
  ritual: "Ritual Summoned",
  pendulum: "Pendulum Summoned",
} as const;

const CAUSE_LABEL = { battle: "battle damage", effect: "effect damage", cost: "LP paid" } as const;

const POS_FACEDOWN_ATTACK = 0x2;
const POS_FACEUP_DEFENSE = 0x4;
const POS_FACEDOWN_DEFENSE = 0x8;

function isFaceDownPosition(position: number | undefined): boolean {
  return position != null && (position & (POS_FACEDOWN_ATTACK | POS_FACEDOWN_DEFENSE)) !== 0;
}

function positionName(position: number | undefined): string {
  if (position == null) return "another position";
  if (position & POS_FACEDOWN_DEFENSE) return "face-down Defense";
  if (position & POS_FACEUP_DEFENSE) return "Defense";
  if (position & POS_FACEDOWN_ATTACK) return "face-down Attack";
  return "Attack";
}

function nameOf(card: HistoryCard | null | undefined): string | null {
  return card && !isHiddenHistoryCard(card) ? (card.name ?? null) : null;
}

/** May this card's face show for this tile? Identity must be present first; then the extra rules apply. */
function mayReveal(tile: HistoryTile, card: HistoryCard | null | undefined, mySeat: number | null): boolean {
  if (!card || isHiddenHistoryCard(card)) return false;
  const mine = mySeat != null && tile.seat === mySeat;
  switch (tile.kind) {
    case "set":
      return mine;
    case "position":
      return mine || !isFaceDownPosition(tile.position?.to);
    case "move":
      if (mine) return true;
      // The server only sends public cards; an opponent's draw and face-down moves stay backs on top of that.
      return !tile.move?.faceDown && tile.move?.reason !== "draw";
    default:
      return true;
  }
}

function thumbFor(tile: HistoryTile, card: HistoryCard | null | undefined, role: HistoryThumb["role"], side: HistorySide, mySeat: number | null, struck = false): HistoryThumb {
  const show = mayReveal(tile, card, mySeat);
  return {
    role,
    card: show ? (card ?? null) : null,
    code: show && card ? (card.code ?? null) : null,
    name: show ? nameOf(card) : null,
    struck,
    side,
  };
}

function destVerb(dest: MoveDest, reason: string, count: number): string {
  if (reason === "draw") return count > 1 ? `Draws ${count}` : "Draws";
  switch (dest) {
    case "grave":
      return reason === "discard" ? "Discards" : "To Graveyard";
    case "banished":
      return "Banishes";
    case "hand":
      return "To hand";
    case "deck":
      return "To Deck";
    case "extra":
      return "To Extra Deck";
    default:
      return "Moves";
  }
}

export function iconFor(tile: HistoryTile): HistoryIconKind {
  switch (tile.kind) {
    case "summon":
      return tile.summonKind ?? "normal";
    case "set":
      return "set";
    case "activate":
      return tile.chain && tile.chain.size > 1 ? "chain" : "activate";
    case "attack":
      return tile.target?.direct ? "direct" : "attack";
    case "damage":
      return "lp-loss";
    case "destroy":
      return "destroy";
    case "move":
      switch (tile.move?.dest) {
        case "grave":
          return "grave";
        case "banished":
          return "banish";
        case "hand":
          return tile.move.reason === "draw" ? "draw" : "hand";
        case "deck":
        case "extra":
          return "deck";
        default:
          return "hand";
      }
    case "position":
      return tile.position?.flip ? "flip-up" : "position";
    case "heal":
      return "lp-gain";
  }
}

function verbFor(tile: HistoryTile): string {
  switch (tile.kind) {
    case "summon":
      return SUMMON_VERB[tile.summonKind ?? "normal"];
    case "set":
      return "Set";
    case "activate":
      return "Activates";
    case "attack":
      return tile.target?.direct ? "Direct attack" : "Attacks";
    case "damage":
      return tile.hits[0]?.cause === "cost" ? "Pays LP" : "Takes damage";
    case "destroy":
      return "Destroyed";
    case "move":
      return destVerb(tile.move?.dest ?? "field", tile.move?.reason ?? "other", tile.move?.count ?? 1);
    case "position":
      return tile.position?.flip ? "Flips face-up" : `To ${positionName(tile.position?.to)}`;
    case "heal":
      return "Recovers LP";
  }
}

function titleFor(tile: HistoryTile, who: HistoryViewOptions["who"], mySeat: number | null): string {
  const name = mayReveal(tile, tile.card, mySeat) ? nameOf(tile.card) : null;
  switch (tile.kind) {
    case "attack": {
      const attacker = name ?? "Monster";
      if (tile.target?.direct) return `${attacker} → ${who(tile.target.seat)}`;
      return `${attacker} → ${nameOf(tile.target?.card) ?? "Monster"}`;
    }
    case "set":
      return name ?? "Face-down card";
    case "summon":
      return name ?? "Face-down monster";
    case "damage":
      return tile.hits[0] ? who(tile.hits[0].seat) : "Life Points";
    case "heal":
      return tile.gain ? who(tile.gain.seat) : "Life Points";
    case "move":
      if (tile.move?.reason === "draw") return name ?? (tile.move.count > 1 ? `${tile.move.count} cards` : "1 card");
      return name ?? "Card";
    default:
      return name ?? "Card";
  }
}

function sentenceFor(tile: HistoryTile, who: HistoryViewOptions["who"], mySeat: number | null): string {
  const actor = who(tile.seat);
  const name = mayReveal(tile, tile.card, mySeat) ? nameOf(tile.card) : null;
  const parts: string[] = [];
  switch (tile.kind) {
    case "summon":
      parts.push(`${actor} ${SUMMON_PAST[tile.summonKind ?? "normal"]} ${name ?? "a face-down monster"}.`);
      break;
    case "set":
      parts.push(name ? `${actor} Set ${name}.` : `${actor} Set a card.`);
      break;
    case "activate":
      parts.push(`${actor} activated ${name ?? "a card"}.`);
      if (tile.chain && tile.chain.size > 1) parts.push(`Chain link ${tile.chain.index} of ${tile.chain.size}.`);
      if (tile.chain?.status === "negated") parts.push("Negated.");
      else if (tile.chain?.status === "resolved") parts.push("Resolved.");
      else if (tile.chain?.status === "resolving") parts.push("Resolving.");
      break;
    case "attack": {
      const attacker = name ?? "a monster";
      if (tile.target?.direct) parts.push(`${actor} attacked directly with ${attacker}.`);
      else parts.push(`${actor} attacked ${nameOf(tile.target?.card) ?? "a monster"} with ${attacker}.`);
      break;
    }
    case "destroy":
      parts.push(`${name ?? "A card"} was destroyed.`);
      break;
    case "move": {
      const move = tile.move;
      if (move?.reason === "draw") {
        parts.push(move.count > 1 ? `${actor} drew ${move.count} cards.` : name ? `${actor} drew ${name}.` : `${actor} drew a card.`);
      } else {
        const what = name ?? "a card";
        const where = { grave: " to the Graveyard", hand: " to the hand", deck: " to the Deck", extra: " to the Extra Deck", banished: "", field: "" }[move?.dest ?? "field"];
        parts.push(move?.dest === "banished" ? `${actor} banished ${what}.` : `${actor} sent ${what}${where}.`);
      }
      break;
    }
    case "position":
      parts.push(tile.position?.flip
        ? `${name ?? "A card"} was flipped face-up.`
        : `${actor} changed ${name ?? "a monster"} to ${positionName(tile.position?.to)}.`);
      break;
    case "heal":
    case "damage":
      break;
  }
  for (const hit of tile.hits) parts.push(`${who(hit.seat)} took ${formatLp(hit.amount)} ${CAUSE_LABEL[hit.cause]}.`);
  if (tile.gain) parts.push(`${who(tile.gain.seat)} gained ${formatLp(tile.gain.amount)} LP.`);
  if (tile.kind !== "destroy") {
    for (const loss of tile.destroyed) parts.push(`${nameOf(loss.card) ?? "A card"} was destroyed.`);
  }
  return parts.join(" ");
}

function lpFor(tile: HistoryTile, mySeat: number | null): HistoryLpChange[] {
  const out: HistoryLpChange[] = tile.hits.map((hit) => ({
    side: sideOf(hit.seat, mySeat),
    seat: hit.seat,
    delta: -hit.amount,
    cause: hit.cause,
    text: `−${formatLp(hit.amount)}`,
  }));
  if (tile.gain) {
    out.push({
      side: sideOf(tile.gain.seat, mySeat),
      seat: tile.gain.seat,
      delta: tile.gain.amount,
      cause: "heal",
      text: `+${formatLp(tile.gain.amount)}`,
    });
  }
  return out;
}

function tagsFor(tile: HistoryTile): HistoryTag[] {
  const tags: HistoryTag[] = [];
  if (tile.chain && tile.chain.size > 1) tags.push({ label: `Chain ${tile.chain.index}`, tone: "chain" });
  if (tile.chain && tile.chain.status !== "pending") {
    const label = { resolving: "Resolving", resolved: "Resolved", negated: "Negated" }[tile.chain.status];
    tags.push({ label, tone: tile.chain.status === "negated" ? "loss" : "quiet" });
  }
  const destroyed = tile.kind === "destroy" ? 0 : tile.destroyed.length;
  if (destroyed > 0) tags.push({ label: destroyed > 1 ? `${destroyed} destroyed` : "Destroyed", tone: "loss" });
  if (tile.move && tile.move.count > 1) tags.push({ label: `×${tile.move.count}`, tone: "quiet" });
  return tags;
}

function thumbsFor(tile: HistoryTile, side: HistorySide, mySeat: number | null): HistoryThumb[] {
  switch (tile.kind) {
    case "attack": {
      const target = tile.target;
      const attackerStruck = tile.destroyed.some((loss) => loss.role === "attacker");
      const targetStruck = tile.destroyed.some((loss) => loss.role === "target");
      const targetSide = sideOf(target?.seat ?? null, mySeat);
      return [
        thumbFor(tile, tile.card, "attacker", side, mySeat, attackerStruck),
        target?.direct || !target?.card
          ? target?.direct
            ? { role: "portrait", card: null, code: null, name: null, struck: false, side: targetSide }
            : thumbFor(tile, null, "target", targetSide, mySeat, targetStruck)
          : thumbFor(tile, target.card, "target", targetSide, mySeat, targetStruck),
      ];
    }
    case "damage":
      return [{ role: "portrait", card: null, code: null, name: null, struck: false, side: sideOf(tile.hits[0]?.seat ?? tile.seat, mySeat) }];
    case "heal":
      return [{ role: "portrait", card: null, code: null, name: null, struck: false, side: sideOf(tile.gain?.seat ?? tile.seat, mySeat) }];
    case "destroy":
      return [thumbFor(tile, tile.card, "main", side, mySeat, true)];
    default:
      return [thumbFor(tile, tile.card, "main", side, mySeat)];
  }
}

/** One tile as a list entry. */
export function entryFor(tile: HistoryTile, options: HistoryViewOptions): HistoryEntry {
  const { mySeat, who } = options;
  const side = sideOf(tile.kind === "damage" ? (tile.hits[0]?.seat ?? tile.seat) : tile.kind === "heal" ? (tile.gain?.seat ?? tile.seat) : tile.seat, mySeat);
  return {
    type: "entry",
    key: tile.key,
    lastEventId: tile.lastEventId,
    icon: iconFor(tile),
    side,
    actor: who(tile.kind === "damage" ? (tile.hits[0]?.seat ?? tile.seat) : tile.kind === "heal" ? (tile.gain?.seat ?? tile.seat) : tile.seat),
    verb: verbFor(tile),
    title: titleFor(tile, who, mySeat),
    sentence: sentenceFor(tile, who, mySeat),
    thumbs: thumbsFor(tile, side, mySeat),
    lp: lpFor(tile, mySeat),
    tags: tagsFor(tile),
    negated: tile.chain?.status === "negated",
    turn: tile.turn,
  };
}

/**
 * Group model items by turn. Groups and rows come back newest first, so the list needs no reversing and
 * the newest entry sits at the top. Turn seats the model could not read (the window began mid-turn) are
 * worked out from any turn that has one, by parity.
 */
export function buildHistoryView(items: readonly HistoryItem[], options: HistoryViewOptions): HistoryView {
  const seatCount = Math.max(2, options.seatCount ?? 2);
  type Draft = { turn: number | null; seat: number | null; rows: HistoryRow[] };
  const drafts: Draft[] = [];
  const cursor: { current: Draft | null } = { current: null };
  let latestKey: number | null = null;
  let entryCount = 0;

  const open = (turn: number | null, seat: number | null) => {
    const draft: Draft = { turn, seat, rows: [] };
    cursor.current = draft;
    drafts.push(draft);
    return draft;
  };

  for (const item of items) {
    if (item.type === "sep") {
      if (item.turn != null) {
        open(item.turn, item.turnSeat ?? null);
      } else {
        const group = cursor.current ?? open(null, null);
        group.rows.push({ type: "phase", key: item.key, label: item.label, battle: /battle/i.test(item.label) });
      }
      continue;
    }
    const group = cursor.current && cursor.current.turn === item.turn ? cursor.current : open(item.turn, null);
    group.rows.push(entryFor(item, options));
    entryCount += 1;
    if (latestKey == null || item.key > latestKey) latestKey = item.key;
  }

  const known = drafts.find((draft) => draft.turn != null && draft.seat != null);
  const groups: HistoryGroup[] = [];
  for (const draft of drafts) {
    if (draft.rows.length === 0) continue;
    let seat = draft.seat;
    if (seat == null && draft.turn != null && known && known.turn != null && known.seat != null) {
      seat = (((known.seat + (draft.turn - known.turn)) % seatCount) + seatCount) % seatCount;
    }
    const label = draft.turn == null ? "Earlier" : seat == null ? `Turn ${draft.turn}` : `Turn ${draft.turn} · ${options.who(seat)}`;
    groups.push({
      key: `g${draft.turn ?? "x"}-${draft.rows[0].key}`,
      turn: draft.turn,
      seat,
      label,
      rows: draft.rows.slice().reverse(),
    });
  }
  groups.reverse();
  return { groups, latestKey, entryCount };
}
