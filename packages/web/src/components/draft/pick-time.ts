/** "45 s", "1 min", "1 min 30 s", "10 min". For pick clocks. */
export function formatPickSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const min = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${min} min ${s} s` : `${min} min`;
}
