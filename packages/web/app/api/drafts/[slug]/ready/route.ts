import { commitDraftLobbyMutation, DraftLobbyApiError, readLobbyBody, runDraftLobbyRoute } from "../helpers";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftLobbyRoute(params, false, async (context) => {
    const body = await readLobbyBody(request);
    if (typeof body.ready !== "boolean") throw new DraftLobbyApiError("ready must be a boolean", "INVALID_BODY");
    const ready = body.ready;
    return commitDraftLobbyMutation(context, (service) => service.setReady(context.draftId, context.userId, ready));
  });
}
