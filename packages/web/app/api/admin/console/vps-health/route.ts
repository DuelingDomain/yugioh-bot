import { readVpsHealth } from "@yugidraft/shared/health";
import { requireWebAccess } from "@/lib/web-access";
import { isOwnerUser } from "@/lib/owner-access";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
export async function GET(): Promise<Response> {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!isOwnerUser(actor.userId)) return Response.json({ error: "not_found" }, { status: 404, headers });
  try { return Response.json(readVpsHealth(getDb(), process.env.DISCORD_GUILD_ID), { headers }); }
  catch { return Response.json({ error: "VPS health is unavailable." }, { status: 503, headers }); }
}
