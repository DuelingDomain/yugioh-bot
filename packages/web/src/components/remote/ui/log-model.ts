import type { RemoteAction, RemoteEvent, RemoteSystemAction } from "@yugidraft/shared/remote";
import { describeEvent, type LogKind } from "./describe";
import { PHASE_ABBR, deckIdsOf, hasDeck, notInDecklist } from "./model";
import type { ChainLink } from "./think-model";

/** The filter pills of the drawer log. `voice` is the spoken-command lines of this browser. `other` shows under All only. */
export type LogCat = "chain" | "move" | "lp" | "phase" | "voice" | "other";
export type LogFilter = "all" | Exclude<LogCat, "other">;

export type LogRow = {
  id: string; at: number; time: string; cat: LogCat; kind: LogKind;
  /** Who did it, for the name in the seat colour. Null for table lines. */
  actorSeat: number | null; actor: string | null;
  /** The plain action text without the actor name. */
  rest: string;
  cardId?: number; cardName?: string;
  /** Chain link number, for the CHAIN n pill. */
  chain?: number;
  /** A short label in the box where a card picture would be (phase, LP). */
  badge?: string;
  /** "8000 → 7000" for an LP row. */
  lp?: { from: number; to: number; seat: number };
  /** An identified card that the seat's decklist does not have. */
  notInDeck?: { seat: number; cardId: number };
  fresh: boolean;
};
export type LogTurn = { key: string; turn: number; seat: number | null; rows: LogRow[] };

const CAT: Record<string, LogCat> = {
  "effect.activated": "chain", "chain.respond": "chain", "chain.ok": "chain", "chain.thinking": "chain",
  "lp.change": "lp",
  "phase.set": "phase", "phase.advance": "phase", "turn.end": "phase", "table.started": "phase", "match.first": "phase",
};
const MOVES = /^(twin\.|card\.identified|cards\.identified|deck\.|pile\.|monsters\.|attack\.|effect\.(choose|announce))/;
const catOf = (type: string): LogCat => CAT[type] ?? (MOVES.test(type) ? "move" : "other");

export type LogInput = {
  events: readonly RemoteEvent[];
  /** Turn number and owner now. */
  turn: number; turnSeat: number;
  name: (seat: number) => string;
  cardName: (id: number | undefined) => string | undefined;
  refName: (seat: number, ref: string) => string | undefined;
  /** The card id of a twin that every player may see (face up, public, in a pile). */
  publicCode: (seat: number, ref: string) => number | undefined;
  chain: ReadonlyMap<string, ChainLink>;
  lpNow: (seat: number) => number;
  room: Parameters<typeof notInDecklist>[0];
  fmtTime: (at: number) => string;
  firstSeq: number;
  /** Spoken-command lines of this browser (kind VX). Their id is `vx:<ms>`. */
  voice: readonly { id: string; time: string; text: string }[];
};

/** The card a line is about: the picture in its thumbnail. Only public cards give an id. */
function cardOf(action: RemoteAction | RemoteSystemAction, input: LogInput): { id?: number; name?: string } {
  const a = action as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (action.type) {
    case "effect.activated": return { id: a.source?.cardId, name: a.source?.name };
    case "twin.place": return a.card?.token || a.card?.faceUp === false ? {} : { id: a.card?.cardId ?? a.card?.passcode, name: a.card?.name };
    case "card.identified": return { id: a.cardId ?? a.passcode, name: a.name };
    case "deck.add": return { id: a.cardId };
    case "twin.move": case "twin.flip": case "twin.attach": case "twin.detach": case "twin.remove": case "twin.control": {
      if (typeof a.seat !== "number" || typeof a.cardRef !== "string") return {};
      const id = input.publicCode(a.seat, a.cardRef); return id ? { id, name: input.refName(a.seat, a.cardRef) } : {};
    }
    default: return {};
  }
}

/** Plain text of one event without the actor name, split from the line `describeEvent` writes. A "Chain n: " lead is dropped too: the CHAIN n pill shows it. */
function split(line: string, actor: string | null) {
  const text = line.replace(/^Chain \d+: /, "");
  if (actor && text.startsWith(`${actor} `)) return text.slice(actor.length + 1);
  return text;
}

/**
 * The drawer log: turn groups, newest first. Turn numbers count back from the turn now (a turn.end belongs to the turn it ended).
 * A turn's owner is the seat that passed it; the turn now has `turnSeat`.
 */
export function buildLog(input: LogInput): LogTurn[] {
  const { events, name } = input;
  const sorted = [...events].sort((a, b) => b.seq - a.seq);
  const undone = new Set<string>();
  for (const event of events) if (event.action.type === "undo") undone.add(event.action.targetActionId);
  const lpRunning = new Map<number, number>();
  const turns: LogTurn[] = []; let cur = Math.max(1, input.turn);
  const groupFor = (turn: number, seat: number | null) => {
    let group = turns.find(item => item.turn === turn);
    if (!group) { group = { key: `t${turn}`, turn, seat, rows: [] }; turns.push(group); }
    else if (group.seat === null && seat !== null) group.seat = seat;
    return group;
  };
  groupFor(cur, input.turnSeat);
  const turnOfAt: { at: number; turn: number }[] = [];
  for (const event of sorted) {
    const action = event.action as RemoteAction | RemoteSystemAction;
    const ends = action.type === "turn.end" && !undone.has(event.id);
    if (ends) cur = Math.max(1, cur - 1);
    const group = groupFor(cur, ends ? event.actorSeat : null);
    turnOfAt.push({ at: event.at, turn: cur });
    const line = describeEvent(event, name, input.cardName, input.refName, input.chain.get(event.id));
    if (!line) continue;
    const actorSeat = action.type === "lp.change" ? action.seat : event.actorSeat;
    const actor = actorSeat === null ? null : name(actorSeat);
    const card = cardOf(action, input);
    const cardName = card.name ?? input.cardName(card.id);
    const row: LogRow = {
      id: event.id, at: event.at, time: input.fmtTime(event.at), cat: catOf(action.type), kind: line.kind, actorSeat, actor,
      rest: split(line.text, actor), cardId: card.id, cardName, fresh: event.seq > input.firstSeq,
    };
    if (action.type === "effect.activated") { const link = input.chain.get(event.id); row.chain = link?.n ?? 1; }
    if (action.type === "lp.change") {
      row.badge = "LP";
      const after = lpRunning.get(action.seat) ?? input.lpNow(action.seat);
      if (undone.has(event.id)) { lpRunning.set(action.seat, after); row.rest = `LP ${action.delta > 0 ? "+" : "−"}${Math.abs(action.delta)} · undone`; }
      else { const before = after - action.delta; lpRunning.set(action.seat, before); row.lp = { from: before, to: after, seat: action.seat }; row.rest = `LP ${before} → ${after}`; }
    } else if (action.type === "phase.set") row.badge = PHASE_ABBR[action.phase] ?? "PH";
    else if (action.type === "phase.advance") row.badge = "PH";
    else if (action.type === "turn.end") row.badge = "END";
    else if (row.cat === "phase" || row.cat === "other") row.badge = row.cat === "phase" ? "PH" : "·";
    else if (!card.id) row.badge = row.cat === "chain" ? "CH" : row.cat === "move" ? "·" : undefined;
    if (action.type === "card.identified" && card.id && notInDecklist(input.room, action.seat, card.id)) row.notInDeck = { seat: action.seat, cardId: card.id };
    group.rows.push(row);
  }
  // Spoken-command lines go to the turn that was running when they were said.
  for (const entry of input.voice) {
    const at = Number(entry.id.split(":")[1]) || 0;
    const turn = turnOfAt.find(item => item.at <= at)?.turn ?? Math.max(1, input.turn);
    const group = turns.find(item => item.turn === turn) ?? turns[0];
    group.rows.push({ id: entry.id, at, time: entry.time, cat: "voice", kind: "VX", actorSeat: null, actor: null, rest: entry.text, badge: "VX", fresh: true });
  }
  for (const group of turns) group.rows.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  return turns.sort((a, b) => b.turn - a.turn);
}

export { deckIdsOf, hasDeck };
