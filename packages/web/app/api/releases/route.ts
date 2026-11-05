import { requireWebAccess } from "@/lib/web-access";
import { privateResponse, releaseContext, releaseErrorResponse, releaseJson } from "@/lib/releases-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const actor = await requireWebAccess(); if (!actor.ok) return privateResponse(actor.response);
  try {
    const { releases } = releaseContext();
    return releaseJson({ releases: releases.listPublished(), lastSeenVersion: releases.lastSeenVersion(actor.userId) });
  } catch (error) { return releaseErrorResponse(error); }
}
