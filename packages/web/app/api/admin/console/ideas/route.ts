import { ideaService, ideasJson, withIdeasAccess } from "@/lib/ideas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withIdeasAccess(() => ideasJson(ideaService().queue()), { owner: true });
}
