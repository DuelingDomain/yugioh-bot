import { NextResponse } from "next/server";
import { auth } from "./auth";
import { parseUserId } from "./user-id";
import { checkDiscordWebAccess, webAccessError, type WebAccessLevel } from "./discord-web-access";

export async function requireWebAccess(level: WebAccessLevel = "member") {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  const discordUserId = session?.user?.discordUserId;
  if (userId === null || typeof discordUserId !== "string" || !discordUserId) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const decision = await checkDiscordWebAccess(discordUserId, level);
  if (!decision.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: webAccessError(decision.status) }, { status: decision.status }),
    };
  }
  return { ok: true as const, userId, discordUserId, userName: session?.user?.name ?? "Unknown" };
}
