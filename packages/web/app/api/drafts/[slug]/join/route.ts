import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";
import { createDraftService, createPlayerService, findDraftReadAccess } from "@yugidraft/shared/services";
import { commitDraftLobbyMutation, draftLobbyErrorResponse, runDraftLobbyRoute } from "../helpers";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;

    // Hold the write lock across authorization and admission: a concurrent host
    // visibility change must not race with creating the gameplay player/seat.
    const result = db.transaction(() => {
      const access = findDraftReadAccess(db, slug, guildId, actor.userId);
      if (!access?.canRead) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      if (access.status !== "pending") {
        return NextResponse.json({ error: "Draft is no longer accepting players" }, { status: 409 });
      }
      if (!access.canJoin) {
        return access.isSeated
          ? NextResponse.json({ error: "You have already joined this draft" }, { status: 400 })
          : NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }
      // The shared admission rule lets a private creator rejoin without a grant.
      const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
      createDraftService(db).join(access.id, player.id);
      return player;
    }).immediate();
    if (result instanceof Response) return result;

    void broadcaster.draft(
      { kind: "seats", slug },
    );

    return NextResponse.json({ success: true, playerId: result.id, displayName: result.displayName });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) return draftLobbyErrorResponse(error);
    if (error instanceof Error) {
      if (error.message === "You have already joined this draft") {
        return NextResponse.json({ error: "You have already joined this draft" }, { status: 400 });
      }
      if (error.message === "Player must belong to the same guild as the draft") {
        return NextResponse.json({ error: "You must belong to this server to join" }, { status: 403 });
      }
    }
    console.error("[api/drafts/[slug]/join] error:", error);
    return NextResponse.json(
      { error: "Failed to join draft" },
      { status: 500 }
    );
  }
}


export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftLobbyRoute(params, false, (context) =>
    commitDraftLobbyMutation(context, (service) => service.leave(context.draftId, context.userId)),
  );
}
