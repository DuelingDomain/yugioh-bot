import { readFileSync } from "node:fs";

export interface CardBlockEntry {
  code: number;
  reason: string;
}

let repositoryEntries: readonly CardBlockEntry[] | undefined;

/** Admission policy belongs to the deployed server package, outside the engine bundle. Restart after editing. */
export function loadCardBlockList(path?: string | URL): readonly CardBlockEntry[] {
  if (path === undefined && repositoryEntries) return repositoryEntries;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path ?? new URL("../card-block-list.json", import.meta.url), "utf8"));
  } catch (error) {
    throw new Error(`Cannot load card-block-list.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) throw new Error("Invalid card-block-list.json: expected an array of { code, reason } entries");
  const codes = new Set<number>();
  const entries: CardBlockEntry[] = value.map((entry: unknown, index) => {
    if (entry === null || typeof entry !== "object") throw new Error(`Invalid card-block-list.json entry ${index + 1}`);
    const { code, reason } = entry as Partial<CardBlockEntry>;
    if (!Number.isSafeInteger(code) || typeof code !== "number" || code <= 0 || code > 0xffffffff) {
      throw new Error(`Invalid card-block-list.json entry ${index + 1}: code must be a positive passcode`);
    }
    if (typeof reason !== "string" || !reason.trim()) throw new Error(`Invalid card-block-list.json entry ${index + 1}: reason is required`);
    if (codes.has(code)) throw new Error(`Invalid card-block-list.json: duplicate code ${code}`);
    codes.add(code);
    return { code, reason: reason.trim() };
  });
  if (path === undefined) repositoryEntries = entries;
  return entries;
}

const indexes = new WeakMap<ReadonlyMap<number, { alias?: number }>, { entries: readonly CardBlockEntry[]; index: Map<number, CardBlockEntry> }>();

/** Blocks every passcode connected by an alias, including chains, reverse links and other named variants. */
export function cardBlockIndex(
  catalog: ReadonlyMap<number, { alias?: number }>,
  entries: readonly CardBlockEntry[] = loadCardBlockList(),
): ReadonlyMap<number, CardBlockEntry> {
  const cached = indexes.get(catalog);
  if (cached?.entries === entries) return cached.index;
  const index = new Map<number, CardBlockEntry>();
  indexes.set(catalog, { entries, index });
  if (!entries.length) return index;

  const links = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const linked = links.get(from) ?? [];
    linked.push(to);
    links.set(from, linked);
  };
  for (const [code, card] of catalog) {
    if (!card.alias) continue;
    add(code, card.alias);
    add(card.alias, code);
  }
  for (const entry of entries) {
    const pending = [entry.code];
    while (pending.length) {
      const code = pending.pop()!;
      if (index.has(code)) continue;
      index.set(code, entry);
      pending.push(...links.get(code) ?? []);
    }
  }
  return index;
}
