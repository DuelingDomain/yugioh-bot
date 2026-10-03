import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { isDraftTournament, rulesValueFromTournament } from "./duel-rules";
import type { TournamentDetail } from "./types";

/** Duel rules as the sheet shows them: rail rows and the one-line Your match summary. */
export interface RulesSummary {
  bestOf: number;
  rows: Array<{ label: string; value: string }>;
  /** "Best of 3, Normal, TCG September 2026, 3 min turns" */
  line: string;
}

type RulesSource = Pick<TournamentDetail, "bestOf" | "duelRules" | "draftId">;

export function formatLabel(format: string): string {
  if (format === "round_robin") return "Round robin";
  if (format === "single_elim") return "Single elimination";
  return format;
}

/**
 * Whether the organizer gets the Host tools drawer. While the event is active, always. After a round robin
 * completes, still yes: the service lets the organizer reopen a result, which sets the event back to active.
 */
export function hostToolsAvailable(tournament: Pick<TournamentDetail, "status" | "format">, isHost: boolean): boolean {
  if (!isHost) return false;
  return tournament.status === "active" || (tournament.status === "completed" && tournament.format === "round_robin");
}

/** The short form the sheet uses: "3 min", "90 s", "Unlimited". */
export function turnLabel(turnSeconds: number): string {
  if (turnSeconds === 0) return "Unlimited";
  return turnSeconds % 60 === 0 ? `${turnSeconds / 60} min` : `${turnSeconds} s`;
}

/** Null for older payloads that carry no rules at all. */
export function rulesSummary(tournament: RulesSource): RulesSummary | null {
  if (tournament.bestOf == null && !tournament.duelRules) return null;
  const rules = rulesValueFromTournament(tournament);
  const bestOf = `Best of ${rules.bestOf}`;
  if (isDraftTournament(tournament)) {
    return { bestOf: rules.bestOf, rows: [{ label: "Rules", value: "Draft pool, no banlist" }], line: `${bestOf}, Draft pool, no banlist` };
  }
  const mode = rules.mode === "domain" ? "Domain" : "Normal";
  const banlist = DUEL_BANLIST_OPTIONS.find((option) => option.id === rules.banlist)?.label ?? rules.banlist;
  const turn = turnLabel(rules.turnSeconds);
  const turnLine = rules.turnSeconds === 0 ? "untimed turns" : `${turn} turns`;
  return {
    bestOf: rules.bestOf,
    rows: [
      { label: "Duel mode", value: mode },
      { label: "Banlist", value: banlist },
      { label: "Turn time", value: turn },
    ],
    line: [bestOf, mode, banlist, turnLine].join(", "),
  };
}
