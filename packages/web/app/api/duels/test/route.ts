import { NextResponse } from "next/server";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

function isDeck(value: unknown): value is DuelDeck {
  if (!value || typeof value !== "object") return false;
  const deck = value as Record<string, unknown>;
  return ["main", "extra", "side"].every((key) => Array.isArray(deck[key]));
}

/**
 * Deck editor "Test duel". Body `{ mode, deck, genesys?, shuffle?, goFirst? }`. Starts a private, unranked
 * duel against a practice bot and answers `{ slug }`. The duel host checks the deck and the format.
 */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { mode, deck, genesys, shuffle, goFirst } = body;
  if (mode !== "normal" && mode !== "domain") return NextResponse.json({ error: "Duel mode must be normal or domain" }, { status: 400 });
  if (!isDeck(deck)) return NextResponse.json({ error: "Deck must include main, extra, and side arrays" }, { status: 400 });
  if (shuffle !== undefined && typeof shuffle !== "boolean") return NextResponse.json({ error: "Shuffle must be true or false" }, { status: 400 });
  if (goFirst !== undefined && typeof goFirst !== "boolean") return NextResponse.json({ error: "Go first must be true or false" }, { status: 400 });
  if (genesys !== undefined && genesys !== null
    && (typeof genesys !== "object" || typeof (genesys as { pointCap?: unknown }).pointCap !== "number")) {
    return NextResponse.json({ error: "Genesys must include a point cap" }, { status: 400 });
  }

  const result = await callDuelHost({
    op: "start-test-duel", mode, deck,
    ...(genesys ? { genesys: { pointCap: (genesys as { pointCap: number }).pointCap } } : {}),
    ...(shuffle !== undefined ? { shuffle } : {}),
    ...(goFirst !== undefined ? { goFirst } : {}),
    guildId: actor.guildId, playerId: actor.playerId,
    ...(actor.userId !== undefined ? { userId: actor.userId } : {}),
  });
  if (!result.ok) return result.response;
  const data = result.data as { slug?: unknown; session?: { slug?: unknown } } | null;
  const slug = typeof data?.slug === "string" ? data.slug : data?.session?.slug;
  if (typeof slug !== "string" || !slug) return NextResponse.json({ error: "The engine did not return a duel" }, { status: 502 });
  return NextResponse.json({ slug });
}
