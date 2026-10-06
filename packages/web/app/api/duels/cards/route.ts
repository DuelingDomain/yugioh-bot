import { NextRequest, NextResponse } from "next/server";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

import { hasSandboxQuery, requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sandboxQuery = hasSandboxQuery(request);
  const actor = await (sandboxQuery ? requireSandboxActor() : requireDuelActor());
  if (!actor.ok) return actor.response;
  try {
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const slug = request.nextUrl.searchParams.get("slug") ?? undefined;
    const options = sandboxQueryOptions(request);
    if (slug) {
      const room = actor.duels.room(slug, actor.guildId, actor.playerId);
      if (room.session.sandbox && !sandboxQuery) {
        const sandboxActor = await requireSandboxActor();
        if (!sandboxActor.ok) return sandboxActor.response;
      }
    }
    const result = await callDuelHost({
      op: "cards", slug, guildId: actor.guildId, playerId: actor.playerId, query, ...options,
    });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const codes = body && typeof body === "object" && "codes" in body ? body.codes : null;
  if (!Array.isArray(codes) || codes.length > 1000
    || codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
    return NextResponse.json({ error: "Provide at most 1000 positive card passcodes" }, { status: 400 });
  }
  const result = await callDuelHost({
    op: "card-details",
    guildId: actor.guildId,
    playerId: actor.playerId,
    codes,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}
