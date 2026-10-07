import { commitDraftLobbyMutation, DraftLobbyApiError, runDraftLobbyRoute } from "../../helpers";
export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string; playerId: string }> }) {
  return runDraftLobbyRoute(params, true, async (context) => {
    const { playerId: rawId } = await params;
    const playerId = Number(rawId);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(playerId) || playerId <= 0) {
      throw new DraftLobbyApiError("Invalid player ID", "INVALID_BODY");
    }
    return commitDraftLobbyMutation(context, (service) => service.removePlayer(context.draftId, context.userId, playerId));
  });
}
