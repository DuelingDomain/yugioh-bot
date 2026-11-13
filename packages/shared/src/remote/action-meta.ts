import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
export const remoteActionIdSchema = z.string().min(1).max(100);
/**
 * Test evidence from the actor's own browser, in epoch milliseconds on the CLIENT clock (`performance.timeOrigin + performance.now()`;
 * never trusted for game state): `seenAt` the detector's first outline of the card, `namedAt` the end of the last read, `sentAt` the
 * watcher sent this action (the board placement), `v` the web build id. Compare with the recording of the table camera and with the server `at`.
 * `by` who made the change (`camera` = the watcher on its own, `player` = a person: a click, a typed or spoken command, or a choice in a prompt; left out when the code cannot know)
 * and `ui` the control that made it (a short name such as `popup-remove`, `undo`, `voice`, `typed`, `stale-recover`). Both are evidence only and optional:
 * old events and clients without them stay valid, and no rule reads them (`source` stays the field that matters to the game).
 */
export const remoteCameraStampSchema = z.strictObject({
  seenAt: z.number().int().nonnegative().optional(), namedAt: z.number().int().nonnegative().optional(),
  sentAt: z.number().int().nonnegative(), v: z.string().max(64).optional(),
  by: z.enum(["camera", "player"]).optional(), ui: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/).optional(),
});
export type RemoteCameraStamp = z.infer<typeof remoteCameraStampSchema>;
export const remoteActionMeta = {
  idempotencyKey: remoteActionIdSchema,
  actorSeat: remoteSeatSchema,
  /** The service always replaces a client clock with server time. */
  at: z.number().int().nonnegative().optional(),
  cam: remoteCameraStampSchema.optional(),
};
