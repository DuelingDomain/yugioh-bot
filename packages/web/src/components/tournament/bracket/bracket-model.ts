import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";
import { isSeriesOpen, seriesScore } from "../duel-rules";
import type { Match, TournamentDetail } from "../types";

/**
 * The bracket is computed, never stored. The engine pairs round 1 from the join order and each later
 * round from the previous round's winners in `tournament_matches.id` order, both through
 * `generateSingleElimFirstRound`. Running the same function over slot positions tells us where every
 * winner will go before the round exists, so the drawing and the engine cannot disagree.
 */

export type BracketSide =
  | { kind: "player"; playerId: number; name: string; seed: number | null; score: number | null; won: boolean | null }
  | { kind: "from"; label: string };

export interface BracketSlot {
  /** Position in the round in engine (id) order. */
  index: number;
  round: number;
  match: Match | null;
  a: BracketSide;
  /** Null for a bye. */
  b: BracketSide | null;
  bye: boolean;
  state: "done" | "live" | "wait" | "open" | "tbd";
  winnerId: number | null;
}

export interface BracketRound {
  number: number;
  /** "Quarterfinals", "Semifinals", "Final", else "Round 2". */
  name: string;
  /** "Quarters", "Semis", "Final", else "Round 2". */
  short: string;
  /** Station code: QF, SF, F, R1. */
  code: string;
  /** "Quarterfinal", used in "Winner plays the other quarterfinal's winner". */
  singular: string;
  /** Slots in engine order. */
  slots: BracketSlot[];
  /** Groups of slots that feed one slot of the next round, in display order. */
  groups: BracketSlot[][];
  paired: boolean;
  done: number;
}

export function roundCount(players: number): number {
  let rounds = 0;
  for (let n = players; n > 1; n = Math.ceil(n / 2)) rounds += 1;
  return rounds;
}

function names(round: number, total: number) {
  const fromEnd = total - round;
  if (fromEnd === 0) return { name: "Final", short: "Final", code: "F", singular: "final" };
  if (fromEnd === 1) return { name: "Semifinals", short: "Semis", code: "SF", singular: "semifinal" };
  if (fromEnd === 2) return { name: "Quarterfinals", short: "Quarters", code: "QF", singular: "quarterfinal" };
  return { name: `Round ${round}`, short: `Round ${round}`, code: `R${round}`, singular: `round ${round} match` };
}

/** For each slot of a round of `count` slots, which slots of the round before feed it. */
export function feeders(count: number): number[][] {
  const order = Array.from({ length: count }, (_, i) => i);
  const { byes, pairings } = generateSingleElimFirstRound(order);
  // The engine inserts byes before pairings, so byes come first in id order.
  return [...byes.map((id) => [id]), ...pairings.map((p) => [p.playerOneId, p.playerTwoId as number])];
}

function gameScores(match: Match): [number, number] | null {
  if (!match.series) return null;
  if (!isSeriesOpen(match.series) && !(match.status === "completed" && match.series.status === "completed")) return null;
  const [one, two] = seriesScore(match.series, match);
  return [one, two];
}

export function buildBracket(tournament: Pick<TournamentDetail, "participants" | "matches">): BracketRound[] {
  const players = tournament.participants;
  const total = roundCount(players.length);
  if (total === 0) return [];
  const seeds = new Map(players.map((p, i) => [p.playerId, i + 1]));
  const nameOf = new Map(players.map((p) => [p.playerId, p.displayName]));

  const byRound = new Map<number, Match[]>();
  for (const match of [...tournament.matches].sort((x, y) => x.id - y.id)) {
    byRound.set(match.roundNumber, [...(byRound.get(match.roundNumber) ?? []), match]);
  }

  const counts: number[] = [];
  for (let r = 1, n = players.length; r <= total; r += 1, n = Math.ceil(n / 2)) counts.push(Math.ceil(n / 2));
  const sources: number[][][] = counts.map((count, r) => (r === 0 ? [] : feeders(counts[r - 1]).slice(0, count)));

  const rounds: BracketRound[] = [];
  for (let r = 1; r <= total; r += 1) {
    const label = names(r, total);
    const actual = byRound.get(r) ?? [];
    const slots: BracketSlot[] = [];
    for (let index = 0; index < counts[r - 1]; index += 1) {
      const match = actual[index] ?? null;
      const side = (playerId: number | null, fallback: BracketSide): BracketSide => {
        if (playerId === null) return fallback;
        return { kind: "player", playerId, name: nameOf.get(playerId) ?? "Player", seed: r === 1 ? seeds.get(playerId) ?? null : null, score: null, won: null };
      };
      if (match) {
        const bye = match.metadata?.bye === true || match.playerTwoId === null;
        const scores = gameScores(match);
        const a = side(match.playerOneId, { kind: "from", label: "TBD" });
        const b = bye ? null : side(match.playerTwoId, { kind: "from", label: "TBD" });
        const done = match.status === "completed" && match.winnerId !== null;
        if (a.kind === "player") { a.score = scores ? scores[0] : null; a.won = done ? match.winnerId === a.playerId : null; }
        if (b?.kind === "player") { b.score = scores ? scores[1] : null; b.won = done ? match.winnerId === b.playerId : null; }
        if (bye && a.kind === "player") a.won = true;
        const state: BracketSlot["state"] = bye || done ? "done"
          : isSeriesOpen(match.series) ? "live"
          : match.status === "pending_approval" || match.status === "pending" ? "wait" : "open";
        slots.push({ index, round: r, match, a, b, bye, state, winnerId: bye ? match.playerOneId : done ? match.winnerId : null });
      } else {
        // Not paired yet: draw "Winner of ..." boxes from the previous round's slots.
        const from = sources[r - 1]?.[index] ?? [];
        const sides = from.map((s): BracketSide => {
          const previous = rounds[r - 2].slots[s];
          if (previous.winnerId !== null) return side(previous.winnerId, { kind: "from", label: "TBD" });
          const pa = previous.a.kind === "player" ? previous.a.name : null;
          const pb = previous.b?.kind === "player" ? previous.b.name : null;
          const prevLabel = names(r - 1, total);
          return { kind: "from", label: pa && pb ? `Winner of ${pa} – ${pb}` : `Winner of ${prevLabel.singular} ${s + 1}` };
        });
        const bye = sides.length === 1;
        slots.push({ index, round: r, match: null, a: sides[0] ?? { kind: "from", label: "TBD" }, b: bye ? null : sides[1] ?? { kind: "from", label: "TBD" }, bye, state: "tbd", winnerId: null });
      }
    }
    rounds.push({ number: r, ...label, slots, groups: [], paired: actual.length > 0, done: slots.filter((s) => s.state === "done").length });
  }

  // Display order: counted back from the final, each group is the pair that feeds one later slot.
  let order: number[][] = [[0]];
  for (let r = total; r >= 1; r -= 1) {
    rounds[r - 1].groups = order.map((group) => group.map((i) => rounds[r - 1].slots[i]));
    order = r === 1 ? [] : order.flatMap((group) => group.map((i) => sources[r - 1][i]));
  }
  return rounds;
}

/** The round the page opens on: the first with a match still to finish, else the final. */
export function currentBracketRound(rounds: BracketRound[]): number {
  const open = rounds.find((round) => round.slots.some((slot) => slot.state !== "done" && slot.state !== "tbd"));
  if (open) return open.number;
  const firstUnpaired = rounds.find((round) => !round.paired);
  return (firstUnpaired?.number ?? rounds.at(-1)?.number) ?? 1;
}
