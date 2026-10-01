import {
  DEFAULT_DUEL_FORMAT,
  isDuelFormat,
  seatCountFor,
  seatsOfTeam,
  startingLpFor,
  teamOfSeat,
  type DuelFormat,
  type DuelSettings,
} from "@yugidraft/shared/duels";

export const FORMAT_LABELS: Record<DuelFormat, string> = {
  "1v1": "1v1",
  tag: "2v2 Tag",
  ffa3: "3-player FFA",
  ffa4: "4-player FFA",
};

/** One-line rule note shown under the format picker. */
export const FORMAT_RULES: Record<DuelFormat, string> = {
  "1v1": "Two duelists, one duel. Each starts with the Life Points you choose.",
  tag: "Teams share one Life Point total. Turn order is 1A, 2A, 1B, 2B. First attack is on turn 4.",
  ffa3: "Every duelist has their own Life Points. No attack until every duelist has had a turn.",
  ffa4: "Every duelist has their own Life Points. No attack until every duelist has had a turn.",
};

export function formatLabel(format: DuelFormat | undefined): string {
  return FORMAT_LABELS[format ?? DEFAULT_DUEL_FORMAT];
}

export function formatSeatCount(format: DuelFormat | undefined): number {
  return seatCountFor(format ?? DEFAULT_DUEL_FORMAT);
}

/** Starting LP of one side: the shared team total in Tag, per duelist otherwise. */
export function formatStartingLp(format: DuelFormat, settings: Pick<DuelSettings, "startingLP">): number {
  return startingLpFor(format, settings);
}

/** Team name of a seat in Tag ("Team 1" for seats 0 and 2), or null when seats are not teamed. */
export function seatTeamLabel(format: DuelFormat | undefined, seat: number): string | null {
  if (format !== "tag") return null;
  return `Team ${teamOfSeat(format, seat) + 1}`;
}

/** Tag turn-order code of a seat: 1A, 2A, 1B, 2B for seats 0 to 3. Null outside Tag. */
export function tagSeatCode(format: DuelFormat | undefined, seat: number): string | null {
  if (format !== "tag") return null;
  return `${teamOfSeat(format, seat) + 1}${seat < 2 ? "A" : "B"}`;
}

/** Seat indexes grouped for display: two teams in Tag, one flat group otherwise. */
export function seatGroups(format: DuelFormat | undefined): { title: string | null; seats: number[] }[] {
  const f = format ?? DEFAULT_DUEL_FORMAT;
  if (f === "tag") {
    return [0, 1].map((team) => ({ title: `Team ${team + 1}`, seats: seatsOfTeam(f, team) }));
  }
  return [{ title: null, seats: Array.from({ length: seatCountFor(f) }, (_, seat) => seat) }];
}

export { DEFAULT_DUEL_FORMAT, isDuelFormat };
