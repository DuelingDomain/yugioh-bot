import type Database from "better-sqlite3";
import type { DraftService } from "@yugidraft/shared/services";
import type { WorkerEffects } from "./effects.js";

export function createDraftTimer({ db, drafts, effects, startedAt }: {
  db: Database.Database;
  drafts: DraftService;
  effects: WorkerEffects;
  startedAt: Date;
}) {
  let lastCompletionSweepAt: number | undefined;
  const safely = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.warn("[draft-timer] effect", error);
    }
  };

  return {
    async tick(now = new Date()) {
      for (const candidate of drafts.listActive()) {
        if (!candidate.pickDeadlineAt || Date.parse(candidate.pickDeadlineAt) > now.getTime()) continue;
        try {
          // A web request may have advanced the stale candidate. The shared
          // immediate transaction rereads the deadline before picking.
          const before = drafts.findById(candidate.id);
          drafts.expireCurrentPickStep(candidate.id, now);
          const after = drafts.findById(candidate.id);
          if (before.status === after.status && before.currentPackRound === after.currentPackRound
              && before.currentPickStep === after.currentPickStep) continue;

          // Publish committed state before attempting Discord delivery.
          if (after.webSlug) {
            const slug = after.webSlug;
            await safely(() => effects.draft(after.status === "completed"
              ? { kind: "complete", slug }
              : { kind: "resync", slug, packRound: after.currentPackRound, pickStep: after.currentPickStep }));
          }
          await safely(() => effects.discord({ kind: "draft-status", draftId: after.id }));
        } catch (error) {
          console.warn("[draft-timer] expire failed", candidate.id, error);
        }
      }

      if (!effects.discordEnabled) return;
      if (lastCompletionSweepAt !== undefined && now.getTime() - lastCompletionSweepAt < 60_000) return;
      lastCompletionSweepAt = now.getTime();
      // The bot owns the claim; retry recent unsent completions from this worker's lifetime.
      const rows = db.prepare(`
        select id from drafts where status = 'completed' and complete_message_id is null
          and channel_id is not null and web_slug is not null
          and julianday(ended_at) >= julianday(?, '-1 day')
          and julianday(ended_at) >= julianday(?)
        order by id limit 20
      `).all(now.toISOString(), startedAt.toISOString()) as Array<{ id: number }>;
      for (const { id } of rows) {
        const draft = drafts.findById(id);
        await safely(() => effects.discord({
          kind: "draft-completed", draftId: id, channelId: draft.channelId!, name: draft.name, webSlug: draft.webSlug!,
        }));
      }
    },
  };
}
