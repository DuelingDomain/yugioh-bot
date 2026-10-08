import { NextResponse } from "next/server";
import { runDraftCreatorRoute } from "@/lib/draft-visibility";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftCreatorRoute(params, async ({ slug, guildId, userId, privacy }) => {
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const value = body && typeof body === "object" && !Array.isArray(body) && "visibility" in body ? body.visibility : undefined;
    const visibility = privacy.setVisibility(slug, guildId, userId, value);
    void broadcaster.draft({ kind: "seats", slug });
    return NextResponse.json({ visibility }, { headers: { "Cache-Control": "no-store" } });
  });
}
