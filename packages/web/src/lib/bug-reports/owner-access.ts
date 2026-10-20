import { NextResponse } from "next/server";
import { requireWebAccess } from "../web-access";
import { isOwnerUser } from "../owner-access";
import { env } from "../env";

export const REPORT_PRIVATE_HEADERS = { "cache-control": "private, no-store" };

/** Recheck the current Clerk identity and owner allowlist on every private report read. */
export async function requireReportOwner() {
  const actor = await requireWebAccess();
  if (!actor.ok) {
    actor.response.headers.set("cache-control", "private, no-store");
    return actor;
  }
  if (!isOwnerUser(actor.userId)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: REPORT_PRIVATE_HEADERS }) };
  }
  if (!env.discordGuildId) {
    return { ok: false as const, response: NextResponse.json({ error: "Guild is not configured" }, { status: 503, headers: REPORT_PRIVATE_HEADERS }) };
  }
  return { ok: true as const, guildId: env.discordGuildId };
}

export function reportCursor(value: string | null | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}
