import { commitDraftLobbyMutation, DraftLobbyApiError, readLobbyBody, runDraftLobbyRoute, validLobbyRevision } from "../helpers";
export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftLobbyRoute(params, true, async (context) => {
    const body = await readLobbyBody(request);
    if (typeof body.enabled !== "boolean" || !validLobbyRevision(body.revision)
      || (body.held !== undefined && typeof body.held !== "boolean")) {
      throw new DraftLobbyApiError("enabled, revision and optional held are invalid", "INVALID_BODY");
    }
    const input = { enabled: body.enabled, revision: body.revision, ...(body.held === undefined ? {} : { held: body.held as boolean }) };
    return commitDraftLobbyMutation(context, (service) => service.setAutoStart(context.draftId, context.userId, input));
  });
}
