import { z } from "zod";
import { remoteActionMeta as meta, remoteSeatSchema } from "./action-meta.js";
import { remoteMatchActionSchemas } from "./match-contract.js";
export { remoteSeatSchema } from "./action-meta.js";

const id = z.string().min(1).max(100);
const zone = z.string().min(1).max(40);
const cardId = z.number().int().positive().max(0xffffffff);
const slot = z.number().int().min(1).max(5);
/** Extra Deck summons whose materials the table records: Xyz keeps them attached, the others send them to the GY. */
export const remoteSummonKinds = ["xyz", "synchro", "link", "fusion"] as const;
export type RemoteSummonKind = (typeof remoteSummonKinds)[number];
const summon = z.strictObject({ kind: z.enum(remoteSummonKinds), materialRefs: z.array(id).min(1).max(10)
  .refine(refs => new Set(refs).size === refs.length, "Duplicate material") });
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
  /** A token: table state with no physical card. Its name is the token name; ATK/DEF are the values shown to everyone. `artId` is the catalog card whose art it borrows. */
  token: z.strictObject({ atk: z.number().int().min(0).max(999999), def: z.number().int().min(0).max(999999), artId: cardId.optional() }).optional(),
});
const effectSource = z.strictObject({ cardId: cardId.optional(), cardRef: id.optional(), name: z.string().trim().min(1).max(200).optional() })
  .refine(source=>!!(source.cardId || source.cardRef || source.name), "Identify the effect source");
export const remoteActionSchema = z.discriminatedUnion("type", [
  ...remoteMatchActionSchemas,
  z.strictObject({ ...meta, type: z.literal("hand.add"), cardId, source: z.enum(["deck", "gy", "banish", "extra", "field", "unknown"]), by: z.strictObject({cardId, name: z.string().trim().min(1).max(200)}).optional() }),
  z.strictObject({ ...meta, type: z.literal("hand.reveal"), cardId }),
  z.strictObject({ ...meta, type: z.literal("hand.forget"), id }),
  z.strictObject({ ...meta, type: z.literal("hand.draw"), count: z.number().int().min(1).max(999999).default(1) }),
  z.strictObject({ ...meta, type: z.literal("deck.count"),
    delta: z.number().int().min(-999999).max(999999).optional(),
    value: z.number().int().min(0).max(999999).optional(), cause: z.literal("other").optional() })
    .refine(a => (a.delta !== undefined) !== (a.value !== undefined), "Choose either a deck count delta or value"),
  z.strictObject({ ...meta, type: z.literal("hand.count"),
    delta: z.number().int().min(-999999).max(999999).optional(),
    value: z.number().int().min(0).max(999999).optional() })
    .refine(a => (a.delta !== undefined) !== (a.value !== undefined), "Choose either a hand count delta or value"),
  z.strictObject({ ...meta, type: z.literal("effect.activated"), source: effectSource }),
  z.strictObject({ ...meta, type: z.literal("effect.choose"), originId: z.string().min(1).max(110), cardId }),
  z.strictObject({ ...meta, type: z.literal("effect.announce"), originId: z.string().min(1).max(110) }),
  z.strictObject({ ...meta, type: z.literal("effect.context.clear") }),
  z.strictObject({ ...meta, type: z.literal("effect.note.dismiss"), noteId: z.string().min(1).max(110) }),
  z.strictObject({ ...meta, type: z.literal("phase.set"), phase: zone }),
  z.strictObject({ ...meta, type: z.literal("phase.advance") }),
  z.strictObject({ ...meta, type: z.literal("turn.end") }),
  /** The actor reports their own device mode. This public fact changes no board state. */
  z.strictObject({ ...meta, type: z.literal("detection.mode"), mode: z.enum(["auto", "tap", "manual"]), reason: z.enum(["player", "slow-offer", "start"]) }),
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
    /** A camera card that the zone rules put in another row than seen ("Trap → S3"). Log text only. */ zoneRule: z.string().trim().min(1).max(80).optional(),
    /** Same-identity physical cards visible together in one camera frame, in epoch milliseconds. */
    copyProof: z.strictObject({ simultaneousQuads: z.number().int().min(2).max(100), at: z.number().int().nonnegative() }).optional(),
    /** Explicit origin answer; independent of recognition source. */
    fromRef: id.optional(),
    originRequestRef: id.optional(),
    /** Explicit copy override, also retained for recorded origin answers. */
    anotherCopy: z.boolean().optional(),
    /** An Extra Deck summon: the camera saw these monsters go under the card or leave the field just before it. */
    summon: summon.optional() }),
  /** The camera saw a whole GY/banished pile leave the mat: its cards go to the hand in one undoable action. */
  z.strictObject({ ...meta, type: z.literal("pile.lift"), seat: remoteSeatSchema, zone: z.enum(["graveyard", "banished"]), cardRefs: z.array(id).min(1).max(120), source: z.literal("auto").optional() }),
  /** The owner fixes the order of a GY/banished pile (oldest first). The list must hold every card of the pile once. */
  z.strictObject({ ...meta, type: z.literal("pile.order"), seat: remoteSeatSchema, zone: z.enum(["graveyard", "banished"]), cardRefs: z.array(id).min(1).max(120)
    .refine(refs => new Set(refs).size === refs.length, "Duplicate pile card") }),
  z.strictObject({ ...meta, type: z.literal("twin.move"), seat: remoteSeatSchema, zone, cardRef: id, slot: slot.optional(), position: z.enum(["attack", "defense"]).optional(), faceUp: z.boolean().optional(), source: z.literal("auto").optional(), name: z.string().trim().min(1).max(200).optional(),
    zoneRule: z.string().trim().min(1).max(80).optional(),
    /** A Trap that becomes a monster (Trap Monster) keeps its Spell & Trap Zone occupied while it is a monster. */
    trapMonster: z.boolean().optional() }),
  /** Link an Equip Card to the monster it equips (any seat), or clear the link with `target: null`. */
  z.strictObject({ ...meta, type: z.literal("twin.equip"), seat: remoteSeatSchema, cardRef: id, target: z.strictObject({ seat: remoteSeatSchema, ref: id }).nullable() }),
  /** Record the materials of a summoned card already on the field: Xyz attaches them; Synchro/Link/Fusion send them to the GY. */
  z.strictObject({ ...meta, type: z.literal("twin.attach"), seat: remoteSeatSchema, cardRef: id, ...summon.shape }),
  /** Detach one Xyz material (default: to the GY). */
  z.strictObject({ ...meta, type: z.literal("twin.detach"), seat: remoteSeatSchema, cardRef: id, materialRef: id,
    zone: z.enum(["graveyard", "banished", "hand", "deck", "extra"]).default("graveyard") }),
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
  /** A pile held for inspection is not part of the hand until confirmed. */
  inspectionFrom?: 'graveyard' | 'banished';
  zone: string; departedFrom?: { zone: string; slot?: number; at?: number; /** The camera moved it (default for a card out of view). */ auto?: boolean }; setBy?: import("./effect-filters.js").RemoteEffectSource;
  /** Server-authored: the Spell & Trap Zone a Trap Monster still occupies. Cleared when it leaves the Monster Zones. */
  trapZone?: number;
  /** Server-authored: the monster this Equip Card equips. Cleared when either card leaves the field. */
  equippedTo?: { seat: number; ref: string };
  /** Server-authored: Xyz materials under this card, bottom first (twin refs in zone "material"). */
  materials?: string[];
  /** Server-authored: the Xyz Monster this material is attached to. */
  materialOf?: string;
  /** Server-authored knowledge; independent of the physical face-up/down state. */
  publicIdentity?: boolean;
};
export class RemoteDuelError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "REMOTE_INVALID") { super(message); this.name = "RemoteDuelError"; }
}
export function remoteAssert(value: unknown, message: string, status = 400, code?: string): asserts value {
  if (!value) throw new RemoteDuelError(message, status, code);
}
