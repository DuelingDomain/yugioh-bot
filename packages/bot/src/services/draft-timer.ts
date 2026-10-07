import type { DraftMessenger } from "../commands/handlers.js";
import type { DraftService } from "./drafts.js";
import type { DraftLobbyService } from "@yugidraft/shared/services";
import type { Broadcaster } from "@yugidraft/shared/notify";

const DELIVERY_TIMEOUT_MS = 5_000;

export function createDraftTimerService({
  drafts,
  lobby,
  now: clock = () => new Date(),
  onDraftStarted,
  messenger,
  broadcaster,
  onDraftCompleted,
}: {
  drafts: DraftService;
  lobby: Pick<DraftLobbyService, "tick">;
  now?: () => Date;
  onDraftStarted?: (draftId: number) => Promise<void>;
  messenger: DraftMessenger;
  broadcaster: Broadcaster;
  onDraftCompleted?: (draftId: number) => Promise<void>;
}) {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;

  async function bestEffort(label: string, run: () => Promise<unknown>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(run),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Notification delivery timed out")), DELIVERY_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      console.warn(`[draft-timer] ${label} failed:`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function tick(now = clock()) {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await runTick(now);
    } finally {
      tickInFlight = false;
    }
  }

  async function runTick(now: Date) {
    const notifications: Array<() => Promise<void>> = [];
    const queue = (label: string, run: () => Promise<unknown>) => notifications.push(() => bestEffort(label, run));

    // All SQLite sweeps run synchronously before yielding to notification delivery.
    try {
      const result = lobby.tick(now);
      const startedSlugs = new Set(result.started.map(draft => draft.webSlug));
      for (const slug of new Set(result.changedSlugs)) {
        if (!startedSlugs.has(slug)) queue(`seats broadcast for ${slug}`, () => broadcaster.draft({ kind: "seats", slug }));
      }
      for (const draft of result.started) {
        if (draft.webSlug) queue(`start broadcast for ${draft.id}`, () => broadcaster.draft({ kind: "status", slug: draft.webSlug!, status: "active" }));
        if (onDraftStarted) queue(`onDraftStarted for ${draft.id}`, () => onDraftStarted(draft.id));
      }
    } catch (error) {
      console.warn("[draft-timer] pending lobby sweep failed:", error);
    }

    for (const draft of drafts.listActive()) {
      if (!draft.pickDeadlineAt || new Date(draft.pickDeadlineAt) > now) continue;
      try {
        drafts.expireCurrentPickStep(draft.id, now);
        const updatedDraft = drafts.findById(draft.id);
        if (updatedDraft.webSlug) {
          if (updatedDraft.status === "completed") {
            queue(`completion broadcast for ${draft.id}`, () => broadcaster.draft({ kind: "complete", slug: updatedDraft.webSlug! }));
          } else {
            queue(`pick broadcast for ${draft.id}`, () => broadcaster.draft({
              kind: "resync", slug: updatedDraft.webSlug!, packRound: updatedDraft.currentPackRound, pickStep: updatedDraft.currentPickStep,
            }));
          }
        }
        queue(`pick status for ${draft.id}`, () => messenger.updateStatus(updatedDraft));
        if (updatedDraft.webSlug && updatedDraft.status === "completed" && onDraftCompleted) {
          queue(`onDraftCompleted for ${draft.id}`, () => onDraftCompleted(updatedDraft.id));
        }
      } catch (error) {
        console.warn(`Draft timer failed to expire pick step for draft ${draft.id}`, error);
      }
    }

    for (const notify of notifications) await notify();
  }

  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(() => { void tick().catch(error => console.warn("[draft-timer] sweep failed:", error)); }, 1000);
    },
    stop() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    },
    tick,
  };
}

export type DraftTimerService = ReturnType<typeof createDraftTimerService>;
