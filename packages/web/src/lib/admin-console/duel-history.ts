import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveDuelRange } from "./duel-range";
import { adminGate, adminJson, failed, notConfigured, ok } from "./section";
import { TODAY_COLUMNS, toTodayDuels, type TodayRow } from "./today";
import type { DuelHistoryPage, DuelRangeInfo } from "./types";

export const HISTORY_PAGE = 50;
const HISTORY_MAX_PAGE = 100;
const DAY_MS = 24 * 60 * 60_000;
export const HISTORY_TABS = ["all", "1v1", "multi", "ranked"] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number];

const TAB_SQL: Record<HistoryTab, string> = {
  all: "1 = 1",
  "1v1": "d.format not in ('tag', 'ffa3', 'ffa4')",
  multi: "d.format in ('tag', 'ffa3', 'ffa4')",
  ranked: "d.ranked = 1",
};
/** Same practice-bot and test-duel flags as the stats, so the tab counts and the stats agree. */
const COUNTED = `(@all = 1 or ((case when json_valid(d.setup_json) then coalesce(json_extract(d.setup_json, '$.testDuel'), 0) else 0 end) = 0
  and not exists(select 1 from duel_seats bs where bs.duel_id = d.id and bs.is_bot = 1)))`;
/** Start of the duel in whole seconds: one stable integer to order and page by, whatever shape the text was stored in. */
const START_SECONDS = "cast(strftime('%s', d.started_at) as integer)";

export function parseCursor(value: string | null): { seconds: number; id: number } | null {
  const match = /^(\d{1,12}):(\d{1,12})$/.exec(value ?? "");
  return match ? { seconds: Number(match[1]), id: Number(match[2]) } : null;
}

/**
 * Engine duels of the guild that started in the range, newest first, one page at a time (keyset on start second and id).
 * Same read as the day list: duels_play_history_idx bounds the scan from one day before the first start, started_at picks the
 * range exactly. The tab counts cover the whole range and come with the first page only.
 */
export function loadDuelHistory(db: Database.Database, guild: string, range: DuelRangeInfo, opts: {
  includeBots: boolean; tab: HistoryTab; before: { seconds: number; id: number } | null; limit: number; now: number;
}): DuelHistoryPage {
  const base = {
    guild, floor: new Date(range.fromMs - DAY_MS).toISOString(), from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString(),
    all: opts.includeBots ? 1 : 0,
  };
  const scope = `d.guild_id = @guild and d.kind = 'play' and d.started_at is not null
      and julianday(coalesce(d.ended_at, d.created_at)) >= julianday(@floor)
      and julianday(d.started_at) >= julianday(@from) and julianday(d.started_at) < julianday(@to) and ${COUNTED}`;
  const limit = Math.min(Math.max(opts.limit, 1), HISTORY_MAX_PAGE);

  const rows = db.prepare(`
    select ${TODAY_COLUMNS}, ${START_SECONDS} as start_seconds, 0 as n_all, 0 as n_multi, 0 as n_ranked
    from duels d
    where ${scope} and ${TAB_SQL[opts.tab]}
      and (@hasBefore = 0 or ${START_SECONDS} < @beforeSeconds or (${START_SECONDS} = @beforeSeconds and d.id < @beforeId))
    order by ${START_SECONDS} desc, d.id desc
    limit @limit`).all({
    ...base, hasBefore: opts.before ? 1 : 0, beforeSeconds: opts.before?.seconds ?? 0, beforeId: opts.before?.id ?? 0, limit: limit + 1,
  }) as (TodayRow & { start_seconds: number })[];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  let counts: DuelHistoryPage["counts"];
  if (!opts.before) {
    const c = db.prepare(`
      select count(*) as n_all, coalesce(sum(d.format in ('tag', 'ffa3', 'ffa4')), 0) as n_multi, coalesce(sum(d.ranked = 1), 0) as n_ranked
      from duels d where ${scope}`).get(base) as { n_all: number; n_multi: number; n_ranked: number };
    counts = { all: c.n_all, oneVsOne: c.n_all - c.n_multi, multi: c.n_multi, ranked: c.n_ranked };
  }
  return {
    range, includeBots: opts.includeBots, ...(counts ? { counts } : {}),
    duels: toTodayDuels(db, page, opts.now, range.fromMs),
    next: more && last ? `${last.start_seconds}:${last.id}` : null,
  };
}

/** GET /api/admin/console/duel-history?range=|from=&to=, &tab=all|1v1|multi|ranked, &bots=1, &before=<cursor>, &limit=. */
export async function duelHistoryResponse(request: Request): Promise<Response> {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const now = Date.now();
  const guild = env.discordGuildId;
  if (!guild) return adminJson(notConfigured("Set DISCORD_GUILD_ID to list the duels.", now));
  const query = new URL(request.url).searchParams;
  const range = resolveDuelRange(query, now);
  if (!range.ok) return adminJson(failed(range.message, now), 400);
  const tab = (HISTORY_TABS as readonly string[]).includes(query.get("tab") ?? "") ? (query.get("tab") as HistoryTab) : "all";
  const before = parseCursor(query.get("before"));
  if (query.get("before") && !before) return adminJson(failed("The page marker is not valid.", now), 400);
  const limit = Number(query.get("limit")) || HISTORY_PAGE;
  try {
    return adminJson(ok(loadDuelHistory(getDb(), guild, range.range, { includeBots: query.get("bots") === "1", tab, before, limit, now }), now));
  } catch {
    return adminJson(failed("The duels could not be read from the database.", now));
  }
}
