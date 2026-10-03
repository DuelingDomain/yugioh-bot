/** Pure helpers for the new tournament form: size table, deadline and picker maths. */

export type TournamentFormat = "round_robin" | "single_elim";

export interface SizeTable {
  caption: string;
  players: number[];
  matches: number[];
  /** Only single elimination has rounds. */
  rounds?: number[];
}

/** Round robin: everyone plays everyone once. */
export function roundRobinMatches(players: number): number {
  return (players * (players - 1)) / 2;
}

/** Single elimination: one match knocks out one player. */
export function singleElimMatches(players: number): number {
  return Math.max(players - 1, 0);
}

export function singleElimRounds(players: number): number {
  return players <= 1 ? 0 : Math.ceil(Math.log2(players));
}

export function sizeTable(format: TournamentFormat): SizeTable {
  if (format === "single_elim") {
    const players = [4, 8, 16];
    return {
      caption: "How big single elimination gets",
      players,
      matches: players.map(singleElimMatches),
      rounds: players.map(singleElimRounds),
    };
  }
  const players = [4, 6, 8, 12];
  return { caption: "How big a round robin gets", players, matches: players.map(roundRobinMatches) };
}

export function formatName(format: TournamentFormat): string {
  return format === "single_elim" ? "Single elimination" : "Round robin";
}

/* ---------- deadline ---------- */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `now` to `target`, in local time. */
export function daysBetween(now: Date, target: Date): number {
  const a = startOfDay(now).getTime();
  const b = startOfDay(target).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function daysAwayLabel(now: Date, target: Date): string {
  const days = daysBetween(now, target);
  if (days < 0) return "in the past";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days away`;
}

/** "8 days from today", "tomorrow", "today". */
export function daysFromTodayLabel(now: Date, target: Date): string {
  const days = daysBetween(now, target);
  if (days < 0) return "In the past";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days from today`;
}

export function formatDateButton(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Fri, Oct 9, 11 PM" for the summary; whole hours drop the minutes. */
export function formatClosesAt(d: Date): string {
  const time = d.getMinutes() === 0 ? d.toLocaleTimeString("en-US", { hour: "numeric" }) : formatTime(d);
  return `${formatDateShort(d)}, ${time}`;
}

/** The time choices: half-hour steps, plus 11:59 PM. */
export function timeOptions(): Array<{ minutes: number; label: string }> {
  const out: Array<{ minutes: number; label: string }> = [];
  for (let m = 0; m < 24 * 60; m += 30) out.push({ minutes: m, label: formatTime(new Date(2000, 0, 1, 0, m)) });
  out.push({ minutes: 23 * 60 + 59, label: formatTime(new Date(2000, 0, 1, 23, 59)) });
  return out;
}

/** The deadline used when someone picks a day without having picked a time yet. */
export const DEFAULT_DEADLINE_MINUTES = 23 * 60 + 59;

export function withDay(base: Date | null, day: Date): Date {
  const minutes = base ? base.getHours() * 60 + base.getMinutes() : DEFAULT_DEADLINE_MINUTES;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
}

export function withMinutes(base: Date, minutes: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/* ---------- calendar ---------- */

export interface CalendarCell {
  /** null for the blank cells before the 1st. */
  date: Date | null;
}

/** Monday-first month grid: leading blanks, then one cell per day. */
export function monthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ date: null });
  for (let d = 1; d <= count; d++) cells.push({ date: new Date(year, month, d) });
  return cells;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** The browser's time zone, e.g. "America/New_York"; falls back to an empty string. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
