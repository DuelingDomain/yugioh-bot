import { NextResponse } from "next/server";
import { readSandboxBody, requireSandboxActor, sandboxErrorResponse } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    return NextResponse.json({ scenarios: actor.scenarios.list(actor.guildId) });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const { name, board, run } = await readSandboxBody(request);
    const scenario = actor.scenarios.create(actor.guildId, actor.playerId, { name, board, run });
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
