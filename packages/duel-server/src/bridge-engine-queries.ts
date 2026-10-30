import type Database from "better-sqlite3";
import { bridgeGate, bridgeProjection, isBridgeDeck, isBridgeEngineNames, rankEngineCandidates, rankNextEngines,
  type ArchetypeBridge, type BridgeDeck, type BridgeEnginesResponse, type BridgeFormat, type DetectedEngine, type EngineSuggestion } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeJobError, type BridgeSearchQuery } from "./bridge-search-jobs.js";

export interface EngineQuery extends BridgeSearchQuery { engines: string[] }

/** Cheap boundary validation before worker admission; resolution runs in the scanner. */
export function validateBridgeEngineInput(input: Record<string, unknown>): void {
  if (Object.keys(input).some(key => !["op", "format", "deck", "engines", "genesysRemaining"].includes(key))
    || input.deck === undefined && input.engines === undefined
    || input.deck !== undefined && !isBridgeDeck(input.deck)
    || input.engines !== undefined && !isBridgeEngineNames(input.engines)
    || input.format !== undefined && input.format !== "advanced" && input.format !== "genesys"
    || input.genesysRemaining !== undefined && (!Number.isSafeInteger(input.genesysRemaining) || Number(input.genesysRemaining) < 0 || Number(input.genesysRemaining) > 1000)) {
    throw new BridgeJobError("Invalid bridge engine query", 400);
  }
}

/** Deck context and review projection for isolated scanners and durable host jobs. */
export class BridgeEngineQueries {
  readonly service;
  constructor(private readonly db: Database.Database) { this.service = createBridgeService(db); }

  resolve(input: Record<string, unknown>, guildId: string): { query: EngineQuery; detected?: DetectedEngine[] } {
    validateBridgeEngineInput(input);
    if (!this.db.prepare("SELECT 1 FROM bridge_graph WHERE id=1").get()) throw new BridgeJobError("Bridge data is unavailable", 503);
    const format: BridgeFormat = input.format === "genesys" ? "genesys" : "advanced";
    const rawDeck = input.deck as BridgeDeck | undefined;
    const artwork = this.db.prepare("SELECT card_id FROM card_artworks WHERE artwork_id=?");
    const mainId = (id: number) => (artwork.get(id) as { card_id: number } | undefined)?.card_id ?? id;
    const deck: BridgeDeck | undefined = rawDeck ? { ...rawDeck, main: rawDeck.main.map(mainId), extra: rawDeck.extra.map(mainId),
      ...(rawDeck.deckMaster === undefined ? {} : { deckMaster: mainId(rawDeck.deckMaster) }) } : undefined;
    const detected = deck ? this.service.detectEngines(deck, format, guildId) : undefined;
    const names = input.engines as string[] | undefined ?? detected?.filter(row => row.status === "engine").map(row => row.name) ?? [];
    const groups = this.service.rankingContext().groups;
    const canonical = names.map(name => Object.keys(groups).find(key => key.toLowerCase() === name.trim().toLowerCase()));
    if (canonical.some(name => !name)) throw new BridgeJobError("Unknown archetype", 400);
    const engines = [...new Set(canonical as string[])].sort();
    const deckCards = deck ? [...deck.main, ...deck.extra, ...(deck.deckMaster === undefined ? [] : [deck.deckMaster])] : undefined;
    let remaining = input.genesysRemaining as number | undefined;
    if (deckCards) {
      remaining = undefined;
      if (format === "genesys") {
        const spent = deckCards.reduce((sum, id) => sum + this.points(id), 0);
        if (!Number.isFinite(spent)) throw new BridgeJobError("Genesys points are unavailable for this deck", 400);
        remaining = (deck?.pointCap ?? 100) - spent;
      }
    }
    return { query: { source: engines[0] ?? "", engines, format,
      ...(remaining === undefined ? {} : { genesysRemaining: remaining }), ...(deckCards ? { deckCards } : {}) },
      ...(detected ? { detected } : {}) };
  }

  private points(id: number): number {
    const row = this.db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string } | undefined;
    return row ? JSON.parse(row.capabilities_json).card.genesysPoints ?? Infinity : Infinity;
  }

  package(rows: readonly ArchetypeBridge[], query: BridgeSearchQuery) {
    const counts = new Map<number, number>();
    for (const row of rows) for (const id of row.cards) counts.set(id, Math.max(counts.get(id) ?? 0, 1,
      ...row.reasons.map(reason => reason.materials?.filter(code => code === id).length ?? 0)));
    const cards = [...counts.keys()].sort((a, b) => a - b), missing: number[] = [];
    let points = 0;
    for (const id of cards) {
      const count = Math.max(0, counts.get(id)! - (query.deckCards?.filter(code => code === id).length ?? 0));
      for (let i = 0; i < count; i++) missing.push(id);
      if (count) points += this.points(id) * count;
    }
    return { cards, missing, genesysPoints: query.format === "genesys" && Number.isFinite(points) ? points : null, points };
  }

  shortlist(rows: ArchetypeBridge[], query: EngineQuery) {
    const eligible = rows.filter(row => ["pending", "shown"].includes(bridgeGate(this.db, row).state));
    return rankEngineCandidates(query.engines, eligible, this.service.rankingContext(), 8);
  }

  project(rows: ArchetypeBridge[], query: EngineQuery, limit = 4): BridgeEnginesResponse {
    const selected = new Set(query.engines);
    const candidates = rows.filter(row => row.format === query.format && (selected.has(row.source) || selected.has(row.target))
      && (query.format !== "genesys" || this.package([row], query).points <= (query.genesysRemaining ?? 100)));
    const projections = candidates.map(row => bridgeProjection(this.db, row));
    const shown = projections.flatMap(({ shown }) => shown ? [shown] : []);
    const accepted = shown.map(row => ({ ...row, two_way: shown.some(reverse => reverse.source === row.target && reverse.target === row.source) }));
    const between = accepted.filter(row => selected.has(row.source) && selected.has(row.target));
    const next: EngineSuggestion[] = rankNextEngines(query.engines, accepted, this.service.rankingContext(), 8).flatMap(row => {
      const pack = this.package(row.links.map(link => link.bridge), query);
      if (query.format === "genesys" && pack.points > (query.genesysRemaining ?? 100)) return [];
      const pros = [...new Set(row.links.flatMap(link => link.bridge.review.pros))].slice(0, 3);
      const cons = [...new Set(row.links.flatMap(link => link.bridge.review.cons))].slice(0, 3);
      return [{ ...row, cards: pack.cards, missing: pack.missing, genesysPoints: pack.genesysPoints, pros, cons }];
    }).slice(0, limit);
    return { engines: query.engines, between, next,
      inReview: projections.filter(({ gate }) => ["pending", "review"].includes(gate.state)).length };
  }
}
