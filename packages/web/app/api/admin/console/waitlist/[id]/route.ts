import { NextResponse } from "next/server";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });

/** The waitlist lives in Clerk. The local build has no Clerk, so approve and reject answer "not configured". Owner only. */
export async function POST(): Promise<Response> {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!isOwnerUser(actor.userId)) return json({ error: "not_found" }, 404);
  return json({ error: "not_configured" }, 503);
}
