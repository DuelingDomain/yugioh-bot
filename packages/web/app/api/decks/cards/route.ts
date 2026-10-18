import { apiErrorResponse } from "@/lib/api-errors";
import { cardAdmissionContext, type CardAdmissionContext } from "@/lib/card-admission-context";
import { NextResponse } from "next/server";
import { CardQueryError, parseCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { effectSearchEnabled } from "@/lib/effect-search";

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
    cardQuery: effectSearchEnabled() ? cardQuery : { ...cardQuery, exact: true }, ...context,
  });
  if (!result.ok) return result.response;
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) return NextResponse.json({ error: "Invalid card query response" }, { status: 502 });
  const data = result.data as Record<string, unknown>;
  const enabled = effectSearchEnabled() && data.effectSearchEnabled === true;
  if (!enabled) {
    const { reading: _reading, effectHits: _hits, effectTotal: _total, effectOffset: _offset, ...literal } = data;
    return NextResponse.json({ ...literal, effectSearchEnabled: false });
  }
  return NextResponse.json(data);
}
