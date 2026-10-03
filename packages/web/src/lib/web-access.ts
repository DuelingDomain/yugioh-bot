import { NextResponse } from "next/server";
import { auth } from "./auth";
import { checkDiscordWebAccess, webAccessError, type WebAccessLevel } from "./discord-web-access";

export async function requireWebAccess(level: WebAccessLevel = "member") {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const decision = await checkDiscordWebAccess(session.user.id, level);
  if (!decision.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: webAccessError(decision.status) }, { status: decision.status }),
    };
  }
  return { ok: true as const, userId: session.user.id, userName: session.user.name ?? "Unknown" };
}
