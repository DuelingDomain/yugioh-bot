import { NextResponse } from "next/server";
import { createDraftService, DraftTerminalError } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { env } from "./env";
import { requireWebAccess } from "./web-access";
import { checkDiscordWebAccess, webAccessError } from "./discord-web-access";
import { announcer, broadcaster } from "./notify";

/** Dedicated terminal actions never delete a draft on a retry (unlike legacy DELETE). */
export async function finishDraft(
  params: Promise<{ slug: string }>, action: "end" | "cancel",
): Promise<NextResponse> {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    const { slug } = await params;
    const db = getDb();
    const find = db.prepare("select id, created_by_user_id from drafts where web_slug = ? and guild_id = ?");
    const draft = find.get(slug, env.discordGuildId) as { id: number; created_by_user_id: number } | undefined;
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    let admin = false;
    if (draft.created_by_user_id !== actor.userId) {
      if (!actor.discordUserId) return NextResponse.json({ error: "Only the host or a guild admin can end or cancel a draft" }, { status: 403 });
      const access = await checkDiscordWebAccess(actor.discordUserId, "admin");
      if (!access.ok) return NextResponse.json({ error: webAccessError(access.status) }, { status: access.status });
      admin = true;
    }

    const result = db.transaction(() => {
      // Discord verification can await I/O; re-read guild and ownership under the write lock.
      const current = find.get(slug, env.discordGuildId) as typeof draft;
      if (!current) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      if (current.created_by_user_id !== actor.userId && !admin) {
        return NextResponse.json({ error: "Only the host or a guild admin can end or cancel a draft" }, { status: 403 });
      }
      const drafts = createDraftService(db);
      const before = drafts.findById(current.id);
      const finished = action === "end" ? drafts.endNow(current.id) : drafts.cancel(current.id);
      return { draft: finished, changed: before.status !== finished.status };
    }).immediate();
    if (result instanceof NextResponse) return result;

    const finished = result.draft;
    // Notify only after commit. Transport failures cannot turn a committed change into an error.
    // A retry re-sends status so clients can recover a missed broadcast.
    const notifications: Promise<unknown>[] = [
      broadcaster.draft({ kind: "status", slug, status: finished.status as "completed" | "cancelled" }),
      // Lobby clients also need a full fetch: their completion effect only watches active drafts.
      broadcaster.draft({ kind: "resync", slug, packRound: finished.currentPackRound, pickStep: finished.currentPickStep }),
    ];
    if (result.changed && finished.channelId) {
      notifications.push(announcer.announce({ kind: "draft-status", draftId: finished.id }));
      if (finished.status === "completed") notifications.push(announcer.announce({
        kind: "draft-completed", draftId: finished.id, channelId: finished.channelId,
        name: finished.name, webSlug: slug,
      }));
    }
    for (const notification of await Promise.allSettled(notifications)) {
      if (notification.status === "rejected") console.warn("[draft-terminal] notification failed:", notification.reason);
    }
    return NextResponse.json({
      id: finished.id, name: finished.name, webSlug: slug, status: finished.status,
      changed: result.changed, pickDeadlineAt: finished.pickDeadlineAt, tournamentId: finished.tournamentId ?? null,
    });
  } catch (error) {
    if (error instanceof DraftTerminalError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[draft-terminal] failed:", error);
    return NextResponse.json({ error: "Failed to finish draft" }, { status: 500 });
  }
}
