import { requireWebAccess } from "@/lib/web-access";
import { webOrigin } from "@/lib/existing-player";
import { readSmallJsonObject } from "@/lib/read-small-body";
import { privateResponse, releaseContext, releaseErrorResponse, releaseJson } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const actor = await requireWebAccess(); if (!actor.ok) return privateResponse(actor.response);
  let origin: string | null = null; try { origin = webOrigin(); } catch { /* Fail closed. */ }
  if (!origin || request.headers.get("origin") !== origin) return releaseJson({ error: "invalid_origin" }, 403);
  const body = await readSmallJsonObject(request, 1024);
  if (!body) return releaseJson({ error: "invalid_body" }, 400);
  try { releaseContext().releases.markSeen(actor.userId, body.version); return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } }); }
  catch (error) { return releaseErrorResponse(error); }
}
