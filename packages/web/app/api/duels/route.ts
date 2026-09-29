import { NextRequest, NextResponse } from "next/server";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    return NextResponse.json({ duels: actor.duels.list(actor.guildId, actor.playerId, { archived }) });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  let body: { name?: unknown; mode?: unknown; masterRule?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; mode?: unknown; masterRule?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a duel object" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const mode = body.mode;
  if (mode !== "normal" && mode !== "domain") {
    return NextResponse.json({ error: "Duel mode must be normal or domain" }, { status: 400 });
  }

  try {
    const session = actor.duels.create({
      guildId: actor.guildId,
      organizerPlayerId: actor.playerId,
      name,
      mode,
      masterRule: body.masterRule as 1 | 2 | 3 | 4 | 5 | undefined,
    });
    try {
      await notifyDuelChange(session.slug, actor.guildId);
    } catch {
      // Create already committed.
    }
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return duelErrorResponse(error);
  }
}
