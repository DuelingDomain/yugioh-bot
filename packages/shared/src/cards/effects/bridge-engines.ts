import type { BridgeFormat, BridgeGraphData } from "./bridge-types.js";

export interface BridgeDeck { main: number[]; extra: number[]; deckMaster?: number }
export interface DetectedEngine {
  name: string; weight: number; copies: number; distinct: number;
  status: "engine" | "light"; hybrids: number[]; includes?: string[];
}
export const MAX_BRIDGE_ENGINES = 4;

/** Shares hybrid weight before folding; a Deck Master never supplies a Main identity. */
export function detectDeckEngines(deck: BridgeDeck, groups: BridgeGraphData["groups"], skip: ReadonlySet<number> = new Set()): DetectedEngine[] {
  const memberships = new Map<number, string[]>();
  for (const [name, ids] of Object.entries(groups)) for (const id of new Set(ids)) {
    if (!skip.has(id)) memberships.set(id, [...(memberships.get(id) ?? []), name]);
  }
  const weights = new Map<number, number>(), copies = new Map<number, number>();
  const add = (id: number, weight: number) => {
    if (!memberships.has(id)) return;
    weights.set(id, (weights.get(id) ?? 0) + weight);
    copies.set(id, (copies.get(id) ?? 0) + 1);
  };
  deck.main.forEach(id => add(id, 1)); deck.extra.forEach(id => add(id, 0.5));
  if (deck.deckMaster !== undefined) add(deck.deckMaster, 2);
  const rows = Object.entries(groups).map(([name, ids]) => {
    const contribution = new Map([...new Set(ids)].filter(id => weights.has(id))
      .map(id => [id, weights.get(id)! / memberships.get(id)!.length]));
    return { name, contribution, weight: [...contribution.values()].reduce((a, b) => a + b, 0), includes: [] as string[] };
  }).filter(row => row.weight > 0).sort((a, b) => b.weight - a.weight || groups[b.name]!.length - groups[a.name]!.length || a.name.localeCompare(b.name));
  // Stronger groups own shared identities. Process small groups first so aliases
  // can flow through an intermediate group without losing their contributions.
  const removed = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    const parent = rows.slice(0, i).find(other => {
      const ids = new Set(groups[other.name]);
      const shared = [...row.contribution].reduce((total, [id, weight]) => total + (ids.has(id) ? weight : 0), 0);
      return shared >= 0.8 * row.weight;
    });
    if (!parent) continue;
    for (const [id, weight] of row.contribution) parent.contribution.set(id, (parent.contribution.get(id) ?? 0) + weight);
    parent.weight += row.weight; parent.includes.push(row.name, ...row.includes); removed.add(row.name);
  }
  const threshold = Math.max(3, 0.075 * deck.main.length), main = new Set(deck.main);
  let engines = 0;
  return rows.filter(row => !removed.has(row.name) && row.weight >= 1.5)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).map(row => {
      const ids = [...row.contribution.keys()].sort((a, b) => a - b);
      const eligible = row.weight >= threshold && ids.filter(id => main.has(id)).length >= 2;
      const status = eligible && engines++ < MAX_BRIDGE_ENGINES ? "engine" : "light";
      return { name: row.name, weight: Math.round(row.weight * 1000) / 1000,
        copies: ids.reduce((sum, id) => sum + copies.get(id)!, 0), distinct: ids.length, status,
        hybrids: ids.filter(id => memberships.get(id)!.length > 1),
        ...(row.includes.length ? { includes: row.includes.sort() } : {}) };
    });
}

export interface BridgeEnginesRequest {
  format: BridgeFormat; deck?: BridgeDeck; engines?: string[]; genesysRemaining?: number;
}

export function isBridgeDeck(value: unknown): value is BridgeDeck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const deck = value as Record<string, unknown>;
  const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
  return Object.keys(deck).every(key => ["main", "extra", "deckMaster"].includes(key))
    && Array.isArray(deck.main) && Array.isArray(deck.extra) && deck.main.every(id) && deck.extra.every(id)
    && (deck.deckMaster === undefined || id(deck.deckMaster))
    && deck.main.length + deck.extra.length + (deck.deckMaster === undefined ? 0 : 1) <= 91;
}
export function isBridgeEngineNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= MAX_BRIDGE_ENGINES
    && value.every(name => typeof name === "string" && name.trim().length > 0 && name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(name));
}
