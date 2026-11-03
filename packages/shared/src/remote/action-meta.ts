import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
export const remoteActionIdSchema = z.string().min(1).max(100);
export const remoteActionMeta = {
  idempotencyKey: remoteActionIdSchema,
  actorSeat: remoteSeatSchema,
  /** The service always replaces a client clock with server time. */
  at: z.number().int().nonnegative().optional(),
};
