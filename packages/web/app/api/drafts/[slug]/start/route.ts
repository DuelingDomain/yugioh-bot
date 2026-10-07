import {
  commitDraftLobbyMutation, DraftLobbyApiError, handleDraftStart, readLobbyBody, runDraftLobbyRoute,
} from "../helpers";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleDraftStart(request, params);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftLobbyRoute(params, true, async (context) => {
    const body = await readLobbyBody(request);
    if (typeof body.token !== "string" || !body.token.trim()) throw new DraftLobbyApiError("token is required", "INVALID_BODY");
    const token = body.token;
    return commitDraftLobbyMutation(context, (service) => service.stopStart(context.draftId, context.userId, token));
  });
}
