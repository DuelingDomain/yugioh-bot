import type Database from "better-sqlite3";
import { bridgeGate, bridgeProjection, bridgePackage, isBridgeDeck, isBridgeEngineNames, rankEngineCandidates, rankNextEngines, projectEngineCore,
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

  private rankingContext() {
    try { return this.service.rankingContext(); }
    catch { throw new BridgeJobError("Bridge data is unavailable", 503); }
  }

  /** Normalize subscriber copies and points without detecting or selecting engines. */
  deckContext(rawDeck: BridgeDeck | undefined, format: BridgeFormat, remaining?: number) {
    const artwork = this.db.prepare("SELECT card_id FROM card_artworks WHERE artwork_id=?");
    const mainId = (id: number) => (artwork.get(id) as { card_id: number } | undefined)?.card_id ?? id;
    const deck: BridgeDeck | undefined = rawDeck ? { ...rawDeck, main: rawDeck.main.map(mainId), extra: rawDeck.extra.map(mainId),
      ...(rawDeck.side ? { side: rawDeck.side.map(mainId) } : {}),
      ...(rawDeck.deckMaster === undefined ? {} : { deckMaster: mainId(rawDeck.deckMaster) }) } : undefined;
    const deckCards = deck ? [...deck.main, ...deck.extra] : undefined;
    if (remaining === undefined && deckCards && format === "genesys") {
      const spent = [...deckCards, ...(deck?.side ?? []), ...(deck?.deckMaster === undefined ? [] : [deck.deckMaster])]
        .reduce((sum, id) => sum + this.points(id), 0);
      // Missing catalog/points data must not block an explicit bridge search.
      // Keep copy context and use the normal no-allowance projection fallback.
      if (Number.isFinite(spent)) remaining = (deck?.pointCap ?? 100) - spent;
    }
    return { deck, ...(remaining === undefined ? {} : { genesysRemaining: remaining }), ...(deckCards ? { deckCards } : {}) };
  }

  resolve(input: Record<string, unknown>, guildId: string): { query: EngineQuery; detected?: DetectedEngine[] } {
    validateBridgeEngineInput(input);
    if (!this.db.prepare("SELECT 1 FROM bridge_graph WHERE id=1").get()) throw new BridgeJobError("Bridge data is unavailable", 503);
    const format: BridgeFormat = input.format === "genesys" ? "genesys" : "advanced";
    const { deck, ...context } = this.deckContext(input.deck as BridgeDeck | undefined, format, input.genesysRemaining as number | undefined);
    const detected = deck ? this.service.detectEngines(deck, format, guildId) : undefined;
    const names = input.engines as string[] | undefined ?? detected?.filter(row => row.status === "engine").map(row => row.name) ?? [];
    const groups = this.rankingContext().groups;
    const canonical = names.map(name => Object.keys(groups).find(key => key.toLowerCase() === name.trim().toLowerCase()));
    if (canonical.some(name => !name)) throw new BridgeJobError("Unknown archetype", 400);
    const engines = [...new Set(canonical as string[])].sort();
    return { query: { source: engines[0] ?? "", engines, format, ...context, ...(deck ? { deck } : {}) },
      ...(detected ? { detected } : {}) };
  }

  private points(id: number): number {
    const row = this.db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string } | undefined;
    return row ? JSON.parse(row.capabilities_json).card.genesysPoints ?? Infinity : Infinity;
  }

  package(rows: readonly ArchetypeBridge[], query: BridgeSearchQuery) {
    const pack = bridgePackage(rows, query.deckCards);
    const points = pack.missing.reduce((sum, id) => sum + this.points(id), 0);
    return { ...pack, genesysPoints: query.format === "genesys" && Number.isFinite(points) ? points : null, points };
  }

  core(engine: string, query: BridgeSearchQuery) {
    const plan = this.service.corePlan(engine, query.format);
    const unknownAllowance = query.format === "genesys" && query.deck && query.genesysRemaining === undefined;
    return projectEngineCore(unknownAllowance ? { ...plan, gaps: [...plan.gaps, "Genesys allowance is unknown because existing deck points are unavailable."] } : plan, query);
  }

  shortlist(rows: ArchetypeBridge[], query: EngineQuery) {
    const eligible = rows.filter(row => ["pending", "shown"].includes(bridgeGate(this.db, row).state));
    return rankEngineCandidates(query.engines, eligible, this.rankingContext(), 8, { acceptedNiche: row => bridgeGate(this.db, row).state === "shown" });
  }

  project(rows: ArchetypeBridge[], query: EngineQuery, limit = 4): BridgeEnginesResponse {
    const selected = new Set(query.engines);
    const candidates = rows.filter(row => row.format === query.format && (selected.has(row.source) || selected.has(row.target))
      && (query.format !== "genesys" || this.package([row], query).points <= (query.genesysRemaining ?? 100)));
    const projections = candidates.map(row => bridgeProjection(this.db, row));
    const shown = projections.flatMap(({ shown }) => shown ? [{ ...shown, ...bridgePackage([shown], query.deckCards), core: this.core(shown.target, query) }] : []);
    const accepted = shown.map(row => ({ ...row, two_way: shown.some(reverse => reverse.source === row.target && reverse.target === row.source) }));
    const between = accepted.filter(row => selected.has(row.source) && selected.has(row.target));
    const next: EngineSuggestion[] = rankNextEngines(query.engines, accepted, this.rankingContext(), 8, {
      deckCards: query.deckCards,
      eligible: row => query.format !== "genesys" || this.package(row.links.map(link => link.bridge), query).points <= (query.genesysRemaining ?? 100),
    }).map(row => {
      const pack = this.package(row.links.map(link => link.bridge), query);
      const pros = [...new Set(row.links.flatMap(link => link.bridge.review.pros))].slice(0, 3);
      const cons = [...new Set(row.links.flatMap(link => link.bridge.review.cons))].slice(0, 3);
      return { ...row, cards: pack.cards, missing: pack.missing, alreadyInDeck: pack.alreadyInDeck, genesysPoints: pack.genesysPoints, pros, cons, core: this.core(row.engine, query) };
    }).slice(0, limit);
    return { engines: query.engines, between, next,
      inReview: projections.filter(({ gate }) => ["pending", "review"].includes(gate.state)).length };
  }
}
