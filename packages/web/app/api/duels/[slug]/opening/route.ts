import { NextResponse } from "next/server";
import { isFirstChoice, isRpsMove } from "@yugidraft/shared/duels";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/**
 * The rock-paper-scissors opening. Body `{ move }` plays a move; body `{ choice }` is the winner's
 * "first" or "second". The duel host decides the result and the timeouts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    actor.duels.room(slug, actor.guildId, actor.playerId);
  } catch (error) {
    return duelErrorResponse(error);
  }

  let body: { move?: unknown; choice?: unknown };
  try {
    body = (await request.json()) as { move?: unknown; choice?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (isRpsMove(body?.move)) {
    const result = await callDuelHost({ op: "opening-pick", slug, guildId: actor.guildId, playerId: actor.playerId, move: body.move });
    if (!result.ok) return result.response;
    return NextResponse.json(result.data);
  }
  if (isFirstChoice(body?.choice)) {
    const result = await callDuelHost({ op: "opening-choose", slug, guildId: actor.guildId, playerId: actor.playerId, choice: body.choice });
    if (!result.ok) return result.response;
    return NextResponse.json(result.data);
  }
  return NextResponse.json({ error: "Expected { move } (rock, paper or scissors) or { choice } (first or second)" }, { status: 400 });
}
