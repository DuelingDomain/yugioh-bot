import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCardPasscodeRemaps } from "@yugidraft/shared/db";

export interface CardBlockEntry {
  code: number;
  reason: string;
  /** Automatic script policy: these exact passcodes only, without alias traversal. */
  exactCodes?: readonly number[];
}

let repositoryEntries: readonly CardBlockEntry[] | undefined;
const remappedRepositoryEntries = new Map<string, readonly CardBlockEntry[]>();

/** Admission policy belongs to the deployed server package, outside the engine bundle. Restart after editing. */
function readCardBlockList(path?: string | URL): readonly CardBlockEntry[] {
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

/** Resolve graduated prerelease codes using this catalog's validated bundle remaps. */
export function loadCardBlockList(path?: string | URL, dataDirectory?: string): readonly CardBlockEntry[] {
  const entries = readCardBlockList(path);
  if (!dataDirectory || !entries.length) return entries;
  const directory = resolve(dataDirectory);
  if (path === undefined) {
    const cached = remappedRepositoryEntries.get(directory);
    if (cached) return cached;
  }
  const remaps = loadCardPasscodeRemaps(directory);
  const mapped = entries.map(entry => ({ ...entry, code: remaps.get(entry.code) ?? entry.code }));
  if (path === undefined) remappedRepositoryEntries.set(directory, mapped);
  return mapped;
}

const merged = new WeakMap<readonly CardBlockEntry[], WeakMap<readonly CardBlockEntry[], readonly CardBlockEntry[]>>();
/** Stable manual-first admission identity until either source changes. */
export function mergeCardBlockEntries(manual: readonly CardBlockEntry[], automatic: readonly CardBlockEntry[]): readonly CardBlockEntry[] {
  if (!automatic.length) return manual;
  let byAuto = merged.get(manual);
  if (!byAuto) { byAuto = new WeakMap(); merged.set(manual, byAuto); }
  let entries = byAuto.get(automatic);
  if (!entries) { entries = [...manual, ...automatic]; byAuto.set(automatic, entries); }
  return entries;
}
const indexes = new WeakMap<ReadonlyMap<number, { alias?: number }>, WeakMap<readonly CardBlockEntry[], Map<number, CardBlockEntry>>>();

/** Blocks every passcode connected by an alias, including chains, reverse links and other named variants. */
export function cardBlockIndex(
  catalog: ReadonlyMap<number, { alias?: number }>,
  entries?: readonly CardBlockEntry[],
  dataDirectory?: string,
): ReadonlyMap<number, CardBlockEntry> {
  entries ??= loadCardBlockList(undefined, dataDirectory);
  let byEntries = indexes.get(catalog);
  if (!byEntries) { byEntries = new WeakMap(); indexes.set(catalog, byEntries); }
  const cached = byEntries.get(entries);
  if (cached) return cached;
  const index = new Map<number, CardBlockEntry>();
  byEntries.set(entries, index);
  if (!entries.length) return index;

  const links = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const linked = links.get(from) ?? [];
    linked.push(to);
    links.set(from, linked);
  };
  for (const [code, card] of entries.some(entry => !entry.exactCodes) ? catalog : []) {
    if (!card.alias) continue;
    add(code, card.alias);
    add(card.alias, code);
  }
  for (const entry of entries) {
    if (entry.exactCodes) {
      for (const code of entry.exactCodes) if (!index.has(code)) index.set(code, entry);
      continue;
    }
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
