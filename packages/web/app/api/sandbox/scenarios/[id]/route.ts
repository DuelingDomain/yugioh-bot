import { NextResponse } from "next/server";
import { parseSandboxId, readSandboxBody, requireSandboxActor, sandboxErrorResponse } from "@/lib/sandbox-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const id = parseSandboxId((await params).id);
    return NextResponse.json({ scenario: actor.scenarios.get(id, actor.guildId) });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const id = parseSandboxId((await params).id);
    const { name, board, run } = await readSandboxBody(request);
    const scenario = actor.scenarios.update(id, actor.guildId, actor.playerId, { name, board, run });
    return NextResponse.json({ scenario });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const actor = await requireSandboxActor();
  if (!actor.ok) return actor.response;
  try {
    const id = parseSandboxId((await params).id);
    actor.scenarios.delete(id, actor.guildId, actor.playerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}
