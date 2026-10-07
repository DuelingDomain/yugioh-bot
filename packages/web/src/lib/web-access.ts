import { NextResponse } from "next/server";
import { resolveSessionIdentity } from "./session-identity";
export async function requireWebAccess(): Promise<
  | { ok: true; userId: number; discordUserId: string | null; userName: string }
  | { ok: false; response: NextResponse }> {
  const result = await resolveSessionIdentity();
  if (!result.ok) return { ok: false, response: NextResponse.json({ error: result.status === 401 ? "unauthorized" : "session_unavailable" }, { status: result.status }) };
  return { ok: true, userId: result.identity.userId, discordUserId: result.identity.discordUserId, userName: result.identity.name };
}
