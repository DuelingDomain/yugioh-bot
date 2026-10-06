import type Database from "better-sqlite3";
import type { MatchService, TournamentService } from "@yugidraft/shared/services";
import type { WorkerEffects } from "./effects.js";

export function createTournamentTimer({ db, matches, tournaments, effects }: {
  db: Database.Database;
  matches: MatchService;
  tournaments: TournamentService;
  effects: WorkerEffects;
}) {
  const safely = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.warn("[tournament-timer] effect", error);
    }
  };
  const publish = async (id: number) => {
    const tournament = tournaments.findById(id);
    if (tournament.webSlug) {
      const slug = tournament.webSlug;
      await safely(() => effects.tournament({ kind: "match-updated", slug }));
    }
  };

  return {
    async tick(now = new Date()) {
      // Reports resolve before the deadline sweep so their results still count.
      for (const overdue of matches.findOverduePendingConfirmations(now.toISOString())) {
        try {
          const resolved = matches.autoApprove(overdue.id);
          if (resolved.tournamentId) await publish(resolved.tournamentId);
          await safely(() => effects.discord({ kind: "match-resolved", matchId: resolved.id }));
        } catch (error) {
          console.warn("[tournament-timer] auto-approve failed", overdue.id, error);
        }
      }
      for (const due of tournaments.findOverdueActive(now.toISOString())) {
        try {
          const closed = tournaments.closeForDeadlineWithChanges(due.id);
          await publish(closed.tournament.id);
          for (const slug of closed.changedDuelSlugs) {
            await safely(() => effects.duel(slug, closed.tournament.guildId));
          }
        } catch (error) {
          console.warn("[tournament-timer] deadline failed", due.id, error);
        }
      }

      if (!effects.discordEnabled) return;
      const rows = db.prepare(`
        select id from tournaments where status = 'completed' and completed_announced_at is null
          and julianday(ended_at) >= julianday(?, '-1 day')
        order by id limit 20
      `).all(now.toISOString()) as Array<{ id: number }>;
      for (const { id } of rows) {
        // Worker owns this claim. The bot must deliver without claiming again.
        // Preserve the existing at-most-once attempt even if HTTP delivery fails.
        if (!matches.claimTournamentCompletionAnnouncement(id)) continue;
        await safely(() => effects.discord({ kind: "tournament-completed", tournamentId: id }));
      }
    },
  };
}
