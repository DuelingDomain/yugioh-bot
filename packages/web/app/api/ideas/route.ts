import { parseIdeaPost } from "@yugidraft/shared/services";
import { ideaService, ideasJson, readIdeaBody, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withIdeasAccess(userId => ideasJson(ideaService().board(userId)));
}

export async function POST(request: Request): Promise<Response> {
  return withIdeasAccess(async userId => {
    const input = parseIdeaPost(await readIdeaBody(request));
    return ideasJson(ideaService().post(userId, input), 201);
  });
}
