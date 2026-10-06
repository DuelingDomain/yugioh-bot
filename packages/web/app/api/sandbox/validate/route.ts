import { NextResponse } from "next/server";
import { parseSandboxBoard } from "@yugidraft/shared/duels";
import { callDuelHost } from "@/lib/duel-host";
import { readSandboxBody, requireSandboxActor, sandboxErrorResponse } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const body = await readSandboxBody(request);
    const board = parseSandboxBoard(body.board);
    const result = await callDuelHost({ op: "validate-board", guildId: actor.guildId, playerId: actor.playerId, board });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
