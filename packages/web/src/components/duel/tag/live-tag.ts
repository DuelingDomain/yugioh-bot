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
 * start) come from `TableShellProps`, so the two shells never drift. The room adds the team names.
 * `mode` is optional: when absent it comes from `controller.room.session.mode` (see `resolveTagExtras`).
 */
export type TagShellLiveProps = TableShellProps & {
  teamNames: TagTeamNames;
  mode?: TagMode;
};

/** The preview page may leave the team names out too: `resolveTagExtras` gives the fixture defaults. */
export type TagShellPreviewProps = Omit<TagShellLiveProps, "teamNames"> & Partial<Pick<TagShellLiveProps, "teamNames">>;

/**
 * The team names and the mode the shell uses. Names default to "Team 1" and "Team 2". The mode is the given one, else the
 * controller's session mode, else "normal".
 */
export function resolveTagExtras(
  props: { teamNames?: TagTeamNames; mode?: TagMode },
  controller?: { room: { session: { mode: TagMode } } },
): { teamNames: TagTeamNames; mode: TagMode } {
  return { teamNames: props.teamNames ?? defaultTeamNames(), mode: props.mode ?? controller?.room.session.mode ?? "normal" };
}

/** The team names when the session gives none. A new array each call, so a caller may keep it. */
export function defaultTeamNames(): TagTeamNames {
  return ["Team 1", "Team 2"];
}

/**
 * DOM hooks that every piece of the live Tag table must keep. The e2e helpers (packages/e2e/helpers: table.ts, board.ts,
 * multi.ts, table-rules.ts), the preview and the room's gates read them.
 * - Root of the shell: `data-table-shell="tag"` (this replaces the old `data-tag-shell`; the assembly worker renames it)
 *   and `data-can-act="true" | "false"`: the player may answer now.
 * - The board region has `aria-label="Duel field"`.
 * - Stage root: `data-table-stage="tag"`. Keep `data-tag-stage` on it as an extra.
 * - Each seat field (the SeatField node): `data-seat-field={seat}` and `data-side`. `data-side="you"` is for the
 *   viewer's own field ONLY, because the generic own-zone locators (board.ts) pick `[data-seat-field][data-side="you"]`.
 *   The partner's field has `data-side="partner"`; rivals keep `"opp"`. A spectator has no `"you"`.
 * - Each field holder (`[data-field-hold={seat}]`, the node around the SeatField): `data-relation="self" | "partner" |
 *   "opponent" | "other"` ("other" = spectator view of any seat). The relation is NOT on the `data-seat-field` node: the
 *   e2e helper reads `[data-field-hold][data-relation] [data-seat-field]`.
 * - Each LP chip of the team plate: `data-lp-seat={seat}`. The hand has `data-hand-seat={seat}` and `data-side="you"`.
 * - The hand is a group with `aria-label="Your hand"`.
 * - The header shows the visible text `Turn N` (see `tagTurnText`).
 * - Chain chips: `[data-chain-fx] [data-testid="priority-chips"] [data-seat][data-now]`, `data-now="true"` on the
 *   seat that is choosing.
 */
export const TAG_DOM = {
  shellAttr: "data-table-shell",
  shellValue: "tag",
  canActAttr: "data-can-act",
  fieldLabel: "Duel field",
  stageAttr: "data-table-stage",
  stageValue: "tag",
  extraStageAttr: "data-tag-stage",
  seatFieldAttr: "data-seat-field",
  sideAttr: "data-side",
  sideSelf: "you",
  sidePartner: "partner",
  relationAttr: "data-relation",
  relations: ["self", "partner", "opponent", "other"],
  lpSeatAttr: "data-lp-seat",
  handLabel: "Your hand",
  handSeatAttr: "data-hand-seat",
  chainFxAttr: "data-chain-fx",
  chipsTestId: "priority-chips",
  chipSeatAttr: "data-seat",
  chipNowAttr: "data-now",
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

const isOpen = (value: unknown) =>
  value != null && value !== false && !(typeof value === "object" && "open" in value && (value as { open?: unknown }).open === false);

export interface TagInputState {
  /** The card action menu (an object with `open: false` counts as closed). */
  menu?: unknown;
  /** The pile viewer (an object with `open: false` counts as closed). */
  pile?: unknown;
  /** A room dialog (surrender, settings). */
  dialog?: boolean;
  /** The room's own flag (`inputSuspended` prop). */
  inputSuspended?: boolean;
  narrow?: boolean;
  /** The phone side sheet is open. */
  sheetOpen?: boolean;
}

/**
 * Mirror of table-shell.tsx: `inputSuspended || ui.suspended (menu or pile) || (narrow && sheetOpen)`. A room dialog counts
 * too. It gates the aim flow AND the camera keys. A seat pick or an aim must NOT suspend input: the aim flow needs its
 * digits and Esc then.
 */
export function tagInputSuspended(state: TagInputState): boolean {
  return state.inputSuspended === true || state.dialog === true || isOpen(state.menu) || isOpen(state.pile) || (state.narrow === true && state.sheetOpen === true);
}

export interface TagCameraState {
  aiming?: boolean;
  /** A seat pick is open: the digit keys belong to it. */
  seatKeys?: boolean;
  /** A centred prompt is not yet revealed. */
  centeredUnrevealed?: boolean;
}

/** The camera keys (not the aim flow) give way: an aim, the seat-pick digits, or a prompt not yet revealed. */
export function tagCameraYields(state: TagCameraState): boolean {
  return state.aiming === true || state.seatKeys === true || state.centeredUnrevealed === true;
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
 * Each team's seats start from `turnSeat` in turn order (seat 2 on turn: team 0 reads [2, 0]). Null while the chain is
 * empty or when both teams passed. It reuses `responseWindow` for the member states.
 */
export function tagResponseOrder(engine: DuelEngineView, turnSeat: number, passed: readonly number[] = []): TagResponseOrder | null {
  const last = engine.chain[engine.chain.length - 1];
  if (!last) return null;
  const count = seatsOfTeam("tag", 0).length + seatsOfTeam("tag", 1).length;
  const turnOrder = Array.from({ length: count }, (_, i) => (turnSeat + i) % count);
  const inTeam = (team: number) => turnOrder.filter((seat) => teamOfSeat("tag", seat) === team);
  const ownerTeam = teamOfSeat("tag", last.seat);
  const done = (team: number) => inTeam(team).every((seat) => passed.includes(seat));
  if (done(1 - ownerTeam) && done(ownerTeam)) return null;
  const team = done(1 - ownerTeam) ? ownerTeam : 1 - ownerTeam;
  const seats = inTeam(team);
  const promptSeat = seats.find((seat) => !passed.includes(seat))!;
  const window = responseWindow(engine, null, promptSeat, passed.filter((seat) => seats.includes(seat)))!;
  return { team, seats, promptSeat, window };
}
