import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BridgeFormat } from "./bridge-types.js";
import { log } from "../../observability/index.js";
import { mechanicFactsVersion } from "./bridge-mechanic-facts.js";

const count = z.number().int().positive();
const CardUsage = z.object({ code: count, decks: count, copies: count }).strict();
const Pair = z.object({ a: z.string(), b: z.string(), decks: count, aDecks: count, bDecks: count,
  share: z.number().positive().max(1), aShare: z.number().positive().max(1), bShare: z.number().positive().max(1), lift: z.number().positive() }).strict();
const Sample = z.object({ deckCount: count, pairs: z.array(Pair).max(100000),
  engines: z.record(z.string(), z.object({ decks: count, cards: z.array(CardUsage).max(300) }).strict()) }).strict();
export const BridgeObservationsSchema = z.object({ schemaVersion: z.literal(1), generatedAt: z.iso.datetime(),
  usageVersion: z.string().regex(/^[a-f0-9]{64}$/), graphVersion: z.string(),
  formats: z.object({ tcg: Sample.optional(), domain: Sample.optional(), genesys: Sample.optional(), "genesys-domain": Sample.optional() }).strict(),
  version: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type BridgeObservations = z.infer<typeof BridgeObservationsSchema>;
export type CoPlayPair = z.infer<typeof Pair>;
export type ObservationFormat = keyof BridgeObservations["formats"];
export const observationFormat = (format: BridgeFormat, domain = false): ObservationFormat =>
  format === "genesys" ? domain ? "genesys-domain" : "genesys" : domain ? "domain" : "tcg";

export function validateBridgeObservations(value: unknown): BridgeObservations {
  BridgeObservationsSchema.parse(value);
  // Verify the serialized identity, before a schema parser reorders object keys.
  const artifact = value as BridgeObservations, { version, ...identity } = artifact;
  if (createHash("sha256").update(JSON.stringify(identity)).digest("hex") !== version) throw Error("Invalid observation hash");
  for (const sample of Object.values(artifact.formats)) {
    const pairs = new Set<string>();
    for (const [name, engine] of Object.entries(sample.engines)) {
      if (!name || engine.decks > sample.deckCount || new Set(engine.cards.map(card => card.code)).size !== engine.cards.length
        || engine.cards.some(card => card.decks > engine.decks || card.copies < card.decks || card.copies > card.decks * 3)) throw Error("Invalid observed core counts");
    }
    for (const pair of sample.pairs) {
      const key = JSON.stringify([pair.a, pair.b]);
      if (pair.a.localeCompare(pair.b) >= 0 || pairs.has(key) || pair.aDecks !== sample.engines[pair.a]?.decks || pair.bDecks !== sample.engines[pair.b]?.decks
        || pair.decks > Math.min(pair.aDecks, pair.bDecks) || pair.share !== pair.decks / sample.deckCount
        || pair.aShare !== pair.decks / pair.aDecks || pair.bShare !== pair.decks / pair.bDecks
        || pair.lift !== pair.decks * sample.deckCount / (pair.aDecks * pair.bDecks)) throw Error("Invalid co-play counts");
      pairs.add(key);
    }
  }
  return artifact;
}

let cached: BridgeObservations | null | undefined;
export function bridgeObservations(): BridgeObservations | null {
  if (cached !== undefined) return cached;
  try {
    const bytes = readFileSync(new URL("../../../data/staples/bridge-observations.json", import.meta.url));
    if (bytes.length > 8_000_000) throw Error("Observation artifact too large");
    cached = validateBridgeObservations(JSON.parse(bytes.toString()));
  } catch (error) {
    cached = null;
    log("warn", "[bridges] observations unavailable; co-play and sampled cores disabled", { error: String(error) });
  }
  return cached;
}

/** Changing discovery data expires durable shortlists, while evidence reviews survive. */
export const bridgeApproachVersion = (): string =>
  `mechanic-synergy-v2:${mechanicFactsVersion()}:${bridgeObservations()?.version ?? "no-observations"}`;

const indices = new WeakMap<BridgeObservations, Map<ObservationFormat, Map<string, CoPlayPair>>>();
export function coPlayPair(a: string, b: string, format: ObservationFormat, artifact = bridgeObservations()): CoPlayPair | undefined {
  if (!artifact) return;
  let formats = indices.get(artifact);
  if (!formats) { formats = new Map(); indices.set(artifact, formats); }
  let pairs = formats.get(format);
  if (!pairs) { pairs = new Map(artifact.formats[format]?.pairs.map(pair => [JSON.stringify([pair.a, pair.b]), pair])); formats.set(format, pairs); }
  return pairs.get(JSON.stringify([a, b].sort((a, b) => a.localeCompare(b))));
}

/** A small prior, never evidence or permission to publish a pair. */
export function coPlayBoost(pair: CoPlayPair | undefined): number {
  return !pair || pair.decks < 2 ? 0 : Math.min(0.3, 0.05 * Math.log2(1 + pair.decks) + 0.1 * Math.min(pair.aShare, pair.bShare));
}
