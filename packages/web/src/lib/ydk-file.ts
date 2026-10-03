/**
 * Cube YDK files: `#main`, `#extra` and `!side` sections, one passcode per line, `#` comments.
 * One line is one copy, so a passcode on three lines is three copies. Reading a file uses the
 * deck parser in `components/duel/ydk`; this file writes one and merges copies.
 */

/** Copies of one card a cube can hold. Mirrors MAX_CUBE_COPIES in shared. */
export const YDK_MAX_COPIES = 99;
/** Longest YDK text the import accepts (64 KB). A full deck file is a few KB. */
export const YDK_MAX_CHARS = 64 * 1024;
/** Different passcodes one import may hold. Each unknown one costs a lookup in the card database. */
export const IMPORT_MAX_DISTINCT = 1000;

/** The 400 message for an import with too many different passcodes. */
export const tooManyDistinct = (count: number): string =>
  `That list has ${count} different cards. Import at most ${IMPORT_MAX_DISTINCT} at a time.`;

export interface YdkEntry {
  catalogCardId: number;
  maxCopies: number;
}

/** A cube as a YDK file: every copy of the main pool, then every copy of the extra pool, an empty side. */
export function serializeYdk(main: readonly YdkEntry[], extra: readonly YdkEntry[]): string {
  const lines = ["#created by Duelists Kingdom", "#main"];
  for (const entry of main) for (let i = 0; i < entry.maxCopies; i += 1) lines.push(String(entry.catalogCardId));
  lines.push("#extra");
  for (const entry of extra) for (let i = 0; i < entry.maxCopies; i += 1) lines.push(String(entry.catalogCardId));
  lines.push("!side");
  return `${lines.join("\n")}\n`;
}

/**
 * Add `codes` (one per copy) on top of the copies a cube already holds. Returns a code list with
 * each passcode repeated for its new total, capped at 99, ready for the passcode import.
 */
export function mergeCopies(codes: readonly number[], existing: ReadonlyMap<number, number>): number[] {
  const counts = new Map<number, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  const merged: number[] = [];
  for (const [code, count] of counts) {
    const total = Math.min(YDK_MAX_COPIES, (existing.get(code) ?? 0) + count);
    for (let i = 0; i < total; i += 1) merged.push(code);
  }
  return merged;
}

/** `<cube name>.ydk` with characters a file name cannot hold replaced. */
export function ydkFileName(cubeName: string): string {
  const base = cubeName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return `${base || "cube"}.ydk`;
}
