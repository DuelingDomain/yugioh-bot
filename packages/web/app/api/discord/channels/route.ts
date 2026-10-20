import { report } from "@yugidraft/shared/observability";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  if (!env.discordBotEnabled) return NextResponse.json({ error: "discord_disabled" }, { status: 404 });
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const guildId = env.discordBotGuildId;
  const botToken = process.env.DISCORD_TOKEN;

  if (!guildId || !botToken) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch channels from Discord" }, { status: res.status });
    }

    const channels = await res.json();
    const textChannels = channels
      .filter((ch: any) => ch.type === 0)
      .map((ch: any) => ({ id: ch.id, name: ch.name }));

    return NextResponse.json({ channels: textChannels });
  } catch (error) {
    report(error, { tags: { operation: "[api/discord/channels] error" } });
    return NextResponse.json({ error: "Failed to fetch channels" }, { status: 500 });
  }
}
