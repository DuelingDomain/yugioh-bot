import { opponentSeatsOf, seatsOfTeam, teamOfSeat } from "@yugidraft/shared/duels";
import type { DuelChainLink, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { tagSeatCode } from "../table-format";

/** Pure rules of the 2v2 Rooftop: team LP, team loss, response window, chain labels, baton, direct attack. */

const TAG = "tag" as const;

/** Shared LP of a team (both members hold the same number). */
export function teamLp(engine: DuelEngineView, team: number): number {
  const members = engine.seats.filter((s) => (s.team ?? teamOfSeat(TAG, s.seat)) === team);
  return members.length > 0 ? members[0].lp : 0;
}

function membersOf(engine: DuelEngineView, team: number) {
  return engine.seats.filter((s) => (s.team ?? teamOfSeat(TAG, s.seat)) === team);
}

export interface TeamLoss {
  lostTeam: number | null;
  /** The plate shows the crack: LP is 0 or the core still applies the loss. */
  cracking: boolean;
}

export function teamLoss(engine: DuelEngineView): TeamLoss {
  const none: TeamLoss = { lostTeam: null, cracking: false };
  const r = engine.result;
  if (r) {
    const winner = r.winnerTeam !== undefined ? r.winnerTeam : r.winnerSeat != null ? teamOfSeat(TAG, r.winnerSeat) : null;
    if (winner == null) return none;
    const lost = 1 - winner;
    return { lostTeam: lost, cracking: teamLp(engine, lost) <= 0 };
  }
  for (const team of [0, 1]) {
    const members = membersOf(engine, team);
    if (members.some((m) => m.eliminated)) return { lostTeam: team, cracking: false };
    if (members.some((m) => m.pendingElimination)) return { lostTeam: team, cracking: true };
    if (members.length > 0 && teamLp(engine, team) <= 0) return { lostTeam: team, cracking: true };
  }
  return none;
}

export interface ResultBanner {
  headline: string;
  outcome: "win" | "lose" | "draw" | "spectator";
}

export function resultBanner(
  engine: DuelEngineView,
  viewerSeat: number | null,
  teamNames?: readonly [string, string],
): ResultBanner | null {
  const r = engine.result;
  if (!r) return null;
  const winner = r.winnerTeam !== undefined ? r.winnerTeam : r.winnerSeat != null ? teamOfSeat(TAG, r.winnerSeat) : null;
  if (winner == null) return { headline: "DRAW", outcome: "draw" };
  if (viewerSeat == null) {
    const name = teamNames?.[winner] ?? `Team ${winner + 1}`;
    return { headline: `${name.toUpperCase()} WINS`, outcome: "spectator" };
  }
  return teamOfSeat(TAG, viewerSeat) === winner
    ? { headline: "YOUR TEAM WINS", outcome: "win" }
    : { headline: "YOUR TEAM LOSES", outcome: "lose" };
}

/** Your team gets the diamond, the other team the dot. */
export function teamGlyph(viewerTeam: number, team: number): "◆" | "●" {
  return team === viewerTeam ? "◆" : "●";
}

/** "C2 · Corvin ◆ 1B": link number, owner, team glyph, turn-order code. */
export function chainLinkLabel(link: DuelChainLink, anchorSeat: number, nameOf: (seat: number) => string): string {
  const glyph = teamGlyph(teamOfSeat(TAG, anchorSeat), teamOfSeat(TAG, link.seat));
  return `C${link.index} · ${nameOf(link.seat)} ${glyph} ${tagSeatCode(TAG, link.seat) ?? ""}`.trimEnd();
}

export interface BatonStop {
  seat: number;
  code: string;
  now: boolean;
  next: boolean;
}

/** The bow-tie baton: 1A, 2A, 1B, 2B with the seat on turn and the next one. */
export function batonOrder(turnSeat: number): BatonStop[] {
  return [0, 1, 2, 3].map((seat) => ({
    seat,
    code: tagSeatCode(TAG, seat) ?? "",
    now: seat === turnSeat,
    next: seat === (turnSeat + 1) % 4,
  }));
}

/** Rival members an attacker may hit directly: members with no monster, not eliminated, in turn order. */
export function directAttackSeats(engine: DuelEngineView, attackerSeat: number): number[] {
  return opponentSeatsOf(TAG, attackerSeat).filter((seat) => {
    const view = engine.seats.find((s) => s.seat === seat);
    if (!view || view.eliminated) return false;
    return view.monsters.every((m) => m == null);
  });
}

export function defaultDirectSeat(engine: DuelEngineView, attackerSeat: number): number | null {
  return directAttackSeats(engine, attackerSeat)[0] ?? null;
}

export type ResponderState = "choosing" | "waiting" | "passed";
export interface ResponseWindow {
  team: number;
  members: Array<{ seat: number; state: ResponderState }>;
  /** The other team already passed (its link is not the last one on the chain). */
  otherPassed: boolean;
  passedSeats: number[];
  bothPassed: boolean;
}

/**
 * The response window of a chain. The opposing team answers first; a team passes only when both members pass.
 * `passed` lists seats of the responding team that already passed.
 */
export function responseWindow(
  engine: DuelEngineView,
  _prompt: DuelPrompt | null,
  promptSeat: number | null,
  passed: readonly number[] = [],
): ResponseWindow | null {
  if (engine.chain.length === 0 || promptSeat == null) return null;
  const team = teamOfSeat(TAG, promptSeat);
  const last = engine.chain[engine.chain.length - 1];
  const otherPassed = teamOfSeat(TAG, last.seat) === team;
  const members = seatsOfTeam(TAG, team).map((seat) => ({
    seat,
    state: (passed.includes(seat) ? "passed" : seat === promptSeat ? "choosing" : "waiting") as ResponderState,
  }));
  return {
    team,
    members,
    otherPassed,
    passedSeats: otherPassed ? seatsOfTeam(TAG, 1 - team) : [],
    bothPassed: members.every((m) => m.state === "passed"),
  };
}
