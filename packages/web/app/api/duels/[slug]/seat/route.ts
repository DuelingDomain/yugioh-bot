import { NextResponse } from "next/server";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let body: { seat?: unknown };
  try {
    body = await request.json() as { seat?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.seat !== "number" || !Number.isInteger(body.seat) || body.seat < 0) {
    return NextResponse.json({ error: "Seat must be a whole number from 0" }, { status: 400 });
  }

  try {
    const session = actor.duels.takeSeat(slug, actor.guildId, actor.playerId, body.seat);
    try {
      await notifyDuelChange(session.slug, actor.guildId);
    } catch {
      // The seat claim already committed.
    }
    return NextResponse.json({ session });
  } catch (error) {
    return duelErrorResponse(error);
  }
}
