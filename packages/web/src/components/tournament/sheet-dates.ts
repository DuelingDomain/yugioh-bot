// SQLite `current_timestamp` values are UTC with a space and no zone ("2026-09-25 20:04:11").
// These pages fetch on the client, so formatting in the viewer's zone cannot mismatch hydration.

export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(value);
  const date = new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clock(date: Date, timeZone?: string): string {
  return date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
    .replace(/ /g, " ")
    .replace(":00 ", " ");
}

/** "Fri, Sep 25 · 8:04 PM"; whole hours drop the minutes: "Fri, Oct 2 · 11 PM". */
export function formatWhen(value: string | null | undefined, timeZone?: string): string | null {
  const date = parseDbTime(value);
  if (!date) return null;
  const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  return `${day} · ${clock(date, timeZone)}`;
}

/** "Wed 9:42 PM" within the last six days, otherwise "Sep 18" (with the year when it differs). */
export function formatRecent(value: string | null | undefined, now = new Date(), timeZone?: string): string | null {
  const date = parseDbTime(value);
  if (!date) return null;
  const age = now.getTime() - date.getTime();
  if (age >= 0 && age < 6 * 24 * 60 * 60 * 1000) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone });
    return `${weekday} ${clock(date, timeZone)}`;
  }
  const year = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", timeZone });
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone,
    ...(year(date) !== year(now) ? { year: "numeric" } : {}),
  });
}
