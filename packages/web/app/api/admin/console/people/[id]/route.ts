import { NextResponse } from "next/server";
import { loadPerson } from "@/lib/admin-console/person";
import { failed, notConfigured, ok } from "@/lib/admin-console/section";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** One person for the admin People view. Same access as the sections: 404 for anyone not in OWNER_USER_IDS. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!isOwnerUser(actor.userId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const { id } = await params;
  if (!/^[1-9]\d{0,11}$/.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400, headers });
  const now = Date.now();
  const guild = env.discordGuildId;
  if (!guild) return NextResponse.json(notConfigured("Set DISCORD_GUILD_ID to show people.", now), { headers });
  try {
    const person = loadPerson(getDb(), guild, Number(id), now);
    if (!person) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    return NextResponse.json(ok(person, now), { headers });
  } catch {
    return NextResponse.json(failed("This person could not be loaded.", now), { headers });
  }
}
