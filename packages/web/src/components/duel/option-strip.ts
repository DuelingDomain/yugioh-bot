/**
 * Pure helpers for the activate-a-card strip ("You can respond", mandatory chain links).
 * The strip shows only the cards. When one card has more than one option, its cards look the same,
 * so they get one short line that tells the effects apart.
 */

/** The first short phrase of an effect text, one line: up to the first sentence end, colon or semicolon. */
export function shortEffectLabel(text: string, max = 56): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const stop = clean.search(/[.:;](?:\s|$)/);
  const first = (stop > 0 ? clean.slice(0, stop) : clean).trim();
  if (first.length <= max) return first;
  const room = first.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

export interface OptionNote {
  /** The one short line under the card. */
  detail: string;
  /** The full effect text, for the tooltip. */
  title: string;
}

/**
 * One note per option, in order. Only options whose card has more than one option get a note
 * (null for the rest). The note is the short effect label; when two options of one card would show
 * the same line, or an option has no text, it reads "Effect N" (N counts that card's options).
 */
export function optionNotes(entries: ReadonlyArray<{ code: number | null; effect: string }>): Array<OptionNote | null> {
  const groups = new Map<number, number[]>();
  entries.forEach((entry, index) => {
    if (entry.code == null) return;
    const list = groups.get(entry.code);
    if (list) list.push(index);
    else groups.set(entry.code, [index]);
  });
  const notes: Array<OptionNote | null> = entries.map(() => null);
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const labels = indexes.map((index) => shortEffectLabel(entries[index].effect));
    indexes.forEach((index, position) => {
      const label = labels[position];
      const clash = labels.some((other, otherPosition) => otherPosition !== position && other.toLowerCase() === label.toLowerCase());
      const detail = !label ? `Effect ${position + 1}` : clash ? `Effect ${position + 1} · ${label}` : label;
      const full = entries[index].effect.replace(/\s+/g, " ").trim();
      notes[index] = { detail, title: full && full !== detail ? full : detail };
    });
  }
  return notes;
}
