import { NextRequest, NextResponse } from "next/server";
import type { DuelCommand } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let command: DuelCommand;
  try {
    command = (await request.json()) as DuelCommand;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await callDuelHost({
    op: "respond",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    command,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}
