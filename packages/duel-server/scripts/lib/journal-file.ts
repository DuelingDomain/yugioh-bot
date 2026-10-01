/**
 * Reads a duel journal file. Two layouts hold the same journal (format "yugidraft-duel-journal/1"):
 *  - one JSON object with a `commands` array (the E2E `duel-journal-<slug>.json`);
 *  - JSON lines (the host report `journal.jsonl`): a header line, then one line per command at its seq.
 *    Lines with a `seat` and a `command` are commands. Lines of `type` `surrender` only mark a surrender; replay ignores them.
 */
export const JOURNAL_FORMAT = "yugidraft-duel-journal/1";

export function parseJournalText(text: string): Record<string, any> {
  try {
    const whole = JSON.parse(text);
    if (whole && typeof whole === "object" && !Array.isArray(whole)) return whole as Record<string, any>;
  } catch {
    // Not one JSON value: read it as JSON lines below.
  }
  let header: Record<string, any> | null = null;
  const commands: Array<{ seq?: number; seat: number; command: unknown }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value?.format === JOURNAL_FORMAT) header = { ...value, commands: [...(value.commands ?? [])] };
    else if (value && typeof value.seat === "number" && value.command) commands.push(value);
  }
  if (!header) throw new Error(`No journal header line (format ${JOURNAL_FORMAT})`);
  commands.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  header.commands = [...header.commands, ...commands];
  return header;
}
