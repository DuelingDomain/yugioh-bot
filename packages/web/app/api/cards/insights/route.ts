import { NextResponse } from "next/server";
import { createCardInsightService } from "@yugidraft/shared/services";
import { EFFECT_SEARCH_ATTRIBUTION } from "@yugidraft/shared/cards/effects/capability";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { effectSearchEnabled } from "@/lib/effect-search";
import { readCardInsightRequest } from "@/lib/card-insights-api";

export const runtime = "nodejs";

/** Explicit passcodes refer only to the shared public catalog, never a saved private pool. */
export async function POST(request: Request) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!env.discordGuildId) return NextResponse.json({ error: "community_not_configured" }, { status: 503 });
  if (!effectSearchEnabled()) return NextResponse.json({ effectSearchEnabled: false, error: "effect_search_disabled" }, { status: 404 });
  const body = await readCardInsightRequest(request);
  if (!body.ok) return body.response;
  try {
    const service = createCardInsightService(getDb());
    const input = body.value;
    let data: object;
    switch (input.op) {
      case "summary": data = { summary: service.summary(input.passcode) }; break;
      case "read": data = { reading: service.readQuery(input.text) }; break;
      case "effectSearch": data = service.effectSearch(input.text, input.pool, input); break;
      case "worksWith": data = { cards: service.worksWith(input.passcode, input.pool, input) }; break;
      case "suggest": data = { cards: service.suggestForDeck(input.deck, { ...input, format: input.format ?? "normal" }) }; break;
      case "poolHealth": data = { health: service.poolHealth(input.cards, input) }; break;
      case "pickScore": data = { score: service.pickScore(input.candidate, input.pickedPool) }; break;
    }
    return NextResponse.json({ effectSearchEnabled: true, attribution: EFFECT_SEARCH_ATTRIBUTION, ...data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Effect search failed" }, { status: 400 }); }
}
