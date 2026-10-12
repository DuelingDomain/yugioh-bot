import { requireSandboxActor } from "@/lib/sandbox-access";
import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, readReplayQuery, requireDuelActor } from "@/lib/duel-host";
import { assertDuelForkAccess } from "@/lib/replay-fork-access";
import { getDb } from "@/lib/db";
import { savedReplayBoardResponse } from "@/lib/saved-replay-board";
import { isOwnerUser } from "@yugidraft/shared/access/owner-access";

export const runtime = "nodejs";

const noStore = (response: NextResponse) => { response.headers.set("cache-control", "private, no-store"); return response; };
function accessError(error: unknown) {
  const response = duelErrorResponse(error);
  if (response.status === 403 || response.status === 404) {
    return noStore(NextResponse.json({ error: response.status === 404 ? "Not found" : "You cannot view this duel", code: "ACCESS_DENIED" }, { status: response.status }));
  }
  return noStore(response);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let actor: Awaited<ReturnType<typeof requireDuelActor>>;
  try { actor = await requireDuelActor(); }
  catch { return noStore(NextResponse.json({ error: "Replay access is unavailable", code: "ACCESS_UNAVAILABLE" }, { status: 503 })); }
  if (!actor.ok) {
    const status = actor.response.status === 401 ? 401 : actor.response.status === 403 ? 403 : 503;
    return noStore(NextResponse.json({ error: status === 503 ? "Replay access is unavailable" : "Unauthorized",
      code: status === 503 ? "ACCESS_UNAVAILABLE" : "ACCESS_DENIED" }, { status }));
  }
  const query = readReplayQuery(request);
  if (!query.ok) return query.response;
  const uncheckedAccessError = () => noStore(NextResponse.json({ error: "Unchecked replay requires owner access", code: "ACCESS_DENIED" }, { status: 403 }));
  if (query.input.unchecked && !isOwnerUser(actor.userId)) return uncheckedAccessError();
  const { slug } = await params;

  try {
    assertDuelForkAccess(slug, actor);
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
    if (room.session.sandbox) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
  } catch (error) {
    return accessError(error);
  }

  const result = await callDuelHost({
    op: "replay",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    userId: actor.userId,
    ...query.input,
  });
  if (query.input.unchecked && !isOwnerUser(actor.userId)) return uncheckedAccessError();
  if (!result.ok) {
    if (result.response.status === 413 || result.response.status === 409) {
      try {
        assertDuelForkAccess(slug, actor);
        const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
        const fallback = await savedReplayBoardResponse(result.response, {
          db: getDb(), session: room.session, playerId: actor.playerId, owner: false, ...query.input,
        });
        if (fallback) {
          assertDuelForkAccess(slug, actor); actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
          return fallback;
        }
      } catch (error) { return accessError(error); }
    }
    return noStore(result.response);
  }
  // Recheck after the host wait, including allowlist changes for a marked fork.
  try { assertDuelForkAccess(slug, actor); actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }); }
  catch (error) { return accessError(error); }
  return noStore(NextResponse.json(result.data));
}
