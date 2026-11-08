/**
 * The one time zone of the admin console: US Eastern (EST in winter, EDT in summer), shown as "ET".
 * Every time, date and day boundary in /admin goes through the shared helper (the Discord bot uses the same one) and the
 * formatters below: US Eastern, 12-hour clock with AM/PM, month before day ("Nov 8, 12:28 AM").
 */
import { EASTERN_TIME_LABEL, EASTERN_TIME_ZONE, easternDayKey } from "@yugidraft/shared/util/eastern-time";

export { easternDayKey, easternDayKeys, easternDayStart, easternMidnight } from "@yugidraft/shared/util/eastern-time";
export const ADMIN_TIME_ZONE = EASTERN_TIME_ZONE;
const HOUR = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TIME_ZONE, hour: "numeric", hourCycle: "h23" });
/** The Eastern hour of day (0 to 23) of an instant. */
export const easternHour = (ms: number): number => Number(HOUR.formatToParts(ms).find((part) => part.type === "hour")?.value ?? 0) % 24;
export const ADMIN_TIME_ZONE_LABEL = EASTERN_TIME_LABEL;

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) { found = new Intl.DateTimeFormat(locale, { ...options, timeZone: ADMIN_TIME_ZONE }); cache.set(key, found); }
  return found;
}

/* ---------- display (en-US: month before day, 12-hour clock with AM/PM) ---------- */
// Newer ICU puts a narrow no-break space before AM/PM; a plain space reads the same and wraps like normal text.
const show = (ms: number, options: Intl.DateTimeFormatOptions) => formatter("en-US", { ...options, hour12: true }).format(ms).replace(/[\u202f\u00a0]/g, " ");

/** "12:28 AM" */
export const formatClock = (ms: number) => show(ms, { hour: "numeric", minute: "2-digit" });
/** "Nov 8" */
export const formatDayMonth = (ms: number) => show(ms, { day: "numeric", month: "short" });
/** "Nov 8, 2026" */
export const formatDate = (ms: number) => show(ms, { day: "numeric", month: "short", year: "numeric" });
/** "November 8, 2026" */
export const formatLongDate = (ms: number) => show(ms, { day: "numeric", month: "long", year: "numeric" });
/** "Nov 8, 12:28 AM" */
export const formatDayMonthClock = (ms: number) => show(ms, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
/** "Nov 8, 2026, 12:28 AM" */
export const formatDateClock = (ms: number) => show(ms, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
/** "Sun, Nov 8" */
export const formatWeekdayDate = (ms: number) => show(ms, { weekday: "short", day: "numeric", month: "short" });
/** "Nov 8", or "Nov 8, 2025" when the year is not the current Eastern year. */
export const formatDayMonthUnlessThisYear = (ms: number, now: number = Date.now()) =>
  easternDayKey(ms).slice(0, 4) === easternDayKey(now).slice(0, 4) ? formatDayMonth(ms) : formatDate(ms);
