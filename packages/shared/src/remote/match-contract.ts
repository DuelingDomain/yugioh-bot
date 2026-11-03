import { z } from "zod";
import type { DuelBestOf, DuelDeck } from "../duels/index.js";
import { remoteActionIdSchema, remoteActionMeta as meta, remoteSeatSchema as seat } from "./action-meta.js";

export type RemoteBestOf = DuelBestOf;
export type RemoteSideDeckChanges = Pick<DuelDeck, "main" | "extra" | "side">;
export type RemoteGameResult = {
  n: number; winnerSeat: number | null; reason: "lp" | "concede" | "declared" | "timeout"; endedAt: number;
};
export type RemoteSiding = { deadline: number; ready: number[]; extendedFor: number[] };
export type RemoteMatch = {
  bestOf: RemoteBestOf;
  games: RemoteGameResult[];
  phase: "duel" | "result" | "siding" | "done";
  siding?: RemoteSiding;
  winnerSeat?: number | null;
  pendingResult?: { id: string; winnerSeat: number | null; confirmed: number[] };
  firstChooser?: number | null;
  firstSeat?: number;
};

export const REMOTE_SIDE_MS = 180_000;
export const REMOTE_SIDE_DECK_MS = 300_000;
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
