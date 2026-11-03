import { z } from "zod";

export const remoteSeatSchema = z.number().int().min(0).max(3);
const id = z.string().min(1).max(100);
const zone = z.string().min(1).max(40);
const cardId = z.number().int().positive().max(0xffffffff);
const slot = z.number().int().min(1).max(5);
const sighting = {
  cardId: cardId.optional(), passcode: cardId.optional(), zone: zone.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  slot: slot.optional(), cardRef: id.optional(),
  bestMatch: z.boolean().optional(),
};
export const twinCardSchema = z.strictObject({
  ref: id, cardId: cardId.optional(), passcode: cardId.optional(),
  /** Optional public annotations; no catalog lookup is needed by speech resolution. */
  name: z.string().trim().min(1).max(200).optional(), race: z.string().trim().min(1).max(40).optional(), slot: slot.optional(),
  faceUp: z.boolean().default(true), position: z.enum(["attack", "defense"]).default("attack"),
  bestMatch: z.boolean().optional(),
});
const meta = {
  idempotencyKey: id, actorSeat: remoteSeatSchema,
  /** Optimistic clients may supply this; the service ALWAYS replaces it with server time. */
  at: z.number().int().nonnegative().optional(),
};
const effectSource = z.strictObject({ cardId: cardId.optional(), cardRef: id.optional(), name: z.string().trim().min(1).max(200).optional() })
  .refine(source=>!!(source.cardId || source.cardRef || source.name), "Identify the effect source");
export const remoteActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...meta, type: z.literal("effect.activated"), source: effectSource }),
  z.strictObject({ ...meta, type: z.literal("effect.choose"), originId: z.string().min(1).max(110), cardId }),
  z.strictObject({ ...meta, type: z.literal("effect.announce"), originId: z.string().min(1).max(110) }),
  z.strictObject({ ...meta, type: z.literal("effect.context.clear") }),
  z.strictObject({ ...meta, type: z.literal("effect.note.dismiss"), noteId: z.string().min(1).max(110) }),
  z.strictObject({ ...meta, type: z.literal("phase.set"), phase: zone }),
  z.strictObject({ ...meta, type: z.literal("phase.advance") }),
  z.strictObject({ ...meta, type: z.literal("turn.end") }),
  z.strictObject({ ...meta, type: z.literal("lp.change"), seat: remoteSeatSchema, delta: z.number().int().min(-999999).max(999999).refine(n => n !== 0), reason: z.string().trim().min(1).max(200) }),
  z.strictObject({ ...meta, type: z.literal("attack.declare"), attackerSeat: remoteSeatSchema, attackerCardRef: id.optional(), targetSeat: remoteSeatSchema, targetCardRef: id.optional(), direct: z.boolean().optional() }),
  z.strictObject({ ...meta, type: z.literal("attack.resolve"), attackId: id, outcome: z.enum(["resolved", "cancelled"]) }),
  z.strictObject({ ...meta, type: z.literal("card.identified"), seat: remoteSeatSchema, ...sighting, source: z.enum(["click", "auto", "voice", "typed"]) }),
  z.strictObject({ ...meta, type: z.literal("cards.identified"), seat: remoteSeatSchema, source: z.enum(["click", "auto", "voice", "typed"]),
    cards: z.array(z.strictObject({ ...sighting, observationId: id })).min(1).max(20)
      .refine(cards => new Set(cards.map(c => c.observationId)).size === cards.length, "Duplicate physical observation") }),
  z.strictObject({ ...meta, type: z.literal("deck.add"), seat: remoteSeatSchema, cardId }),
  z.strictObject({ ...meta, type: z.literal("deck.flag.dismiss"), flagId: z.string().min(1).max(250), reason: z.string().trim().min(1).max(200) }),
  z.strictObject({ ...meta, type: z.literal("twin.merge"), seat: remoteSeatSchema,
    keepInstanceId: z.string().min(1).max(250).optional(), removeInstanceId: z.string().min(1).max(250).optional(),
    keepRef: id.optional(), removeRef: id.optional(), reason: z.string().trim().min(1).max(200) })
    .refine(a => (!!a.keepInstanceId && !!a.removeInstanceId && !a.keepRef && !a.removeRef) ||
      (!!a.keepRef && !!a.removeRef && !a.keepInstanceId && !a.removeInstanceId), "Choose two instance IDs or two twin refs"),
  z.strictObject({ ...meta, type: z.literal("twin.place"), seat: remoteSeatSchema, zone, card: twinCardSchema, source: z.literal("auto").optional(),
    /** Same-identity physical cards visible together in one camera frame, in epoch milliseconds. */
    copyProof: z.strictObject({ simultaneousQuads: z.number().int().min(2).max(100), at: z.number().int().nonnegative() }).optional(),
    /** Explicit origin answer; independent of recognition source. */
    fromRef: id.optional(),
    originRequestRef: id.optional(),
    /** Explicit copy override, also retained for recorded origin answers. */
    anotherCopy: z.boolean().optional() }),
  /** The camera saw a whole GY/banished pile leave the mat: its cards go to the hand in one undoable action. */
  z.strictObject({ ...meta, type: z.literal("pile.lift"), seat: remoteSeatSchema, zone: z.enum(["graveyard", "banished"]), cardRefs: z.array(id).min(1).max(120), source: z.literal("auto").optional() }),
  z.strictObject({ ...meta, type: z.literal("twin.move"), seat: remoteSeatSchema, zone, cardRef: id, slot: slot.optional(), position: z.enum(["attack", "defense"]).optional(), faceUp: z.boolean().optional(), source: z.literal("auto").optional(), name: z.string().trim().min(1).max(200).optional(),
    /** A Trap that becomes a monster (Trap Monster) keeps its Spell & Trap Zone occupied while it is a monster. */
    trapMonster: z.boolean().optional() }),
  /** Link an Equip Card to the monster it equips (any seat), or clear the link with `target: null`. */
  z.strictObject({ ...meta, type: z.literal("twin.equip"), seat: remoteSeatSchema, cardRef: id, target: z.strictObject({ seat: remoteSeatSchema, ref: id }).nullable() }),
  z.strictObject({ ...meta, type: z.literal("twin.flip"), seat: remoteSeatSchema, cardRef: id, faceUp: z.boolean(),
    cardId:cardId.optional(),name:sighting.name,bestMatch:z.boolean().optional(),position:z.enum(['attack','defense']).optional(),source:z.literal('auto').optional() })
    .refine(a=>a.faceUp||a.cardId===undefined&&a.name===undefined&&a.bestMatch===undefined,'Only a reveal can carry identity'),
  z.strictObject({ ...meta, type: z.literal("twin.remove"), seat: remoteSeatSchema, cardRef: id }),
  z.strictObject({ ...meta, type: z.literal("log.note"), text: z.string().trim().min(1).max(500) }),
  z.strictObject({ ...meta, type: z.literal("undo"), targetActionId: id }),
  z.strictObject({ ...meta, type: z.literal("player.concede") }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;
// Distribute over the union so parser proposals retain phase/LP/card-specific fields.
type Proposal<T> = T extends unknown ? Omit<T, "idempotencyKey" | "at"> : never;
export type RemoteActionProposal = Proposal<RemoteAction>;
export type TwinCard = z.infer<typeof twinCardSchema> & {
  zone: string; departedFrom?: { zone: string; slot?: number; at?: number }; setBy?: import("./effect-filters.js").RemoteEffectSource;
  /** Server-authored: the Spell & Trap Zone a Trap Monster still occupies. Cleared when it leaves the Monster Zones. */
  trapZone?: number;
  /** Server-authored: the monster this Equip Card equips. Cleared when either card leaves the field. */
  equippedTo?: { seat: number; ref: string };
  /** Server-authored knowledge; independent of the physical face-up/down state. */
  publicIdentity?: boolean;
};
export class RemoteDuelError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "REMOTE_INVALID") { super(message); this.name = "RemoteDuelError"; }
}
export function remoteAssert(value: unknown, message: string, status = 400, code?: string): asserts value {
  if (!value) throw new RemoteDuelError(message, status, code);
}
