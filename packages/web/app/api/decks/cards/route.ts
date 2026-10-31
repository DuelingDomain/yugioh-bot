import { apiErrorResponse } from "@/lib/api-errors";
import { cardAdmissionContext, type CardAdmissionContext } from "@/lib/card-admission-context";
import { NextResponse } from "next/server";
import { CardQueryError, parseCardQuery, type CardQuery } from "@yugidraft/shared/duels";
import { parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { searchIntentTarget, readFormatQuery } from "@yugidraft/shared/cards/effects";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { effectSearchEnabled, deckSuggestionsEnabled } from "@/lib/effect-search";
import { loadDeckSuggestions } from "@/lib/deck-suggestions";
import { parseCardInsightRequest } from "@/lib/card-insights-api";

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
  if (!cardQuery.exact && cardQuery.scope !== "name" && searchIntentTarget(cardQuery.text)?.kind === "outside" && !readFormatQuery(cardQuery.text).filter) {
    if (!effectSearchEnabled()) return NextResponse.json({ effectSearchEnabled: false, error: "effect_search_disabled" }, { status: 404 });
    if (!deckSuggestionsEnabled()) return NextResponse.json({ deckSuggestionsEnabled: false, error: "deck_suggestions_disabled" }, { status: 404 });
    const input = parseCardInsightRequest({ op: "effectSearch", text: cardQuery.text, deck: body.deck,
      format: body.format ?? (cardQuery.excludeGenesysForbidden ? context.mode === "domain" ? "genesys-domain" : "genesys" : context.mode === "domain" ? "domain" : "normal"), deckMaster: body.deckMaster,
      banlist: body.banlist, pool: cardQuery.passcodes, released: cardQuery.released,
      exclude: body.exclude, genesysRemaining: body.genesysRemaining ?? (cardQuery.excludeGenesysForbidden ? cardQuery.genesysPoints?.max ?? undefined : undefined) });
    if (!input || input.op !== "effectSearch") return NextResponse.json({ error: "Invalid outside search context" }, { status: 400 });
    try {
      const query = parseDeckSuggestionQuery(input);
      if (!query || query.op !== "effectSearch") return NextResponse.json({ error: "Invalid outside search context" }, { status: 400 });
      const loaded = await loadDeckSuggestions({ guildId: actor.guildId, userId: actor.userId, query });
      if (!loaded.ok) return loaded.response;
      const found = loaded.result;
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
    const { reading: _reading, profile: _profile, effectHits: _hits, effectTotal: _total, effectGroups: _groups, effectOffset: _offset, relax: _relax, ...literal } = data;
    return NextResponse.json({ ...literal, effectSearchEnabled: false });
  }
  return NextResponse.json(data);
}
