import { ExpectedError } from "@yugidraft/shared/observability";
import { ideaId, ideaService, ideasJson, readIdeaBody, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withIdeasAccess(async userId => {
    const id = ideaId((await params).id);
    const { value } = await readIdeaBody(request);
    if (value !== 1 && value !== -1 && value !== 0) throw new ExpectedError("invalid_body", 400);
    return ideasJson(ideaService().vote(userId, id, value));
  });
}
