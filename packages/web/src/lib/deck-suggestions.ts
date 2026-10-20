import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { createPlayerService, parseDeckSuggestionQuery, type CardEffectSearchResult, type DeckSuggestionQuery, type DeckSuggestionResult } from "@yugidraft/shared/services";
import { isReleasedRange, validReleaseMonth } from "@yugidraft/shared/cards/effects";
import { callDuelHost } from "@/lib/duel-host";
import { getDb } from "@/lib/db";

type ResultFor<T extends DeckSuggestionQuery> = T extends { op: "suggestRows" } ? DeckSuggestionResult : CardEffectSearchResult;
type Cached = { contextVersion: string; result: DeckSuggestionResult | CardEffectSearchResult };
const registry = Symbol.for("yugidraft.web.deck-suggestion-results.v1");
const runtime = globalThis as typeof globalThis & { [registry]?: WeakMap<Database.Database, Map<string, string>> };
const caches = runtime[registry] ??= new WeakMap<Database.Database, Map<string, string>>();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const passcode = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const strings = (value: unknown, max = 64): value is string[] => Array.isArray(value) && value.length <= max && value.every(entry => text(entry, 1024));
const version = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const failure = (error: string, status: number) => ({ ok: false as const,
  response: NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store" } }) });

function rankedCard(value: unknown): boolean {
  if (!object(value) || !keys(value, ["passcode", "name", "score", "linkedCards", "reason", "deckMasterFit", "release"])
    || !passcode(value.passcode) || !text(value.name, 512) || !value.name.length || typeof value.score !== "number" || !Number.isFinite(value.score)
    || !integer(value.linkedCards) || !text(value.reason, 2048) || /[\r\n]/.test(value.reason)
    || (value.deckMasterFit !== undefined && typeof value.deckMasterFit !== "boolean")) return false;
  if (value.release === undefined) return true;
  const release = value.release;
  return object(release) && keys(release, ["tcgDate", "ocgDate", "date", "region", "upcoming"])
    && typeof release.upcoming === "boolean"
    && ["tcgDate", "ocgDate", "date"].every(key => release[key] === undefined || validReleaseMonth(release[key]))
    && (release.region === undefined || release.region === "tcg" || release.region === "ocg");
}

function objectQuery(value: unknown): boolean {
  return object(value) && keys(value, ["kinds", "subtypes", "types", "attributes", "archetypes", "atkMin", "atkMax", "levelMin", "levelMax"])
    && ["kinds", "subtypes", "types", "attributes", "archetypes"].every(key => strings(value[key]))
    && ["atkMin", "atkMax", "levelMin", "levelMax"].every(key => value[key] === undefined || integer(value[key]));
}

function eventQuery(value: unknown): boolean {
  return object(value) && keys(value, ["verbs", "from", "player", "self", "object"])
    && strings(value.verbs) && strings(value.from) && typeof value.self === "boolean" && objectQuery(value.object)
    && (value.player === undefined || value.player === "you" || value.player === "opponent");
}

function outsideReading(value: unknown): boolean {
  if (!object(value) || !keys(value, ["query", "chips"]) || !strings(value.chips, 32) || !object(value.query)) return false;
  const query = value.query;
  return keys(query, ["intent", "card", "released", "releaseLabel", "sort", "roles", "does", "reactsTo", "supports", "quick", "worksFrom", "text"])
    && object(query.intent) && keys(query.intent, ["kind", "archetype"]) && query.intent.kind === "outside" && text(query.intent.archetype, 512)
    && objectQuery(query.card) && strings(query.roles) && typeof query.quick === "boolean" && text(query.text, 1024)
    && (query.released === undefined || isReleasedRange(query.released)) && (query.releaseLabel === undefined || text(query.releaseLabel, 512))
    && (query.sort === undefined || query.sort === "newest") && (query.worksFrom === undefined || text(query.worksFrom, 128))
    && (query.does === undefined || eventQuery(query.does)) && (query.reactsTo === undefined || eventQuery(query.reactsTo))
    && (query.supports === undefined || objectQuery(query.supports));
}

function validResult(value: unknown, query: DeckSuggestionQuery): value is Cached["result"] {
  if (!object(value)) return false;
  if (query.op === "effectSearch") {
    return keys(value, ["reading", "cards", "total", "relax"]) && (value.reading === null || outsideReading(value.reading))
      && Array.isArray(value.cards) && value.cards.length <= 12 && value.cards.every(rankedCard)
      && new Set(value.cards.map(card => card.passcode)).size === value.cards.length && integer(value.total) && value.total === value.cards.length
      && (value.relax === undefined || (Array.isArray(value.relax) && value.relax.length <= 2 && value.relax.every(hint => object(hint)
        && keys(hint, ["chip", "count"]) && text(hint.chip, 1024) && integer(hint.count))));
  }
  if (!keys(value, ["rows", "version"]) || !text(value.version, 1024) || !value.version.length || !Array.isArray(value.rows) || value.rows.length !== 4) return false;
  const ids = ["archetype", "outside", "extra", "staples"];
  const shown: number[] = [];
  for (let at = 0; at < ids.length; at++) {
    const row = value.rows[at];
    if (!object(row) || !keys(row, ["id", "cards", "state", "hint", "minimumMainCards", "mainCards"]) || row.id !== ids[at]
      || !Array.isArray(row.cards) || row.cards.length > (row.id === "staples" ? 6 : 12) || !row.cards.every(rankedCard)) return false;
    if (row.id === "extra" && query.deck.main.length < 40) {
      if (row.state !== "hint" || row.cards.length || row.hint !== "Add 40 Main Deck cards." || row.minimumMainCards !== 40 || row.mainCards !== query.deck.main.length) return false;
    } else if (row.state !== "ready" || row.hint !== undefined || row.minimumMainCards !== undefined || row.mainCards !== undefined) return false;
    shown.push(...row.cards.map(card => card.passcode));
  }
  return new Set(shown).size === shown.length && value.rows[3].cards.length <= Math.floor(shown.length / 4);
}

/** Stable multiset keys preserve copies and share one cache across all route module graphs. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.every(entry => typeof entry === "number") ? [...value].sort((a, b) => a - b) : value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
}

/** Every reuse is authorized and freshness-checked by the signed host. Never scans the web catalog. */
export async function loadDeckSuggestions<T extends DeckSuggestionQuery>(input: { guildId: string; userId: number; query: T }): Promise<
  { ok: true; result: ResultFor<T> } | { ok: false; response: NextResponse }> {
  const query = parseDeckSuggestionQuery(input.query);
  if (!query) return failure("Invalid deck suggestion query", 400);
  const db = getDb();
  const player = createPlayerService(db).findByGuildAndUser(input.guildId, input.userId);
  if (!player) return failure("Player access is required for deck suggestions", 403);
  let cache = caches.get(db);
  if (!cache) { cache = new Map(); caches.set(db, cache); }
  const key = createHash("sha256").update(JSON.stringify(stable({ guildId: input.guildId, userId: input.userId, playerId: player.id, query }))).digest("hex");
  const saved = cache.get(key);
  const cached = saved ? JSON.parse(saved) as Cached : undefined;
  const response = await callDuelHost({ op: "deck-suggestions", guildId: input.guildId, playerId: player.id, userId: input.userId,
    suggestionQuery: query, ...(cached ? { suggestionVersion: cached.contextVersion } : {}) });
  if (!response.ok) return response;
  const data = response.data;
  if (!object(data) || !version(data.contextVersion)) return failure("Invalid engine suggestion response", 502);
  if (data.notModified === true) {
    if (!keys(data, ["contextVersion", "notModified"]) || !cached || data.contextVersion !== cached.contextVersion) return failure("Invalid engine suggestion response", 502);
    cache.delete(key); cache.set(key, saved!);
    return { ok: true, result: JSON.parse(saved!).result as ResultFor<T> };
  }
  if (!keys(data, ["contextVersion", "result"]) || !validResult(data.result, query)) return failure("Invalid engine suggestion response", 502);
  const completed = JSON.stringify({ contextVersion: data.contextVersion, result: data.result });
  cache.delete(key); cache.set(key, completed);
  while (cache.size > 64) cache.delete(cache.keys().next().value!);
  return { ok: true, result: JSON.parse(completed).result as ResultFor<T> };
}
