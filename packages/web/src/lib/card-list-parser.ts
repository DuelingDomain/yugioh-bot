import { normalizeImportedCardName } from "@yugidraft/shared/services";
import { parseDeckText } from "@/components/duel/ydk";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { IMPORT_MAX_DISTINCT, tooManyDistinct, YDK_MAX_CHARS } from "./ydk-file";

export const LIST_MAX_CHARS = YDK_MAX_CHARS;

export interface CardListEntry {
  query: string | number;
  copies: number;
  pool: "main" | "extra";
  /** Trimmed input line, including count and notes, for not-found diagnostics. */
  original: string;
  /** A bare leading number can also be part of a printed name, e.g. 7 Colored Fish. */
  fallbackName?: string;
  /** Google Doc labels separated by two blank lines that repeat a counted card in their section. */
  heading?: boolean;
  /** The line had a copy count (3 Dark Hole, Dark Hole x3). Section titles and prose rarely do. */
  counted?: boolean;
}

/** No printed card name is this long. A longer line is not matched, so a huge line cannot stall the note regexes. */
export const LIST_LINE_MAX_CHARS = 300;

export class CardListError extends Error {}

/** Parse list syntax only. Unknown names and prose titles remain entries for resolution to report. */
export function parseCardList(text: string): CardListEntry[] {
  if (typeof text !== "string" || !text.trim()) throw new CardListError("Add a card list file or paste a list.");
  if (text.length > LIST_MAX_CHARS) throw new CardListError("That list text is too large. The limit is 64 Ki characters.");
  const clean = text.replace(/^\uFEFF/, "");
  const rawLines = clean.split(/\r?\n/).map((line) => line.trim());
  const lines = rawLines.filter(Boolean);
  let entries: CardListEntry[] = [];
  const isYdk = lines.some((line) => /^#(?:main|extra|deckmaster)|^!side/i.test(line))
    && lines.every((line) => /^(?:#|\/\/|!)/.test(line) || /^\d{1,10}$/.test(line));
  const isYdke = /^ydke:\/\//i.test(clean.trim());
  if (isYdke || isYdk || lines.some((line) => /^#deckmaster/i.test(line))) {
    let deck: DuelDeck;
    try { deck = parseDeckText(isYdke ? clean : `#main\n${clean.replace(/^\s*#side\s*$/gim, "!side")}`); }
    catch (error) { throw new CardListError(error instanceof Error ? error.message : "Invalid deck list."); }
    entries = [
      ...deck.main.map((query): CardListEntry => ({ query, copies: 1, pool: "main", original: String(query) })),
      ...deck.extra.map((query): CardListEntry => ({ query, copies: 1, pool: "extra", original: String(query) })),
      ...[...deck.side, ...(deck.deckMaster == null ? [] : [deck.deckMaster])]
        .map((query): CardListEntry => ({ query, copies: 1, pool: "main", original: String(query) })),
    ];
    if (!isYdke) {
      // The deck parser groups sections. Restore each ID's first appearance in the source file.
      const firstLine = new Map<number, number>();
      rawLines.forEach((line, index) => {
        if (/^\d{1,10}$/.test(line) && !firstLine.has(Number(line))) firstLine.set(Number(line), index);
      });
      entries.sort((a, b) => firstLine.get(a.query as number)! - firstLine.get(b.query as number)!);
    }
  } else {
    let pool: "main" | "extra" = "main";
    const byLine = new Map<number, { entry: CardListEntry; counted: boolean }>();
    for (const [lineIndex, original] of rawLines.entries()) {
      if (!original) continue;
      if (/^(?:#extra|extra(?: deck)?\s*:)$/i.test(original)) { pool = "extra"; continue; }
      if (/^(?:#main|main(?: deck)?\s*:|!side|#side|side(?: deck)?\s*:)$/i.test(original)) { pool = "main"; continue; }
      if (/^(?:#|\/\/)/.test(original)) continue;
      if (original.length > LIST_LINE_MAX_CHARS) {
        // Reported as not found, without a lookup, and with a short copy of the text.
        entries.push({ query: "", copies: 1, pool, original: `${original.slice(0, 80)}…`, heading: true });
        continue;
      }
      let query = original;
      // The last thing on a line may be a [Extra] / [Main] / [Side] marker (a pool hint for this line only) or a
      // (note). Peel both in any order, leaving (xN) for the count parser.
      let linePool = pool;
      let sawMarker = false;
      for (;;) {
        // A marker is also allowed just before a trailing count: "Decode Talker [Extra] x2".
        const marker = /\s*\[(extra|main|side)(?: deck)?\](?=\s+(?:x[0-9]+|\(x[0-9]+\))\s*$|\s*$)/i.exec(query);
        if (marker) {
          // The marker nearest the end of the line wins.
          if (!sawMarker) linePool = marker[1].toLowerCase() === "extra" ? "extra" : "main";
          sawMarker = true;
          query = (query.slice(0, marker.index) + query.slice(marker.index + marker[0].length)).trim();
        } else if (/\s*\([^()]*\)\s*$/.test(query) && !/\(x\d+\)\s*$/i.test(query)) {
          query = query.replace(/\s*\([^()]*\)\s*$/, "").trim();
        } else break;
      }
      if (!query) continue;
      let copies = 1;
      let fallbackName: string | undefined;
      const prefix = /^(?:([0-9]+)\s*x?\s+|x([0-9]+)\s+)(.+)$/i.exec(query);
      const suffix = /^(.*?)\s+(?:x([0-9]+)|\(x([0-9]+)\))$/i.exec(query);
      if (suffix) { copies = Number(suffix[2] ?? suffix[3]); query = suffix[1]; }
      else if (prefix) {
        if (/^[0-9]+\s+/.test(query)) fallbackName = query;
        copies = Number(prefix[1] ?? prefix[2]); query = prefix[3];
      }
      if (!Number.isSafeInteger(copies) || copies <= 0) throw new CardListError(`Invalid copy count in "${original}".`);
      query = query.trim();
      const entry: CardListEntry = { query: /^\d{1,10}$/.test(query) && Number(query) > 0 ? Number(query) : query, copies, pool: linePool, original,
        ...(fallbackName ? { fallbackName } : {}), ...(prefix || suffix ? { counted: true } : {}) };
      entries.push(entry);
      byLine.set(lineIndex, { entry, counted: !!(prefix || suffix) });
    }
    // A Doc export can have a title like "Jinzo" followed by "1 Jinzo". Require a section
    // boundary and a counted duplicate in that block; ordinary bare name lines still mean one copy.
    const hasDocumentPreamble = lines.some((line) => /^Last updated:/i.test(line)) && lines.some((line) => /^Current Size:/i.test(line));
    for (const [index, { entry, counted }] of hasDocumentPreamble ? byLine : []) {
      if (counted || typeof entry.query !== "string" || index < 2 || rawLines[index - 1] || rawLines[index - 2]) continue;
      const name = normalizeImportedCardName(entry.query);
      for (let next = index + 1; next < rawLines.length && rawLines[next]; next++) {
        if (/^(?:#(?:main|extra|side|deckmaster)\b|!side\b|(?:main|extra|side)(?: deck)?\s*:)/i.test(rawLines[next])) break;
        const following = byLine.get(next);
        if (following && !following.counted) break;
        if (following && typeof following.entry.query === "string" && normalizeImportedCardName(following.entry.query) === name) {
          entry.heading = true;
          break;
        }
      }
    }
  }
  const distinct = new Set(entries.map(({ query }) => typeof query === "number" ? `id:${query}` : `name:${normalizeImportedCardName(query)}`));
  if (distinct.size > IMPORT_MAX_DISTINCT) throw new CardListError(tooManyDistinct(distinct.size));
  return entries;
}
