/**
 * The one time zone of the admin console: US Eastern (EST in winter, EDT in summer), shown as "ET".
 * Every time, date and day boundary in /admin goes through the shared helper (the Discord bot uses the same one) and the
 * formatters below, which keep the old en-GB shapes (day before month, 24-hour clock) and only fix the zone.
 */
import { EASTERN_TIME_LABEL, EASTERN_TIME_ZONE, easternDayKey } from "@yugidraft/shared/util/eastern-time";

export { easternDayKey, easternDayKeys, easternDayStart, easternMidnight } from "@yugidraft/shared/util/eastern-time";
export const ADMIN_TIME_ZONE = EASTERN_TIME_ZONE;
export const ADMIN_TIME_ZONE_LABEL = EASTERN_TIME_LABEL;

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) { found = new Intl.DateTimeFormat(locale, { ...options, timeZone: ADMIN_TIME_ZONE }); cache.set(key, found); }
  return found;
}

/* ---------- display (en-GB: day before month, 24-hour clock) ---------- */
const show = (ms: number, options: Intl.DateTimeFormatOptions) => formatter("en-GB", options).format(ms);

/** "14:05" */
export const formatClock = (ms: number) => show(ms, { hour: "2-digit", minute: "2-digit", hour12: false });
/** "25 Oct" */
export const formatDayMonth = (ms: number) => show(ms, { day: "numeric", month: "short" });
/** "25 Oct 2026", day padded ("05 Oct 2026") */
export const formatDate = (ms: number) => show(ms, { day: "2-digit", month: "short", year: "numeric" });
/** "25 Oct, 14:05" */
export const formatDayMonthClock = (ms: number) => show(ms, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** "Sun 25 Oct" */
export const formatWeekdayDate = (ms: number) => show(ms, { weekday: "short", day: "numeric", month: "short" });
/** "25 Oct", or "25 Oct 2025" when the year is not the current Eastern year. */
export const formatDayMonthUnlessThisYear = (ms: number, now: number = Date.now()) =>
  easternDayKey(ms).slice(0, 4) === easternDayKey(now).slice(0, 4) ? formatDayMonth(ms) : show(ms, { day: "numeric", month: "short", year: "numeric" });
