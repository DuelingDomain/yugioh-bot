import { seatsOfTeam, teamOfSeat, type DuelEngineView, type DuelRoom } from "@yugidraft/shared/duels";
import type { TableShellProps } from "../table/table-shell";
import { responseWindow, type ResponseWindow } from "./tag-logic";

/**
 * The shared contract of the live Tag 2v2 table (the "Rooftop"). Every piece that builds the live Tag shell imports from
 * here and does not change these names. Add new exports only; do not rename or remove one.
 *
 * Where it mounts: `room.tsx` mounts `TableShell` for FFA. For a Tag room it mounts the Rooftop shell with the same live
 * seams (`TagShellLiveProps`), so the room code stays one code path.
 */

/** "normal" (Standard) or "domain": the duel mode of the session. */
export type TagMode = DuelRoom["session"]["mode"];

/** Team names the shell shows on the plates and in the result banner. Index = team number. */
export type TagTeamNames = [string, string];

/**
 * What the live Tag shell takes. The live seams (controller, actions, connection, headerTools, modals, notices,
 * settingsTools, fxActive, busy, pickContinuation, inputSuspended, boardRef, initialOutOrder, fillViewport, camera
 * start) come from `TableShellProps`, so the two shells never drift. The room adds the team names and the mode.
 */
export type TagShellLiveProps = TableShellProps & {
  teamNames: TagTeamNames;
  mode: TagMode;
};

/** The preview page may leave the two extra props out: `resolveTagExtras` gives the fixture defaults. */
export type TagShellPreviewProps = Omit<TagShellLiveProps, "teamNames" | "mode"> & Partial<Pick<TagShellLiveProps, "teamNames" | "mode">>;

/** Fixture defaults for a preview: "Team 1" and "Team 2" in Standard mode. */
export function resolveTagExtras(props: Partial<Pick<TagShellLiveProps, "teamNames" | "mode">>): Pick<TagShellLiveProps, "teamNames" | "mode"> {
  return { teamNames: props.teamNames ?? defaultTeamNames(), mode: props.mode ?? "normal" };
}

/** The team names when the session gives none. A new array each call, so a caller may keep it. */
export function defaultTeamNames(): TagTeamNames {
  return ["Team 1", "Team 2"];
}

/**
 * DOM hooks that every piece of the live Tag table must keep. The e2e specs, the preview and the room's gates read them.
 * - `data-table-shell="tag"` on the root of the shell (FFA tables use `data-table-shell` with no value).
 * - `data-can-act="true" | "false"` on the same root: the player may answer now.
 * - The board region has `aria-label="Duel field"`.
 * - `data-tag-stage` on the roof stage root.
 * - `data-relation="self" | "partner" | "rival"` on each seat field, from the viewer's side. A spectator has no `self`.
 * - `data-lp-seat={seat}` on each LP chip of the team plate.
 * - The hand is a group with `aria-label="Your hand"`.
 * - The header shows the visible text `Turn N` (see `tagTurnText`).
 */
export const TAG_DOM = {
  shellAttr: "data-table-shell",
  shellValue: "tag",
  canActAttr: "data-can-act",
  fieldLabel: "Duel field",
  stageAttr: "data-tag-stage",
  relationAttr: "data-relation",
  relations: ["self", "partner", "rival"],
  lpSeatAttr: "data-lp-seat",
  handLabel: "Your hand",
} as const;

export type TagRelation = (typeof TAG_DOM.relations)[number];

/** The visible header text for the turn count: "Turn 5". */
export function tagTurnText(turn: number): string {
  return `Turn ${turn}`;
}

/**
 * Which side a pile belongs to for the pile viewer: "you" for your own and your partner's piles, "rival" for the
 * opposing team. A spectator (`viewerSeat` null) sees the table from team 0's side: team 0 is "you", team 1 is "rival".
 */
export function pileSideForSeat(viewerSeat: number | null, ownerSeat: number, teamOf: (seat: number) => number): "you" | "rival" {
  const viewerTeam = viewerSeat == null ? 0 : teamOf(viewerSeat);
  return teamOf(ownerSeat) === viewerTeam ? "you" : "rival";
}

/**
 * What can hold the table keys. Any truthy value counts as open, except an object with `open: false` (a closed pile).
 * `dialog` is a room dialog (surrender, settings); `inputSuspended` is the room's own suspend flag.
 */
export interface TagKeyState {
  seatPick?: unknown;
  aim?: unknown;
  menu?: unknown;
  pile?: unknown;
  dialog?: boolean;
  inputSuspended?: boolean;
}

/** True while camera and aim keys must wait: a seat pick, an aim, a card menu, the pile viewer, a dialog, or suspended input. */
export function tagKeysPaused(state: TagKeyState): boolean {
  const open = (value: unknown) => value != null && value !== false && !(typeof value === "object" && "open" in value && (value as { open?: unknown }).open === false);
  return open(state.seatPick) || open(state.aim) || open(state.menu) || open(state.pile) || state.dialog === true || state.inputSuspended === true;
}

export interface TagResponseOrder {
  /** The team that holds the chance to respond now. */
  team: number;
  /** Its seats in turn order. */
  seats: number[];
  /** The seat that decides now: the first member that did not pass. */
  promptSeat: number;
  window: ResponseWindow;
}

/**
 * Who answers the newest chain link (R-TAG-RESPONSE, docs/adr/0002-multiplayer-duel-rules.md): the opposing team first.
 * When both of its members passed, the chance goes to the team of the link owner. `passed` lists seats that passed.
 * Null while the chain is empty. It reuses `responseWindow` for the member states.
 */
export function tagResponseOrder(engine: DuelEngineView, passed: readonly number[] = []): TagResponseOrder | null {
  const last = engine.chain[engine.chain.length - 1];
  if (!last) return null;
  const ownerTeam = teamOfSeat("tag", last.seat);
  const rivals = seatsOfTeam("tag", 1 - ownerTeam);
  const team = rivals.every((seat) => passed.includes(seat)) ? ownerTeam : 1 - ownerTeam;
  const seats = seatsOfTeam("tag", team);
  const promptSeat = seats.find((seat) => !passed.includes(seat)) ?? seats[0];
  const window = responseWindow(engine, null, promptSeat, passed.filter((seat) => seats.includes(seat)))!;
  return { team, seats, promptSeat, window };
}
