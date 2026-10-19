import { NextResponse } from "next/server";
import { createPlayerService, type CardInsightFormat, type DeckSuggestionLegality } from "@yugidraft/shared/services";
import { callDuelHost } from "@/lib/duel-host";
import { getDb } from "@/lib/db";

function passcode(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}

function numericMap(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length <= 100_000
    && Object.entries(value).every(([key, entry]) => /^[1-9]\d*$/.test(key) && passcode(Number(key)) && valid(entry));
}

/** Only the engine host can provide a trusted candidate scope. No permissive fallback or scope retention. */
export async function loadDeckSuggestionLegality(input: {
  guildId: string;
  userId: number;
  format: CardInsightFormat;
  banlist?: string;
  deckMaster?: number;
}): Promise<{ ok: true; legality: DeckSuggestionLegality } | { ok: false; response: NextResponse }> {
  const failure = (error: string, status: number) => ({ ok: false as const,
    response: NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store" } }) });
  const player = createPlayerService(getDb()).findByGuildAndUser(input.guildId, input.userId);
  if (!player) return failure("Player access is required for deck suggestions", 403);
  const result = await callDuelHost({ op: "suggestion-scope", guildId: input.guildId, playerId: player.id,
    userId: input.userId, suggestionFormat: input.format, banlist: input.banlist, deckMaster: input.deckMaster });
  if (!result.ok) return result;
  const value = result.data as Partial<DeckSuggestionLegality> | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.allowed) || value.allowed.length > 100_000
    || !value.allowed.every(passcode) || new Set(value.allowed).size !== value.allowed.length
    || !numericMap(value.limits, limit => typeof limit === "number" && Number.isInteger(limit) && limit >= 0 && limit <= 3)
    || (value.copyGroups !== undefined && !numericMap(value.copyGroups, passcode))
    || typeof value.version !== "string" || !/^[a-f0-9]{64}$/.test(value.version)) {
    return failure("Invalid engine suggestion scope", 502);
  }
  return { ok: true, legality: value as DeckSuggestionLegality };
}
