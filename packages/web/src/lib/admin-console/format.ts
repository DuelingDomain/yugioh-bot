/** "12s ago", "3 min ago", "2 h ago", "4 d ago". Future values read as "just now". */
export function ago(time: number | null | undefined, now: number = Date.now()): string {
  if (time === null || time === undefined || !Number.isFinite(time)) return "never";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function count(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : n.toLocaleString("en-US");
}

/** "42s", "25m", "1h 04m", "2d 03h". Negative values read as 0s. */
export function duration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${String(min % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, "0")}h`;
}

/** Bytes in GB with one decimal (decimal units, as disk tools show them). */
export function gb(bytes: number): string {
  const value = bytes / 1e9;
  return value >= 100 ? `${Math.round(value)} GB` : value >= 1 ? `${value.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/** "ann@example.com" -> "a**@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}${"*".repeat(Math.min(at - 1, 6))}${email.slice(at)}`;
}

/** "1 person" / "2 people" style plural. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
