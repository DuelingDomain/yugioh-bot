import { parseIdeaDecision } from "@yugidraft/shared/services";
import { ExpectedError, errorResponseBody } from "@yugidraft/shared/observability";
import { ideaId, ideaService, ideasJson, readIdeaBody, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withIdeasAccess(async userId => {
    const id = ideaId((await params).id);
    const input = parseIdeaDecision(await readIdeaBody(request));
    const result = ideaService().decide(userId, id, input);
    if (result.status === "ok") return ideasJson(result);
    const error = errorResponseBody(new ExpectedError(result.status, 409));
    return ideasJson({ ...error.body, ...result }, error.status);
  }, { owner: true, request });
}
