import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
const id = z.string().min(1).max(100);
const zone = z.string().min(1).max(40);
const cardId = z.number().int().positive().max(0xffffffff);
export const twinCardSchema = z.strictObject({
  ref: id, cardId: cardId.optional(), passcode: cardId.optional(),
  faceUp: z.boolean().default(true), position: z.enum(["attack", "defense"]).default("attack"),
});
const meta = {
  idempotencyKey: id, actorSeat: remoteSeatSchema,
  /** Optimistic clients may supply this; the service ALWAYS replaces it with server time. */
  at: z.number().int().nonnegative().optional(),
};
export const remoteActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...meta, type: z.literal("phase.set"), phase: zone }),
  z.strictObject({ ...meta, type: z.literal("phase.advance") }),
  z.strictObject({ ...meta, type: z.literal("turn.end") }),
  z.strictObject({ ...meta, type: z.literal("lp.change"), seat: remoteSeatSchema, delta: z.number().int().min(-999999).max(999999).refine(n => n !== 0), reason: z.string().trim().min(1).max(200) }),
  z.strictObject({ ...meta, type: z.literal("attack.declare"), attackerSeat: remoteSeatSchema, attackerCardRef: id.optional(), targetSeat: remoteSeatSchema, targetCardRef: id.optional(), direct: z.boolean().optional() }),
  z.strictObject({ ...meta, type: z.literal("attack.resolve"), attackId: id, outcome: z.enum(["resolved", "cancelled"]) }),
  z.strictObject({ ...meta, type: z.literal("card.identified"), seat: remoteSeatSchema, cardId: cardId.optional(), passcode: cardId.optional(), zone: zone.optional(), source: z.enum(["click", "auto", "voice", "typed"]) }),
  z.strictObject({ ...meta, type: z.literal("twin.place"), seat: remoteSeatSchema, zone, card: twinCardSchema }),
  z.strictObject({ ...meta, type: z.literal("twin.move"), seat: remoteSeatSchema, zone, cardRef: id }),
  z.strictObject({ ...meta, type: z.literal("twin.flip"), seat: remoteSeatSchema, cardRef: id, faceUp: z.boolean() }),
  z.strictObject({ ...meta, type: z.literal("twin.remove"), seat: remoteSeatSchema, cardRef: id }),
  z.strictObject({ ...meta, type: z.literal("log.note"), text: z.string().trim().min(1).max(500) }),
  z.strictObject({ ...meta, type: z.literal("undo"), targetActionId: id }),
  z.strictObject({ ...meta, type: z.literal("player.concede") }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;
// Distribute over the union so parser proposals retain phase/LP/card-specific fields.
type Proposal<T> = T extends unknown ? Omit<T, "idempotencyKey" | "at"> : never;
export type RemoteActionProposal = Proposal<RemoteAction>;
export type TwinCard = z.infer<typeof twinCardSchema> & { zone: string };
export class RemoteDuelError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "REMOTE_INVALID") { super(message); this.name = "RemoteDuelError"; }
}
export function remoteAssert(value: unknown, message: string, status = 400, code?: string): asserts value {
  if (!value) throw new RemoteDuelError(message, status, code);
}
