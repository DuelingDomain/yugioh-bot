import { NextResponse } from "next/server";
import { parseSandboxBoard, parseSandboxRun } from "@yugidraft/shared/duels";
import { callDuelHost } from "@/lib/duel-host";
import { parseSandboxId, readSandboxBody, requireSandboxActor, sandboxErrorResponse, SandboxRequestError } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const body = await readSandboxBody(request);
    const board = parseSandboxBoard(body.board);
    const run = parseSandboxRun(body.run);
    let scenarioId: number | undefined;
    if (body.scenarioId !== undefined) {
      if (typeof body.scenarioId !== "number") throw new SandboxRequestError("Scenario id must be a positive integer");
      scenarioId = parseSandboxId(body.scenarioId);
      actor.scenarios.get(scenarioId, actor.guildId);
    }
    const result = await callDuelHost({
      op: "start-sandbox", guildId: actor.guildId, playerId: actor.playerId,
      board, run, ...(scenarioId === undefined ? {} : { scenarioId }),
    });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
