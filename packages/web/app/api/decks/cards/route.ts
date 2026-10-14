import { apiErrorResponse } from "@/lib/api-errors";
import { cardAdmissionContext, type CardAdmissionContext } from "@/lib/card-admission-context";
import { NextResponse } from "next/server";
import { CardQueryError, parseCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/** Deck editor card search: every filter and sort in one validated query. */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let cardQuery: CardQuery;
  let context: CardAdmissionContext;
  try {
    const body = await request.json();
    context = cardAdmissionContext(body);
    cardQuery = parseCardQuery(body);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    if (error instanceof CardQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error, "[api/decks/cards]");
  }
  const result = await callDuelHost({
    op: "card-query",
    guildId: actor.guildId,
    playerId: actor.playerId,
    cardQuery, ...context,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}
