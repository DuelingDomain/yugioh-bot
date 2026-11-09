import { ExpectedError } from "@yugidraft/shared/observability";
import { ideaService, ideasJson, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withIdeasAccess(userId => {
    const locations = new URL(request.url).searchParams.getAll("at");
    const at = locations[0];
    if (locations.length !== 1 || (at !== "duel" && at !== "draft" && at !== "tournament")) throw new ExpectedError("invalid_at", 400);
    return ideasJson(ideaService().prompt(userId, at));
  });
}
