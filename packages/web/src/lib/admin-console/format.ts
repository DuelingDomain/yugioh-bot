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
