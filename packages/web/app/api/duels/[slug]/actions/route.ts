import { authorizeDuelControl, readSandboxBody, sandboxErrorResponse } from "@/lib/sandbox-access";
import { NextRequest, NextResponse } from "next/server";
import type { DuelCommand } from "@yugidraft/shared/duels";
import { duelAnimationSpeed, readDuelControl, callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let fork = false;
  let sandbox = false;
  let control: ReturnType<typeof readDuelControl>;
  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
    const authorized = await authorizeDuelControl(request, room, "action");
    if (!authorized.ok) return authorized.response;
    control = authorized.control;
    fork = room?.session.kind === "replay-fork";
    sandbox = room.session.sandbox === true;
  } catch (error) {
    return sandboxErrorResponse(error);
  }

  let command: DuelCommand;
  try {
    command = (sandbox ? await readSandboxBody(request) : await request.json()) as DuelCommand;
  } catch (error) {
    if (sandbox) return sandboxErrorResponse(error);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }

  const result = await callDuelHost({
    ...duelAnimationSpeed(request),
    op: "respond",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId, ...(actor.userId !== undefined ? { userId: actor.userId } : {}), ...control,
    command,
  });
  if (!result.ok) return result.response;
  if (fork) {
    try { actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }); }
    catch (error) { return duelErrorResponse(error); }
  }
  return NextResponse.json(result.data, { headers: { "cache-control": "private, no-store" } });
}
