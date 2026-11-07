import { z } from "zod";
import type { DuelBestOf, DuelDeck } from "../duels/index.js";
import { remoteActionIdSchema, remoteActionMeta as meta, remoteSeatSchema as seat } from "./action-meta.js";

export type RemoteBestOf = DuelBestOf;
export type RemoteSideDeckChanges = Pick<DuelDeck, "main" | "extra" | "side">;
export type RemoteGameResult = {
  n: number; winnerSeat: number | null; reason: "lp" | "concede" | "declared" | "timeout"; endedAt: number;
};
export type RemoteSiding = {
  /** Last seat's siding deadline; the game never starts just because one seat expires. */
  deadline: number;
  /** Optional only for snapshots recorded before explicit seat deadlines. */
  seatDeadlines?: Record<number, number>;
  /** Set when everyone is ready but the chooser has not picked a first player. */
  firstChoiceDeadline?: number;
  ready: number[]; extendedFor: number[];
};
/** The opening die roll of game 1, written once when the table starts. Public: every seat and spectator sees the same dice. */
export type RemoteOpening = {
  /** Every die thrown, round by round, one entry per seat. A tie re-rolls only the tied seats; a seat that sat out holds null. */
  rounds: (number | null)[][];
  /** The seat with the single highest roll of the last round. It chooses who goes first. */
  winnerSeat: number;
  startedAt: number;
  /** After this time the winner goes first. */
  deadline: number;
  /** Set once the first player is decided (chosen, defaulted at the deadline, or a bot winner). */
  chosenSeat?: number;
};
export type RemoteMatch = {
  bestOf: RemoteBestOf;
  games: RemoteGameResult[];
  phase: "duel" | "result" | "siding" | "done";
  siding?: RemoteSiding;
  winnerSeat?: number | null;
  pendingResult?: { id: string; winnerSeat: number | null; confirmed: number[];
    /** Opponent-entered LP zero: only this seat can admit or reject the loss. */
    lpSeat?: number };
  firstChooser?: number | null;
  firstSeat?: number;
  /** Game 1 of a table that rolled for the first player. Absent on tables started before the roll existed. */
  opening?: RemoteOpening;
};

export const REMOTE_SIDE_MS = 180_000;
export const REMOTE_SIDE_DECK_MS = 300_000;
export const REMOTE_FIRST_CHOICE_MS = 20_000;
/** How long one round of the opening dice stays on screen. The choice clock starts after the last round. */
export const REMOTE_OPENING_ROUND_MS = 3_000;
export const remoteBestOfSchema = z.union([z.literal(1), z.literal(3)]);
const codes = z.array(z.number().int().positive().max(0xffffffff));
export const remoteSideDeckChangesSchema = z.strictObject({
  main: codes.min(40).max(60), extra: codes.max(15), side: codes.max(15),
});
export const remoteMatchActionSchemas = [
  z.strictObject({ ...meta, type: z.literal("match.declare"), winnerSeat: seat.nullable() }),
  z.strictObject({ ...meta, type: z.literal("match.confirm"), declarationId: remoteActionIdSchema, accept: z.boolean() }),
  z.strictObject({ ...meta, type: z.literal("match.continue") }),
  z.strictObject({ ...meta, type: z.literal("match.first"), seatGoesFirst: seat }),
  z.strictObject({ ...meta, type: z.literal("side.ready"), seat }),
  z.strictObject({ ...meta, type: z.literal("side.unready"), seat }),
  z.strictObject({ ...meta, type: z.literal("side.swap"), deckChanges: remoteSideDeckChangesSchema }),
  z.strictObject({ ...meta, type: z.literal("side.timeout") }),
] as const;
export const remoteMatchActionSchema = z.discriminatedUnion("type", remoteMatchActionSchemas);
export type RemoteMatchAction = z.infer<typeof remoteMatchActionSchema>;
export const REMOTE_MATCH_ACTION_NAMES = ["player.concede", ...remoteMatchActionSchemas.map(schema => schema.shape.type.value)] as const;
