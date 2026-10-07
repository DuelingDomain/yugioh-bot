import { normalizeImportedCardName } from "@yugidraft/shared/services";
import { parseDeckText } from "@/components/duel/ydk";
import { IMPORT_MAX_DISTINCT, tooManyDistinct, YDK_MAX_CHARS } from "./ydk-file";

export const LIST_MAX_CHARS = YDK_MAX_CHARS;

export interface CardListEntry {
  query: string | number;
  copies: number;
  pool: "main" | "extra";
  /** Trimmed input line, including count and notes, for not-found diagnostics. */
  original: string;
}

export class CardListError extends Error {}

/** Parse list syntax only. Unknown names and prose titles remain entries for resolution to report. */
export function parseCardList(text: string): CardListEntry[] {
  if (typeof text !== "string" || !text.trim()) throw new CardListError("Add a card list file or paste a list.");
  if (text.length > LIST_MAX_CHARS) throw new CardListError("That list text is too large. The limit is 64 Ki characters.");
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let entries: CardListEntry[] = [];
  const isYdk = lines.some((line) => /^#(?:main|extra|deckmaster)|^!side/i.test(line))
    && lines.every((line) => /^(?:#|\/\/|!)/.test(line) || /^\d{1,10}$/.test(line));
  if (/^ydke:\/\//i.test(clean.trim()) || isYdk || lines.some((line) => /^#deckmaster/i.test(line))) {
    const deck = parseDeckText(/^ydke:\/\//i.test(clean.trim()) ? clean : `#main\n${clean}`);
    entries = [
      ...[...deck.main, ...deck.side, ...(deck.deckMaster == null ? [] : [deck.deckMaster])]
        .map((query): CardListEntry => ({ query, copies: 1, pool: "main", original: String(query) })),
      ...deck.extra.map((query): CardListEntry => ({ query, copies: 1, pool: "extra", original: String(query) })),
    ];
  } else {
    let pool: "main" | "extra" = "main";
    for (const original of lines) {
      if (/^(?:#extra|extra(?: deck)?\s*:)$/i.test(original)) { pool = "extra"; continue; }
      if (/^(?:#main|main(?: deck)?\s*:|!side|#side|side(?: deck)?\s*:)$/i.test(original)) { pool = "main"; continue; }
      if (/^(?:#|\/\/)/.test(original)) continue;
      let query = original;
      // Peel trailing notes, leaving (xN) for the count parser.
      while (/\s*\([^()]*\)\s*$/.test(query) && !/\(x\d+\)\s*$/i.test(query)) {
        query = query.replace(/\s*\([^()]*\)\s*$/, "").trim();
      }
      let copies = 1;
      const prefix = /^(?:([0-9]+)\s*x?\s+|x([0-9]+)\s+)(.+)$/i.exec(query);
      const suffix = /^(.*?)\s+(?:x([0-9]+)|\(x([0-9]+)\))$/i.exec(query);
      if (prefix) { copies = Number(prefix[1] ?? prefix[2]); query = prefix[3]; }
      else if (suffix) { copies = Number(suffix[2] ?? suffix[3]); query = suffix[1]; }
      if (!Number.isSafeInteger(copies) || copies <= 0) throw new CardListError(`Invalid copy count in "${original}".`);
      query = query.trim();
      entries.push({ query: /^\d{1,10}$/.test(query) && Number(query) > 0 ? Number(query) : query, copies, pool, original });
    }
  }
  const distinct = new Set(entries.map(({ query }) => typeof query === "number" ? `id:${query}` : `name:${normalizeImportedCardName(query)}`));
  if (distinct.size > IMPORT_MAX_DISTINCT) throw new CardListError(tooManyDistinct(distinct.size));
  return entries;
}
