import { easternDayKey, easternMidnight } from "./time";
import { DUEL_RANGE_MAX_DAYS, type DuelRangeInfo, type DuelRangePreset } from "./types";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar arithmetic on a "YYYY-MM-DD" key. A 23 h or 25 h day counts once. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string): number => {
  const parse = (key: string) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(to) - parse(from)) / 86_400_000) + 1;
};

const isRealDay = (key: string): boolean => DAY_KEY.test(key) && addDays(key, 0) === key;

export function rangeOf(from: string, to: string): DuelRangeInfo {
  const days = daysBetween(from, to);
  const previousFrom = addDays(from, -days);
  const previousTo = addDays(from, -1);
  return {
    from, to, days, fromMs: easternMidnight(from), toMs: easternMidnight(addDays(to, 1)),
    previous: { from: previousFrom, to: previousTo, fromMs: easternMidnight(previousFrom), toMs: easternMidnight(from) },
  };
}

export type RangeResult = { ok: true; range: DuelRangeInfo } | { ok: false; message: string };

/**
 * The Eastern day range of a request: `?range=today|7d|30d`, or `?from=YYYY-MM-DD&to=YYYY-MM-DD` for a custom one.
 * Days are Eastern. A `to` after today is cut to today. No range given means today. At most DUEL_RANGE_MAX_DAYS days.
 */
export function resolveDuelRange(query: URLSearchParams | undefined, now: number): RangeResult {
  const today = easternDayKey(now);
  const from = query?.get("from") ?? null;
  const to = query?.get("to") ?? null;
  if (from !== null || to !== null) {
    if (from === null || to === null || !isRealDay(from) || !isRealDay(to)) return { ok: false, message: "Give both dates as YYYY-MM-DD." };
    const last = to > today ? today : to;
    if (from > last) return { ok: false, message: "The first day is after the last day." };
    if (daysBetween(from, last) > DUEL_RANGE_MAX_DAYS) return { ok: false, message: `A range is at most ${DUEL_RANGE_MAX_DAYS} days.` };
    return { ok: true, range: rangeOf(from, last) };
  }
  const preset = (query?.get("range") ?? "today") as DuelRangePreset;
  const length = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "today" ? 1 : 0;
  if (length === 0) return { ok: false, message: "Unknown range." };
  return { ok: true, range: rangeOf(addDays(today, 1 - length), today) };
}
