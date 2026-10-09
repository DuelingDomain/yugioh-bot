import type Database from "better-sqlite3";
import { createDraftLobbyService, type DraftService } from "@yugidraft/shared/services";
import type { WorkerEffects } from "./effects.js";

export function createDraftTimer({ db, drafts, effects, startedAt }: {
  db: Database.Database;
  drafts: DraftService;
  effects: WorkerEffects;
  startedAt: Date;
}) {
  const lobby = createDraftLobbyService(db);
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
      const pendingEffects: Array<() => Promise<void>> = [];
      // SQLite owns lobby deadlines. tick's cheap candidate query skips idle and
      // held drafts before acquiring a write lock or analyzing cached pools.
      try {
        const transitions = lobby.tick(now);
        const startedSlugs = new Set(transitions.started.map(draft => draft.webSlug));
        for (const slug of new Set(transitions.changedSlugs)) {
          if (!startedSlugs.has(slug)) pendingEffects.push(() => effects.draft({ kind: "seats", slug }));
        }
        for (const draft of transitions.started) {
          if (draft.webSlug) {
            const slug = draft.webSlug;
            pendingEffects.push(() => effects.draft({ kind: "resync", slug,
              packRound: draft.currentPackRound, pickStep: draft.currentPickStep }));
            pendingEffects.push(() => effects.draft({ kind: "status", slug, status: "active" }));
          }
          if (effects.discordEnabled && draft.channelId && draft.webSlug) {
            pendingEffects.push(() => effects.discord({ kind: "draft-started", draftId: draft.id,
              channelId: draft.channelId!, name: draft.name, webSlug: draft.webSlug! }));
          }
        }
      } catch (error) {
        console.warn("[draft-timer] pending lobby sweep failed", error);
      }

      for (const candidate of drafts.listActive()) {
        if (!candidate.pickDeadlineAt || Date.parse(candidate.pickDeadlineAt) > now.getTime()) continue;
        try {
          // A web request may have advanced the stale candidate. The shared
          // immediate transaction rereads the deadline before picking.
          const before = drafts.findById(candidate.id);
          if (before.status !== "active") continue;
          drafts.expireCurrentPickStep(candidate.id, now);
          const after = drafts.findById(candidate.id);
          if (after.status === "cancelled") continue;
          if (before.status === after.status && before.currentPackRound === after.currentPackRound
              && before.currentPickStep === after.currentPickStep) continue;

          // Publish committed state before attempting Discord delivery.
          if (after.webSlug) {
            const slug = after.webSlug;
            pendingEffects.push(() => effects.draft(after.status === "completed"
              ? { kind: "complete", slug }
              : { kind: "resync", slug, packRound: after.currentPackRound, pickStep: after.currentPickStep }));
          }
          if (effects.discordEnabled && after.channelId) {
            pendingEffects.push(() => effects.discord({ kind: "draft-status", draftId: after.id }));
          }
        } catch (error) {
          console.warn("[draft-timer] expire failed", candidate.id, error);
        }
      }

      // Commit every due transition before network delivery can stall the tick.
      for (const effect of pendingEffects) await safely(effect);

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
