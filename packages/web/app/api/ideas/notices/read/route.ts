import { ideaService, ideasJson, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return withIdeasAccess(userId => ideasJson(ideaService().markNoticesRead(userId)));
}
