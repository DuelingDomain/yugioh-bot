import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
export const remoteActionIdSchema = z.string().min(1).max(100);
const readerStageSchema=z.strictObject({score:z.number().finite().min(-1.01).max(1.01),runnerUp:z.number().finite().min(-1.01).max(1.01),margin:z.number().finite().min(0).max(2.02),ms:z.number().finite().nonnegative()});
/** Optional test evidence; never consulted by the reducer or identity rules. */
export const remoteSetEvidenceSchema = z.strictObject({
  detector:z.number().min(0).max(1),pixel:z.enum(['up','down','unknown']),pixelConfidence:z.number().min(0).max(1),
  sd:z.number().min(0).max(255).nullable(),backDistance:z.number().min(0).max(2).nullable(),positive:z.boolean(),
  basis:z.enum(['pixels','uniform','known-back','zoom','none','player','legacy']),decision:z.enum(['waiting','committed','prompted','ignored','not-a-card']),
});
/**
 * Evidence from the actor's own browser, in epoch milliseconds on the CLIENT clock (`performance.timeOrigin + performance.now()`):
 * `seenAt` the sample supporting the action, `namedAt` the end of the last read, `sentAt` the board write, `v` the web build id.
 * The reducer compares camera times to reject stale evidence. Server time still determines game order.
 * `by` who made the change (`camera` = the watcher on its own, `player` = a person: a click, a typed or spoken command, or a choice in a prompt; left out when the code cannot know)
 * and `ui` the control that made it (a short name such as `popup-remove`, `undo`, `voice`, `typed`, `stale-recover`). Both are optional.
 */
export const remoteCameraStampSchema = z.strictObject({
  seenAt: z.number().int().nonnegative().optional(), namedAt: z.number().int().nonnegative().optional(),
  sentAt: z.number().int().nonnegative(), v: z.string().max(64).optional(),
  by: z.enum(["camera", "player"]).optional(), ui: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/).optional(),
  reader: z.strictObject({
    selected:z.literal('hybrid'), stage:z.enum(['first','second','fallback']),model:z.string().max(64),reason:z.string().max(160).optional(),
    first:readerStageSchema.optional(),second:readerStageSchema.optional(),
    ms:z.number().finite().nonnegative(),
  }).optional(),
  set:remoteSetEvidenceSchema.optional(),
});
export type RemoteCameraStamp = z.infer<typeof remoteCameraStampSchema>;
export const remoteActionMeta = {
  idempotencyKey: remoteActionIdSchema,
  actorSeat: remoteSeatSchema,
  /** The service always replaces a client clock with server time. */
  at: z.number().int().nonnegative().optional(),
  cam: remoteCameraStampSchema.optional(),
};
