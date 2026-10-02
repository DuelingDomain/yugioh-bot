import type { DuelEngineView } from "@yugidraft/shared/duels";

type EliminationView = Pick<DuelEngineView, "seats" | "log"> & { eliminationOrder?: unknown };

/** Earliest loss first. Older engines log one-based player numbers; newer views can preserve simultaneous groups. */
export function eliminationOrder(engine: EliminationView, previous: readonly (readonly number[])[] = []): number[][] {
  const out = engine.seats.filter((seat) => seat.eliminated === true).map((seat) => seat.seat);
  const known = new Set<number>();
  const clean = (groups: readonly unknown[]): number[][] => groups.flatMap((group) => {
    if (!Array.isArray(group)) return [];
    const seats = group.filter((seat: unknown): seat is number => {
      if (typeof seat !== "number" || !out.includes(seat) || known.has(seat)) return false;
      known.add(seat);
      return true;
    });
    return seats.length ? [seats] : [];
  });
  const recorded = Array.isArray(engine.eliminationOrder) ? engine.eliminationOrder
    : [...engine.log].sort((a, b) => a.id - b.id).flatMap(({ text }) => {
      const match = /^Player (\d+) is eliminated(?:\s*\([^\n]*\))?\.?$/i.exec(text.trim());
      return match ? [[Number(match[1]) - 1]] : [];
    });
  const groups = clean(recorded);
  const retained = clean(previous);
  // A cut log cannot recover exact ranks for older losses. Keep their observed groups, else give them a shared place.
  const unknown = out.filter((seat) => !known.has(seat));
  return [...(unknown.length ? [unknown] : []), ...retained, ...groups];
}
