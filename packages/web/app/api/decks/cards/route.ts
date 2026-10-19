import { apiErrorResponse } from "@/lib/api-errors";
import { cardAdmissionContext, type CardAdmissionContext } from "@/lib/card-admission-context";
import { NextResponse } from "next/server";
import { CardQueryError, parseCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { createCardInsightService } from "@yugidraft/shared/services";
import { searchIntentTarget } from "@yugidraft/shared/cards/effects";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { effectSearchEnabled, deckSuggestionsEnabled } from "@/lib/effect-search";
import { loadDeckSuggestionLegality } from "@/lib/deck-suggestion-legality";
import { parseCardInsightRequest } from "@/lib/card-insights-api";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

/** Deck editor card search: every filter and sort in one validated query. */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let cardQuery: CardQuery;
  let context: CardAdmissionContext;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    context = cardAdmissionContext(body);
    cardQuery = parseCardQuery(body);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    if (error instanceof CardQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error, "[api/decks/cards]");
  }
  if (!cardQuery.exact && cardQuery.scope !== "name" && searchIntentTarget(cardQuery.text)?.kind === "outside") {
    if (!deckSuggestionsEnabled()) return NextResponse.json({ deckSuggestionsEnabled: false, error: "deck_suggestions_disabled" }, { status: 404 });
    const input = parseCardInsightRequest({ op: "effectSearch", text: cardQuery.text, deck: body.deck,
      format: body.format ?? (cardQuery.excludeGenesysForbidden ? context.mode === "domain" ? "genesys-domain" : "genesys" : context.mode === "domain" ? "domain" : "normal"), deckMaster: body.deckMaster,
      banlist: body.banlist, pool: cardQuery.passcodes, released: cardQuery.released,
      exclude: body.exclude, genesysRemaining: body.genesysRemaining ?? (cardQuery.excludeGenesysForbidden ? cardQuery.genesysPoints?.max ?? undefined : undefined) });
    if (!input || input.op !== "effectSearch") return NextResponse.json({ error: "Invalid outside search context" }, { status: 400 });
    try {
      const admission = await loadDeckSuggestionLegality({ guildId: actor.guildId, userId: actor.userId, format: input.format ?? "normal", banlist: input.banlist, deckMaster: input.deckMaster ?? input.deck?.deckMaster });
      if (!admission.ok) return admission.response;
      const found = createCardInsightService(getDb()).effectSearch(input.text, input.pool, { ...input,
        suggestionContext: { deck: input.deck, legality: admission.legality, banlist: input.banlist, exclude: input.exclude } });
      const offset = cardQuery.effectOffset ?? cardQuery.offset;
      if (!found.cards.length) return NextResponse.json({ cards: [], total: 0, offset: cardQuery.offset, effectSearchEnabled: true, deckSuggestionsEnabled: true,
        reading: found.reading, effectHits: [], effectTotal: 0, effectOffset: offset }, { headers: { "Cache-Control": "private, no-store" } });
      const details = await callDuelHost({ op: "card-query", guildId: actor.guildId, playerId: actor.playerId,
        cardQuery: { ...cardQuery, exact: true, text: "", passcodes: found.cards.map(card => card.passcode), offset: 0, limit: 120 }, ...context });
      if (!details.ok) return details.response;
      const filtered = (details.data as { cards: Array<{ code: number; canonicalPasscode?: number }> }).cards;
      const byCode = new Map(filtered.map(card => [card.canonicalPasscode ?? card.code, card]));
      const hits = found.cards.flatMap(hit => { const card = byCode.get(hit.passcode); return card ? [{ ...card, score: hit.score, reason: hit.reason }] : []; });
      return NextResponse.json({ cards: [], total: 0, offset: cardQuery.offset, effectSearchEnabled: true, deckSuggestionsEnabled: true,
        reading: found.reading, effectHits: hits.slice(offset, offset + cardQuery.limit), effectTotal: hits.length, effectOffset: offset }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return apiErrorResponse(error, "[api/decks/cards outside]"); }
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
    const { reading: _reading, profile: _profile, effectHits: _hits, effectTotal: _total, effectOffset: _offset, relax: _relax, ...literal } = data;
    return NextResponse.json({ ...literal, effectSearchEnabled: false });
  }
  return NextResponse.json(data);
}
