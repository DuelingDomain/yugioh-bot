import type { DuelCard, DuelEngineView, DuelZoneRef } from "@yugidraft/shared/duels";

const zone = (value: DuelZoneRef | undefined) => value
  ? [value.controller, value.location, value.sequence] : null;

function card(value: DuelCard | null, legacyCounters = false): unknown {
  if (value === null) return null;
  let counters = [...(value.counters ?? [])].sort((a, b) => a.type - b.type || a.count - b.count);
  if (legacyCounters) {
    // The old wrapper read the count before the type, using count as an object key.
    // Reproduce its overwrite in core type order, including collisions between equal counts.
    const lossy: Record<number, number> = {};
    for (const { type, count } of counters) lossy[count] = type;
    counters = Object.entries(lossy).map(([type, count]) => ({ type: Number(type), count }));
  }
  return {
    zone: zone(value), code: value.code ?? null, position: value.position,
    attack: value.attack == null ? null : value.attack | 0,
    defense: value.defense == null ? null : value.defense | 0,
    level: value.level ?? null, rank: value.rank ?? null,
    type: value.type ?? null, attribute: value.attribute ?? null, race: value.race ?? null,
    linkRating: value.linkRating ?? null, linkMarker: value.linkMarker ?? null,
    counters: counters.sort((a, b) => a.type - b.type || a.count - b.count).map(counter => [counter.type, counter.count]),
    materials: (value.materials ?? []).map(value => card(value, legacyCounters)), equippedTo: zone(value.equippedTo),
  };
}

/** Only game fields enter the projection. Card order and empty field slots are significant.
 * Position contains both battle position and face visibility. A hidden code stays null.
 * Printed text, animation IDs, prompts, clocks, logs and events are not game state.
 */
export function replayBoardProjection(view: DuelEngineView, legacyCounters = false): unknown {
  const projectCard = (value: DuelCard | null) => card(value, legacyCounters);
  if (!Number.isSafeInteger(view.turn) || !Number.isSafeInteger(view.turnSeat)
    || typeof view.phase !== "string" || !Array.isArray(view.seats) || !Array.isArray(view.chain)
    || (view.result !== null && (!view.result || typeof view.result.reason !== "string"))) {
    throw new Error("Invalid replay board");
  }
  return {
    format: view.format ?? "1v1", turn: view.turn, turnSeat: view.turnSeat,
    phase: view.phase, battleStep: view.battleStep ?? null, eliminationOrder: view.eliminationOrder ?? [],
    seats: view.seats.map(seat => ({
      seat: seat.seat, lp: seat.lp, team: seat.team ?? null, sharedExtraWith: seat.sharedExtraWith ?? null,
      eliminated: seat.eliminated ?? false, pendingElimination: seat.pendingElimination ?? false,
      disabledZones: seat.disabledZones ?? 0,
      hand: seat.hand.map(projectCard), deckCount: seat.deckCount, extraCount: seat.extraCount, extra: seat.extra.map(projectCard),
      monsters: seat.monsters.map(projectCard), spells: seat.spells.map(projectCard),
      graveyard: seat.graveyard.map(projectCard), banished: seat.banished.map(projectCard),
      deckMaster: seat.deckMaster ? { code: seat.deckMaster.card.code, inZone: seat.deckMaster.inZone,
        returns: seat.deckMaster.returns, nextCost: seat.deckMaster.nextCost } : null,
    })),
    result: view.result ? { winnerSeat: view.result.winnerSeat, winnerTeam: view.result.winnerTeam ?? null,
      victory: view.result.victory ?? null,
      reason: view.result.reason === "Surrendered" ? "Surrender" : view.result.reason } : null,
    chain: view.chain.map(link => ({ index: link.index, seat: link.seat, code: link.code ?? null,
      zone: zone(link.zone), targets: (link.targets ?? []).map(zone),
      chosenOptions: (link.chosenOptions ?? []).map(option => option.index ?? null) })),
  };
}

/** Server-only comparison, shared by public and own-seat final checks. Malformed boards fail closed. */
export function sameReplayBoard(saved: DuelEngineView, rebuilt: DuelEngineView,
  options: { allowLegacyCounters?: boolean } = {}): boolean {
  try {
    const expected = JSON.stringify(replayBoardProjection(saved));
    return expected === JSON.stringify(replayBoardProjection(rebuilt))
      || (options.allowLegacyCounters === true && expected === JSON.stringify(replayBoardProjection(rebuilt, true)));
  }
  catch { return false; }
}
