import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { phaseLabel } from "./constants";

/**
 * The six stations of a turn and what the local seat may do at each. One pure model, read by the station track (the bar,
 * and the phone strip) and by the phase hub (the middle of the board), so the two never disagree about which phase is
 * lit or which one a click may move to.
 */

/** The phase moves the engine offers as options of the action prompt. Nothing else changes the phase from the client. */
export type PhaseMove = "to_bp" | "to_m2" | "to_ep";

export type Station = {
  code: string;
  name: string;
  /** What the local player can do while this station is current on their turn. */
  hint: string;
  /** Phase move (option id) that enters this station. Draw, Standby and Main 1 have none: the engine moves into them. */
  action?: PhaseMove;
};

export const STATIONS: readonly Station[] = [
  { code: "DP", name: "Draw", hint: "Draw a card for the turn" },
  { code: "SP", name: "Standby", hint: "Standby Phase effects resolve" },
  { code: "M1", name: "Main 1", hint: "Summon or Set a monster, activate or Set Spells and Traps" },
  { code: "BP", name: "Battle", hint: "Choose an attacker, or move on", action: "to_bp" },
  { code: "M2", name: "Main 2", hint: "Summon, Set or activate more, then end your turn", action: "to_m2" },
  { code: "EP", name: "End", hint: "End Phase effects resolve, then the turn passes", action: "to_ep" },
];

/** Index of the Battle station. Damage and Damage calculation belong to it. */
export const BATTLE = 3;

/** Normalised phaseLabel() -> station index. */
export const STATION_INDEX: Record<string, number> = {
  Draw: 0,
  Standby: 1,
  "Main 1": 2,
  Battle: BATTLE,
  Damage: BATTLE,
  "Damage calculation": BATTLE,
  "Main 2": 4,
  End: 5,
};

/** Station index of a raw engine phase, or -1 when it names none (no live turn). */
export function stationIndex(phase: string | null | undefined): number {
  return STATION_INDEX[phaseLabel(phase)] ?? -1;
}

export type StationState = "done" | "current" | "ahead";

export type StationView = {
  station: Station;
  index: number;
  state: StationState;
  /** The engine option a click on this station sends, when the local seat may move there right now. */
  option?: DuelPromptOption;
};

export type PhaseStations = {
  /** Index of the current station, -1 when none. */
  current: number;
  stations: StationView[];
  /** Every phase move the local seat may take right now, by option id. Empty unless `canAct`. */
  offered: Map<string, DuelPromptOption>;
};

/**
 * The stations for a phase. A station is clickable only when the local seat may answer (`canAct`) and the action
 * prompt offers that exact phase move: so never on another seat's turn, never while a chain, a trigger or any other
 * prompt is open (the options are then not an action prompt's), and never for a phase the engine does not offer.
 */
export function phaseStations(input: {
  phase: string | null | undefined;
  actionOptions: readonly DuelPromptOption[];
  canAct: boolean;
}): PhaseStations {
  const current = stationIndex(input.phase);
  const offered = new Map<string, DuelPromptOption>();
  if (input.canAct) for (const option of input.actionOptions) offered.set(option.id, option);
  const stations = STATIONS.map<StationView>((station, index) => ({
    station,
    index,
    state: index < current ? "done" : index === current ? "current" : "ahead",
    option: station.action ? offered.get(station.action) : undefined,
  }));
  return { current, stations, offered };
}

/** How the band hub fits the free cells of a narrow Extra Monster row (the 4-way grid; the 1v1 cells are wide enough). */
export type BandHubFit = { mode: "row" | "stack"; chip: number };

/** Chip height of the band in phase-hub.module.css: clamp(26px, z * 0.28, 38px). */
const bandChip = (z: number) => Math.min(38, Math.max(26, z * 0.28));
/** A pair side by side is 3.02 chips wide (two chips of 1.3 and a gap of 0.42); stacked it is 2.2 chips high. */
const ROW_PAIR = 3.02;
const STACK_PAIR = 2.2;
/** The smallest chip a pair side by side may have; below it the pair stacks. */
const ROW_MIN = 24;
/** Room the owner line above the pair and the lit name under it take in the band (px). */
const ROW_TEXT = 42;
/** Air between a pair and the zone beside it, and above and below a stacked pair (px). */
const AIR = 4;

/**
 * The chip size (px) and the form of the band hub for a cell of `cellWidth` px in a row `z` px high, so that a pair
 * stays in its free cell and never lies over an Extra Monster Zone. "row" is the 1v1 form (a pair side by side, the
 * owner above the left pair, the lit name under its pair); "stack" puts the two chips of a pair one over the other and
 * drops the owner and the name (the top bar says them), for a cell too narrow for a pair side by side.
 */
export function bandHubFit(z: number, cellWidth: number): BandHubFit {
  const row = Math.floor(Math.min(bandChip(z), (cellWidth - AIR) / ROW_PAIR, z - ROW_TEXT));
  if (row >= ROW_MIN) return { mode: "row", chip: row };
  const stack = Math.floor(Math.min(Math.min(30, Math.max(22, z * 0.3)), (z - AIR) / STACK_PAIR, (cellWidth - AIR) / 1.3));
  return { mode: "stack", chip: Math.max(1, stack) };
}
