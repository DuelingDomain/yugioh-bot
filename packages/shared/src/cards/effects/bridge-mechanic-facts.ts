import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { log } from "../../observability/index.js";
import type { CardTags } from "./tags.js";

const summonTypes = ["fusion", "synchro", "xyz", "link", "ritual"] as const;
export interface MechanicTagFacts {
  gy: boolean; banished: boolean; discard: boolean; faceDown: boolean;
  trapTrigger: boolean; gyAction: boolean; summons: string[];
}
export interface MechanicFactsArtifact {
  schemaVersion: 1; tagsSha256: string; cards: Record<string, number>; version: string;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Used by the offline builder; runtime checks read only the compact bit masks. */
export function encodeMechanicFacts(tags: CardTags): number {
  const effects = tags.effects, events = effects.flatMap(effect => [...effect.actions, ...effect.costs, ...effect.triggers]);
  const flags = [
    events.some(event => event.from.includes("gy")),
    events.some(event => event.from.includes("banished")),
    events.some(event => event.verb === "discard"),
    effects.some(effect => effect.conditions.some(condition => /face-down|Set card/i.test(condition))),
    effects.some(effect => effect.triggers.some(event => event.verb === "activate" && event.player !== "opponent"
      && (event.what.kinds.includes("trap") || /Normal Trap/i.test(event.note)))),
    effects.some(effect => effect.location.includes("gy") && ["ignition", "quick"].includes(effect.timing)),
    ...summonTypes.map(type => events.some(event => event.what.subtypes.includes(type))),
  ];
  return flags.reduce((mask, flag, bit) => mask | (Number(flag) << bit), 0);
}

export function buildMechanicFacts(rows: readonly { id: number; tags: CardTags }[], tagsSha256: string): MechanicFactsArtifact {
  const cards = Object.fromEntries([...rows].sort((a,b) => a.id-b.id).map(row => [row.id, encodeMechanicFacts(row.tags)]));
  const identity = { schemaVersion: 1 as const, tagsSha256, cards };
  return { ...identity, version: hash(identity) };
}

let cached: MechanicFactsArtifact | null | undefined;
function mechanicFactsArtifact(): MechanicFactsArtifact | null {
  if (cached !== undefined) return cached;
  try {
    const bytes = readFileSync(new URL("../../../data/effects/bridge-mechanic-facts.json", import.meta.url));
    if (bytes.length > 350_000) throw Error("Mechanic facts artifact too large");
    const artifact = JSON.parse(bytes.toString()) as MechanicFactsArtifact, { version, ...identity } = artifact;
    if (artifact.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(artifact.tagsSha256) || hash(identity) !== version
      || !artifact.cards || Array.isArray(artifact.cards) || Object.entries(artifact.cards).some(([id, mask]) =>
        !/^\d+$/.test(id) || +id < 1 || +id > 0xffffffff || !Number.isInteger(mask) || mask < 0 || mask >= 2048)) {
      throw Error("Invalid mechanic facts artifact");
    }
    cached = artifact;
  } catch (error) {
    cached = null;
    log("warn", "[bridges] mechanic facts unavailable; tagged mechanic nominations disabled", { error: String(error) });
  }
  return cached;
}

export const mechanicFactsVersion = (): string => mechanicFactsArtifact()?.version ?? "no-mechanic-facts";
const decoded = new Map<number, MechanicTagFacts>();
export function cardMechanicFacts(id: number): MechanicTagFacts | undefined {
  const existing = decoded.get(id);
  if (existing) return existing;
  const mask = mechanicFactsArtifact()?.cards[id];
  if (mask === undefined) return;
  const facts = { gy: !!(mask & 1), banished: !!(mask & 2), discard: !!(mask & 4), faceDown: !!(mask & 8),
    trapTrigger: !!(mask & 16), gyAction: !!(mask & 32), summons: summonTypes.filter((_, bit) => mask & (1 << (bit + 6))) };
  decoded.set(id, facts);
  return facts;
}
