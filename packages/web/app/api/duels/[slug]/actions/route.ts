import { NextRequest, NextResponse } from "next/server";
import type { DuelCommand } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import {
  hasSandboxQuery, readSandboxBody, requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions,
} from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const sandboxQuery = hasSandboxQuery(request);
  const actor = await (sandboxQuery ? requireSandboxActor() : requireDuelActor());
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const options = sandboxQueryOptions(request);
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox && !sandboxQuery) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
    let command: DuelCommand;
    if (room.session.sandbox || sandboxQuery) {
      command = await readSandboxBody(request) as unknown as DuelCommand;
    } else {
      try {
        command = await request.json() as DuelCommand;
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const result = await callDuelHost({
      op: "respond", slug, guildId: actor.guildId, playerId: actor.playerId, command, ...options,
    });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
