import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
export const remoteActionIdSchema = z.string().min(1).max(100);
/**
 * Test evidence from the actor's own browser, in epoch milliseconds on the CLIENT clock (never trusted for game state):
 * `seenAt` the detector first saw the card, `namedAt` the read named it, `sentAt` the watcher sent this action (the board
 * placement), `v` the web build id. Compare with the recording of the table camera and with the server `at`.
 */
export const remoteCameraStampSchema = z.strictObject({
  seenAt: z.number().int().nonnegative().optional(), namedAt: z.number().int().nonnegative().optional(),
  sentAt: z.number().int().nonnegative(), v: z.string().max(64).optional(),
});
export type RemoteCameraStamp = z.infer<typeof remoteCameraStampSchema>;
export const remoteActionMeta = {
  idempotencyKey: remoteActionIdSchema,
  actorSeat: remoteSeatSchema,
  /** The service always replaces a client clock with server time. */
  at: z.number().int().nonnegative().optional(),
  cam: remoteCameraStampSchema.optional(),
};
