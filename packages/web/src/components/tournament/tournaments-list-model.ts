/** Grouping and labels for the tournaments list (/tournaments). Pure, so it is easy to test. */

import type { ZoneState } from "@/components/sheet";
import { matchView } from "./matches/match-model";
import { buildStandings } from "./standings/standings-model";
import type { Match, Participant } from "./types";

export interface TournamentListItem {
  id: number;
  name: string;
  format: string;
  status: string;
  participantCount: number;
  webSlug?: string;
}

/**
 * One tournament as `/api/tournaments` returns it: the list shape plus fields the list does not use.
 * It has no pairings, so an appended row shows without a round strip or duel action.
 */
export type TournamentApiItem = TournamentListItem & { guildId?: string; createdByUserId?: number };

/** The one adapter from an API row to a page row; it drops the fields the list does not read. */
export function tournamentFromApi(item: TournamentApiItem): TournamentListItem {
  return {
    id: item.id,
    name: item.name,
    format: item.format,
    status: item.status,
    participantCount: item.participantCount,
    webSlug: item.webSlug ?? undefined,
  };
}

export interface TournamentGroups {
  running: TournamentListItem[];
  open: TournamentListItem[];
  finished: TournamentListItem[];
}

/**
 * Splits rows into running (active), open (pending) and finished (completed).
 * Each group keeps the order of the input, which the page query already sorts newest first.
 * Anything else (cancelled, unknown) stays off the list.
 */
export function groupTournaments(items: TournamentListItem[]): TournamentGroups {
  return {
    running: items.filter((t) => t.status === "active"),
    open: items.filter((t) => t.status === "pending"),
    finished: items.filter((t) => t.status === "completed"),
  };
}

export function tournamentHref(t: Pick<TournamentListItem, "id" | "webSlug">): string {
  return `/tournament/${t.webSlug ?? t.id}`;
}

export function formatLabel(format: string): string {
  if (format === "round_robin") return "Round robin";
  if (format === "single_elim") return "Single elimination";
  return format;
}

export function playersLabel(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

/** The header line: "2 in progress, 1 open to join, 14 finished". Zero counts are left out. */
export function listSummaryParts(groups: TournamentGroups): string[] {
  const parts: string[] = [];
  if (groups.running.length) parts.push(`${groups.running.length} in progress`);
  if (groups.open.length) parts.push(`${groups.open.length} open to join`);
  if (groups.finished.length) parts.push(`${groups.finished.length} finished`);
  return parts;
}

export const FINISHED_PREVIEW = 5;

/* ---------------------------------------------------------------------------
   Round strips and row actions. These work from the pairings the pages read
   (tournament_matches joined to matches), so they need no extra requests.
   --------------------------------------------------------------------------- */

export interface RoundsInput {
  format: string;
  status: string;
  participants: Participant[];
  matches: Match[];
}

export interface StripSlot {
  state: ZoneState;
  label: string;
  children?: string;
}

export interface RoundStrip {
  slots: StripSlot[];
  /** Rounds in the whole tournament. */
  total: number;
  /** First and last round shown (1-based). */
  from: number;
  to: number;
  /** The round the player has to play next, or null. */
  currentRound: number | null;
}

/** Most slots a list row draws. D's mock uses five. */
export const STRIP_MAX = 5;

export function initialsOf(name: string): string {
  const letters = [...name.trim()].slice(0, 2);
  if (letters.length === 0) return "";
  letters[0] = letters[0].toUpperCase();
  return letters.join("");
}

function isByeMatch(match: Match): boolean {
  return match.metadata?.bye === true || match.playerTwoId === null;
}

/** Rounds in the tournament: known from the pairings once it runs, worked out from the size before. */
export function roundCount(input: Pick<RoundsInput, "format" | "participants" | "matches">): number {
  const n = input.participants.length;
  const played = input.matches.reduce((max, m) => Math.max(max, m.roundNumber), 0);
  const knockout = n >= 2 ? Math.ceil(Math.log2(n)) : 0;
  if (input.format === "single_elim") return Math.max(played, knockout) || 3;
  if (played > 0) return played;
  if (n < 2) return 5;
  return n % 2 === 0 ? n - 1 : n;
}

/** The rounds a row shows: at most `max`, kept around the round in play. */
export function roundWindow(total: number, focus: number, max = STRIP_MAX): { from: number; to: number } {
  if (total <= max) return { from: 1, to: Math.max(total, 0) };
  const from = Math.min(Math.max(focus - 2, 1), total - max + 1);
  return { from, to: from + max - 1 };
}

function roundName(format: string, round: number, total: number): string {
  if (format === "single_elim" && total > 1) {
    if (round === total) return "final";
    if (round === total - 1) return "semifinal";
  }
  return `round ${round}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function playerMatches(matches: Match[], playerId: number): Match[] {
  return matches.filter((m) => m.playerOneId === playerId || m.playerTwoId === playerId);
}

/** Opponent of `playerId` in a match. */
function opponentOf(match: Match, playerId: number): { id: number | null; name: string } {
  return match.playerOneId === playerId
    ? { id: match.playerTwoId, name: match.playerTwoName ?? "Opponent" }
    : { id: match.playerOneId, name: match.playerOneName };
}

/**
 * The strip for one player: a slot per round. Won and lost rounds are cards, a bye is dashed,
 * the round they play next breathes, a result waiting to be confirmed is pending, and the rest
 * are empty outlines (with the opponent's initials where the pairing is known).
 */
export function buildRoundStrip(input: RoundsInput, playerId: number | null, max = STRIP_MAX): RoundStrip {
  const total = roundCount(input);
  const mine = playerId === null ? [] : playerMatches(input.matches, playerId);
  const upcoming = mine
    .filter((m) => m.status === "open" && !isByeMatch(m))
    .sort((a, b) => a.roundNumber - b.roundNumber)[0];
  const currentRound = upcoming?.roundNumber ?? null;
  const waiting = mine.find((m) => m.status === "pending_approval" && !isByeMatch(m))?.roundNumber ?? null;
  const decided = mine.filter((m) => m.status === "completed").reduce((hi, m) => Math.max(hi, m.roundNumber), 0);
  const focus = currentRound ?? waiting ?? Math.min(decided + 1, total);
  const { from, to } = roundWindow(total, focus, max);

  const slots: StripSlot[] = [];
  for (let round = from; round <= to; round += 1) {
    const name = roundName(input.format, round, total);
    const match = mine.find((m) => m.roundNumber === round);
    if (!match || playerId === null) {
      slots.push({ state: "empty", label: capital(name) });
      continue;
    }
    if (isByeMatch(match)) {
      slots.push({ state: "dashed", label: `${capital(name)}, bye` });
      continue;
    }
    const opp = opponentOf(match, playerId);
    const initials = initialsOf(opp.name);
    if (match.status === "completed") {
      if (match.winnerId === playerId) slots.push({ state: "won", label: `${capital(name)}, beat ${opp.name}`, children: initials });
      else if (match.winnerId !== null) slots.push({ state: "lost", label: `${capital(name)}, lost to ${opp.name}`, children: initials });
      else slots.push({ state: "empty", label: `${capital(name)}, no result` });
    } else if (match.status === "pending_approval") {
      slots.push({ state: "pending", label: `${capital(name)} against ${opp.name}, result waiting to be confirmed`, children: initials });
    } else if (round === currentRound) {
      slots.push({ state: "now", label: `${capital(name)}, playing ${opp.name}`, children: initials });
    } else {
      slots.push({ state: "empty", label: `${capital(name)}, against ${opp.name}`, children: initials });
    }
  }
  return { slots, total, from, to, currentRound };
}

/** "Round 3 of 5" for a running tournament: the lowest round with anything still undecided. */
export function currentRoundOf(input: Pick<RoundsInput, "format" | "participants" | "matches">): { round: number; total: number } | null {
  const total = roundCount(input);
  const open = input.matches
    .filter((m) => !isByeMatch(m) && m.status !== "completed")
    .reduce((lo, m) => Math.min(lo, m.roundNumber), Infinity);
  if (Number.isFinite(open)) return { round: open, total };
  if (input.matches.length === 0) return null;
  return { round: total, total };
}

/** Player whose strip a viewer sees when they are not in the tournament: most wins, fewest losses. */
export function leaderOf(input: Pick<RoundsInput, "participants" | "matches">): { playerId: number; displayName: string } | null {
  const [first] = buildStandings(input);
  if (!first || first.wins === 0) return null;
  return { playerId: first.playerId, displayName: first.displayName };
}

export type RowAction =
  | { kind: "open"; href: string }
  | { kind: "start"; match: Match }
  | { kind: "confirm"; match: Match }
  | { kind: "watch"; href: string };

/**
 * The one action a list row offers the viewer, in this order: their live match (Open duel),
 * a result waiting on them (Confirm and Deny), their match that has not started (Start duel),
 * then a single duel in progress they can watch (Watch).
 */
export function rowAction(input: RoundsInput, viewerId: number | null): RowAction | null {
  if (input.status !== "active") return null;
  const view = (match: Match) => matchView(match, viewerId, false, input);
  const mine = viewerId === null ? [] : playerMatches(input.matches, viewerId).sort((a, b) => a.roundNumber - b.roundNumber);
  const live = mine.find((m) => view(m).canOpen);
  if (live) return { kind: "open", href: `/duels/${live.series!.currentDuelSlug}` };
  const confirm = mine.find((m) => view(m).canConfirm);
  if (confirm) return { kind: "confirm", match: confirm };
  const start = mine.find((m) => view(m).canStart);
  if (start) return { kind: "start", match: start };
  const watchable = input.matches.filter(
    (m) => m.series?.status === "active" && m.series.currentDuelSlug && !(viewerId !== null && (m.playerOneId === viewerId || m.playerTwoId === viewerId)),
  );
  if (watchable.length === 1) return { kind: "watch", href: `/duels/${watchable[0].series!.currentDuelSlug}` };
  return null;
}
