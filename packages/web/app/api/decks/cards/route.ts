import { NextResponse } from "next/server";
import { CardQueryError, parseCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/** Deck editor card search: every filter and sort in one validated query. */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let cardQuery: CardQuery;
  try {
    cardQuery = parseCardQuery(await request.json());
  } catch (error) {
    const message = error instanceof CardQueryError ? error.message : "Invalid JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const result = await callDuelHost({
    op: "card-query",
    guildId: actor.guildId,
    playerId: actor.playerId,
    cardQuery,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}
