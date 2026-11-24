import { z } from "zod";
import { remoteActionMeta as meta, remoteSeatSchema } from "./action-meta.js";
import { remoteMatchActionSchemas } from "./match-contract.js";
import type { RemotePosition } from "./types.js";
export { remoteSetEvidenceSchema, remoteSeatSchema, remoteCameraStampSchema, type RemoteCameraStamp } from "./action-meta.js";

/** One seat may send a response this often (server rule); the browser disables its button for the same time. */
export const REMOTE_RESPOND_COOLDOWN_MS = 8000;

/** One seat may send Thinking or OK this often (server rule). It stops a held key from flooding the log. */
export const REMOTE_SIGNAL_COOLDOWN_MS = 1000;

const id = z.string().min(1).max(100);
const zone = z.string().min(1).max(40);
const cardId = z.number().int().positive().max(0xffffffff);
const slot = z.number().int().min(1).max(5);
/** Extra Deck summons whose materials the table records: Xyz keeps them attached, the others send them to the GY. */
export const remoteSummonKinds = ["xyz", "synchro", "link", "fusion"] as const;
export type RemoteSummonKind = (typeof remoteSummonKinds)[number];
const summon = z.strictObject({ kind: z.enum(remoteSummonKinds), materialRefs: z.array(id).min(1).max(10)
  .refine(refs => new Set(refs).size === refs.length, "Duplicate material") });
const nameCandidates = z.array(z.strictObject({cardId,name:z.string().trim().min(1).max(200),score:z.number().min(-1).max(1)})).min(2).max(3)
  .refine(list=>new Set(list.map(c=>c.cardId)).size===list.length,'Duplicate name candidate');
const sighting = {
  cardId: cardId.optional(), passcode: cardId.optional(), zone: zone.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  slot: slot.optional(), cardRef: id.optional(),
  bestMatch: z.boolean().optional(),
  nameCandidates: nameCandidates.nullable().optional(),
};
export const twinCardSchema = z.strictObject({
  ref: id, cardId: cardId.optional(), passcode: cardId.optional(),
  /** Optional public annotations; no catalog lookup is needed by speech resolution. */
  name: z.string().trim().min(1).max(200).optional(), race: z.string().trim().min(1).max(40).optional(), slot: slot.optional(),
  faceUp: z.boolean().default(true), position: z.enum(["attack", "defense"]).default("attack"),
  bestMatch: z.boolean().optional(),
  nameCandidates: nameCandidates.optional(),
  /** A token: table state with no physical card. Its name is the token name; ATK/DEF are the values shown to everyone. `artId` is the catalog card whose art it borrows. */
  token: z.strictObject({ atk: z.number().int().min(0).max(999999), def: z.number().int().min(0).max(999999), artId: cardId.optional(), /** The seat that placed it on another player's field. Set by the reducer; absent when the owner placed it. */ by: remoteSeatSchema.optional() }).optional(),
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
  /** `fromHand`: a card the player held up from the hand. The card stays in the hand; it becomes public and the log says so. */
  z.strictObject({ ...meta, type: z.literal("effect.activated"), source: effectSource, fromHand: z.literal(true).optional() }),
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
    /** The camera already showed this activation from the hand. */
    fromActivation: id.optional(),
    /** A camera card that the zone rules put in another row than seen ("Trap → S3"). Log text only. */ zoneRule: z.string().trim().min(1).max(80).optional(),
    /** Same-identity physical cards visible together in one camera frame, in epoch milliseconds. */
    copyProof: z.strictObject({ simultaneousQuads: z.number().int().min(2).max(100), at: z.number().int().nonnegative() }).optional(),
    /** Explicit origin answer; independent of recognition source. */
    fromRef: id.optional(),
    /** The actor gives this card to the seat's field: it shows there as a proxy owned by the actor. */
    give: z.literal(true).optional(),
    originRequestRef: id.optional(),
    /** Explicit copy override, also retained for recorded origin answers. */
    anotherCopy: z.boolean().optional(),
    /** An Extra Deck summon: the camera saw these monsters go under the card or leave the field just before it. */
    summon: summon.optional() }),
  /** The camera saw a whole GY/banished pile leave the mat: its cards go to the hand in one undoable action. */
  z.strictObject({ ...meta, type: z.literal("pile.lift"), seat: remoteSeatSchema, zone: z.enum(["graveyard", "banished"]), cardRefs: z.array(id).min(1).max(120), source: z.literal("auto").optional() }),
  /** One tap sends the listed monsters (any field, tokens included) to their owners' Graveyards. A token just leaves the table. One Undo restores them all. */
  z.strictObject({ ...meta, type: z.literal("monsters.tribute"), seat: remoteSeatSchema,
    targets: z.array(z.strictObject({ seat: remoteSeatSchema, cardRef: id })).min(1).max(60) }),
  /** The owner fixes the order of a GY/banished pile (oldest first). The list must hold every card of the pile once. */
  z.strictObject({ ...meta, type: z.literal("pile.order"), seat: remoteSeatSchema, zone: z.enum(["graveyard", "banished"]), cardRefs: z.array(id).min(1).max(120)
    .refine(refs => new Set(refs).size === refs.length, "Duplicate pile card"), source: z.literal("auto").optional() }),
  z.strictObject({ ...meta, type: z.literal("twin.move"), seat: remoteSeatSchema, zone, cardRef: id, slot: slot.optional(), position: z.enum(["attack", "defense"]).optional(), faceUp: z.boolean().optional(), source: z.literal("auto").optional(), name: z.string().trim().min(1).max(200).optional(),
    /** Fresh public ref for a camera-confirmed face-down return from the hand. */
    setRef: id.optional(),
    /** The card moved between physical cells, even if its virtual slot stays the same. */
    physicalZoneChanged: z.literal(true).optional(),
    /** A face-up Pendulum Monster in the Extra Deck is public information (only that card; every other Extra card stays hidden). */
    pendulum: z.boolean().optional(),
    /** The camera or the player chose this destination (not a rule default): the card keeps no field origin. */
    confirmed: z.boolean().optional(),
    zoneRule: z.string().trim().min(1).max(80).optional(),
    /** A Trap that becomes a monster (Trap Monster) keeps its Spell & Trap Zone occupied while it is a monster. */
    trapMonster: z.boolean().optional() }),
  /** Link an Equip Card to the monster it equips (any seat), or clear the link with `target: null`. */
  z.strictObject({ ...meta, type: z.literal("twin.equip"), seat: remoteSeatSchema, cardRef: id, target: z.strictObject({ seat: remoteSeatSchema, ref: id }).nullable() }),
  /** Control change. The card moves from `seat` (its holder) to `toSeat`, into a zone on `toSeat`'s side. The taker or the holder may send it. A card that returns to its owner's seat drops the owner mark. */
  z.strictObject({ ...meta, type: z.literal("twin.control"), seat: remoteSeatSchema, cardRef: id, toSeat: remoteSeatSchema,
    zone: z.enum(["monster", "extra-monster", "spell-trap", "field", "pendulum", "graveyard", "banished"]), slot: slot.optional(), position: z.enum(["attack", "defense"]).optional(), faceUp: z.boolean().optional() }),
  /** Record the materials of a summoned card already on the field: Xyz attaches them; Synchro/Link/Fusion send them to the GY. */
  z.strictObject({ ...meta, type: z.literal("twin.attach"), seat: remoteSeatSchema, cardRef: id, ...summon.shape,
    /** Xyz only: the materials are monsters of this other player (an Xyz that attaches a card from the opponent's field). They keep their owner. Only that player sends it (from their own client). */
    materialSeat: remoteSeatSchema.optional() }),
  /** Detach one Xyz material (default: to the GY). */
  z.strictObject({ ...meta, type: z.literal("twin.detach"), seat: remoteSeatSchema, cardRef: id, materialRef: id,
    zone: z.enum(["graveyard", "banished", "hand", "deck", "extra"]).default("graveyard") }),
  z.strictObject({ ...meta, type: z.literal("twin.flip"), seat: remoteSeatSchema, cardRef: id, faceUp: z.boolean(),
    cardId:cardId.optional(),name:sighting.name,bestMatch:z.boolean().optional(),position:z.enum(['attack','defense']).optional(),source:z.literal('auto').optional(),
    /** A token's new ATK/DEF, set by its controller or creator. Only a face-up token takes it. */
    tokenStats:z.strictObject({atk:z.number().int().min(0).max(999999),def:z.number().int().min(0).max(999999)}).optional(),
    /** A camera back does not establish that the previously public identity still applies. */
    identityUncertain: z.literal(true).optional() })
    .refine(a=>a.faceUp||a.cardId===undefined&&a.name===undefined&&a.bestMatch===undefined,'Only a reveal can carry identity')
    .refine(a=>!a.identityUncertain||a.source==='auto'&&!a.faceUp,'Uncertain identity requires a camera Set'),
  z.strictObject({ ...meta, type: z.literal("twin.remove"), seat: remoteSeatSchema, cardRef: id, source: z.literal("auto").optional() }),
  z.strictObject({ ...meta, type: z.literal("log.note"), text: z.string().trim().min(1).max(500) }),
  /** A player chains or responds ("response", "I chain"). Public room signal only: it changes nothing on the board. */
  z.strictObject({ ...meta, type: z.literal("chain.respond") }),
  /** "Thinking": this player is deciding whether to respond. `on: false` cancels it. It stays until OK, an activation, a response or a cancel. Public signal only; there is no time limit. */
  z.strictObject({ ...meta, type: z.literal("chain.thinking"), on: z.boolean() }),
  /** "OK, no response". Clears this player's Thinking and shows a short OK on every screen. Public signal only. */
  z.strictObject({ ...meta, type: z.literal("chain.ok") }),
  z.strictObject({ ...meta, type: z.literal("undo"), targetActionId: id }),
  z.strictObject({ ...meta, type: z.literal("player.concede") }),
  /** Quit the match. 1v1: the opponent wins the match. FFA: only this seat leaves for good. It cannot be undone. */
  z.strictObject({ ...meta, type: z.literal("player.leave") }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;
// Distribute over the union so parser proposals retain phase/LP/card-specific fields.
type Proposal<T> = T extends unknown ? Omit<T, "idempotencyKey" | "at"> : never;
export type RemoteActionProposal = Proposal<RemoteAction>;

export const remoteActivationKey = (name: string) => `card:${name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;

/** Only a printed limit on activating this named card counts. */
export function remoteActivationLimit(name: string, text?: string | null): string | undefined {
  const clauses = (text ?? "").matchAll(/\bYou can only activate 1\s+["“]([^"”]+)["”]\s+per turn\b/gi);
  for (const [, named] of clauses) if (remoteActivationKey(named) === remoteActivationKey(name)) return name;
}

export function remoteActivationNotice(state: RemotePosition, seat: number, name: string | undefined, fromActivation?: string): string | undefined {
  if (!name) return;
  const used = state.spellTrapActivations?.[seat]?.[remoteActivationKey(name)];
  if (used?.turn === state.turn && (!fromActivation || used.awaitingPlacement !== fromActivation)) return `${name}: only 1 activation per turn`;
}
export type TwinCard = z.infer<typeof twinCardSchema> & {
  /** A pile held for inspection is not part of the hand until confirmed. */
  inspectionFrom?: 'graveyard' | 'banished';
  zone: string; departedFrom?: { zone: string; slot?: number; at?: number; /** The camera moved it (default for a card out of view). */ auto?: boolean; /** A known face-up field card before the camera moved it to Hand. */ wasKnownFaceUp?: true }; setBy?: import("./effect-filters.js").RemoteEffectSource;
  /** Server-authored: the Spell & Trap Zone a Trap Monster still occupies. Cleared when it leaves the Monster Zones. */
  trapZone?: number;
  /** A face-up Pendulum Monster in the Extra Deck: the one Extra card the opponent sees. */
  pendulumUp?: true;
  /** Server-authored: the monster this Equip Card equips. Cleared when either card leaves the field. */
  equippedTo?: { seat: number; ref: string };
  /** Server-authored: the seat of the real owner while another player controls the card (Monster Reborn on their Graveyard, Change of Heart). Cleared when it returns. */
  ownerSeat?: number;
  /** Server-authored: what a face-down card was, kept for its owner while another player controls it. Never shown to anyone else. */
  ownerIdentity?: { cardId?: number; passcode?: number; name?: string; race?: string };
  /** Server-authored: Xyz materials under this card, bottom first (twin refs in zone "material"). */
  materials?: string[];
  /** Server-authored: the Xyz Monster this material is attached to. */
  materialOf?: string;
  /** Server-authored knowledge; independent of the physical face-up/down state. */
  publicIdentity?: boolean;
  /** Server-authored: a face-down field card whose identity was already public on the field, including to spectators. */
  knownFaceDown?: true;
};
export class RemoteDuelError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "REMOTE_INVALID") { super(message); this.name = "RemoteDuelError"; }
}
export function remoteAssert(value: unknown, message: string, status = 400, code?: string): asserts value {
  if (!value) throw new RemoteDuelError(message, status, code);
}
