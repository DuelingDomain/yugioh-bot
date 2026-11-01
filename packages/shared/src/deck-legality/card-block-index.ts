export interface CardBlockEntry {
  code: number;
  reason: string;
  /** Automatic script policy: these exact passcodes only, without alias traversal. */
  exactCodes?: readonly number[];
}

const indexes = new WeakMap<ReadonlyMap<number, { alias?: number }>, WeakMap<readonly CardBlockEntry[], Map<number, CardBlockEntry>>>();

/** Blocks every passcode connected by an alias, including chains, reverse links and other named variants. */
export function cardBlockIndex(
  catalog: ReadonlyMap<number, { alias?: number }>,
  entries: readonly CardBlockEntry[],
): ReadonlyMap<number, CardBlockEntry> {
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
