import type { Match, MatchService, TournamentService } from "@yugidraft/shared/services";
import type { Tournament } from "@yugidraft/shared/types";

export function createTournamentTimerService({
  tournaments,
  matches,
  onMatchAutoResolved,
  onTournamentClosed,
  completedSweep,
  notifyDuelChange,
}: {
  tournaments: TournamentService;
  matches: MatchService;
  onMatchAutoResolved: (match: Match) => Promise<void>;
  onTournamentClosed: (tournament: Tournament) => Promise<void>;
  /** Called for each duel game closed with a tournament; fire and forget. */
  notifyDuelChange?: (slug: string, guildId: string) => Promise<void>;
  /**
   * Completed tournaments nobody announced yet (a result from an online duel
   * completes a tournament without going through an announce path).
   */
  completedSweep?: {
    findUnannounced: () => number[];
    announce: (tournamentId: number) => Promise<void>;
  };
}) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function tick(now = new Date()) {
    const nowIso = now.toISOString();

    // 1. Auto-confirm overdue pending reports (before deadline sweep so a match
    //    whose window elapsed can complete its tournament naturally first).
    for (const overdue of matches.findOverduePendingConfirmations(nowIso)) {
      try {
        const resolved = matches.autoApprove(overdue.id);
        await onMatchAutoResolved(resolved);
      } catch (error) {
        console.warn(`[tournament-timer] auto-approve failed for match ${overdue.id}`, error);
      }
    }

    // 2. Auto-close tournaments past their deadline ("close as-is").
    for (const tournament of tournaments.findOverdueActive(nowIso)) {
      try {
        const { tournament: closed, changedDuelSlugs } = tournaments.closeForDeadlineWithChanges(tournament.id);
        for (const duelSlug of changedDuelSlugs) void notifyDuelChange?.(duelSlug, closed.guildId);
        await onTournamentClosed(closed);
      } catch (error) {
        console.warn(`[tournament-timer] close failed for tournament ${tournament.id}`, error);
      }
    }

    // 3. Announce completed tournaments that no announce path claimed.
    if (completedSweep) {
      for (const tournamentId of completedSweep.findUnannounced()) {
        try {
          if (!matches.claimTournamentCompletionAnnouncement(tournamentId)) continue;
          await completedSweep.announce(tournamentId);
        } catch (error) {
          console.warn(`[tournament-timer] completion announce failed for tournament ${tournamentId}`, error);
        }
      }
    }
  }

  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(() => tick(), 60_000);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tick,
  };
}

export type TournamentTimerService = ReturnType<typeof createTournamentTimerService>;
