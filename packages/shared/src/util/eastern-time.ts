/**
 * US Eastern time (America/New_York): EST in winter, EDT in summer, shown as "ET".
 * The one definition of "a day" for the admin console on the web and the community stats in the Discord bot.
 * Intl does the daylight-saving work, so a day can be 23 or 25 hours long and nothing here assumes 24.
 * No Node-only imports: the browser and the server both use it.
 */
export const EASTERN_TIME_ZONE = "America/New_York";
export const EASTERN_TIME_LABEL = "ET";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
});

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };
function partsOf(ms: number): Parts {
  const out: Record<string, number> = {};
  for (const part of PARTS.formatToParts(ms)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour, mi: out.minute, s: out.second };
}

/** Milliseconds east of UTC at that instant (-4 h in summer, -5 h in winter). */
function offsetAt(ms: number): number {
  const p = partsOf(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Eastern calendar day of an instant, "YYYY-MM-DD". */
export function easternDayKey(ms: number): string {
  const p = partsOf(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The instant (epoch ms) of 00:00 Eastern on a "YYYY-MM-DD" day. Two passes, because the offset can change at 02:00 that day. */
export function easternMidnight(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetAt(wall + 12 * 3_600_000);
  return wall - offsetAt(guess);
}

/** Start of the Eastern day that holds `ms`, as epoch ms. */
export const easternDayStart = (ms: number): number => easternMidnight(easternDayKey(ms));

/** `count` Eastern day keys, oldest first; the last one is the day of `now`. Calendar arithmetic, so a 23 h or 25 h day counts once. */
export function easternDayKeys(now: number, count: number): string[] {
  const [y, m, d] = easternDayKey(now).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10));
}
