import { NextResponse } from "next/server";
import { canUseSandbox } from "@/lib/sandbox-access";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

/** Navigation hint; sandbox pages and actions enforce their own access checks. */
export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) {
    actor.response.headers.set("Cache-Control", "no-store");
    return actor.response;
  }
  const access = await canUseSandbox(actor.discordUserId);
  return NextResponse.json({ allowed: access.ok }, { headers: { "Cache-Control": "no-store" } });
}
