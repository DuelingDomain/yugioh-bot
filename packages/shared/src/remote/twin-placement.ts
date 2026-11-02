import { remoteAssert, type RemoteAction, type TwinCard } from "./actions.js";
import { remotePhysicalSlot, type RemoteReductionContext } from "./deck-checks.js";
import type { RemoteState } from "./types.js";

type Identity = { cardId?: number; passcode?: number; name?: string };
const fold = (name?: string) => name?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const remoteFieldZone = (zone: string) => ["monster", "spell-trap", "extra-monster", "field", "pendulum"].includes(zone);

/** Catalog copy groups include alternate artworks. Names cover manual/catalog-free twins. */
export function sameTwinIdentity(state: RemoteState, seat: number, a: Identity, b: Identity, context?: RemoteReductionContext): boolean {
  const key = (card: Identity) => {
    const code = card.cardId ?? card.passcode;
    if (!code) return undefined;
    return context?.facts?.[code]?.copyKey ?? state.deckChecks.instances.find(i => i.seat === seat && i.code === code)?.copyKey ?? code;
  };
  const left = key(a), right = key(b);
  if (left !== undefined && right !== undefined) return left === right;
  const name = (card: Identity) => {
    const code = card.cardId ?? card.passcode;
    return fold(card.name ?? (code ? context?.facts?.[code]?.name ?? state.deckChecks.instances.find(i => i.seat === seat && i.code === code)?.name : undefined));
  };
  return !!name(a) && name(a) === name(b);
}

/** Reuse live pile twins first. Restore a removed ref only when no live twin remains. */
export function guardTwinPlacement(state: RemoteState, action: Extract<RemoteAction, { type: "twin.place" }>, context?: RemoteReductionContext):
  { ref: string; card?: TwinCard } | undefined {
  const twins = state.seats[action.seat].twin;
  const matches = twins.filter(t => sameTwinIdentity(state, action.seat, action.card, t, context));
  const registration = state.deckChecks.registrations[action.seat];
  const registeredCount = registration ? [...registration.deck.main, ...registration.deck.extra, ...(registration.deck.deckMaster ? [registration.deck.deckMaster] : [])]
    .filter(code => sameTwinIdentity(state, action.seat, action.card, { cardId: code }, context)).length : 0;
  const code = action.card.cardId ?? action.card.passcode;
  const limit = code ? context?.facts?.[code]?.limit : undefined;
  const anotherCopyAllowed = !!registration && !registration.validation.issues.length && matches.length < Math.min(registeredCount, limit ?? registeredCount);
  const legacyManual = context?.replay && context.twinPlacementGuard === 1 && action.source !== "auto";
  const proof = action.copyProof, at = action.at ?? state.updatedAt;
  const simultaneous = !!proof && proof.simultaneousQuads > matches.length && proof.at <= at && at - proof.at <= 5000;
  // A click is another observation of the same physical copy unless a current
  // frame proves that more copies exist. Keep the old rule for recorded events.
  if (legacyManual || action.source !== "auto" && (action.anotherCopy || simultaneous)) {
    if (action.anotherCopy) remoteAssert(anotherCopyAllowed, "The registered decklist does not allow another copy", 409, "TWIN_COPY_NOT_ALLOWED");
    const onField = matches.filter(t => remoteFieldZone(t.zone));
    if (onField.length && !action.anotherCopy) state.twinConfirmation = {
      seat: action.seat, cardRef: action.card.ref, existingRefs: onField.map(t => t.ref), anotherCopyAllowed,
      message: `You already have ${action.card.name ?? (code ? context?.facts?.[code]?.name : undefined) ?? onField[0].name ?? "this card"} on the field — another copy?`,
    };
    return;
  }
  if (simultaneous) return;
  const pile = matches.find(t => !remoteFieldZone(t.zone));
  if (pile) return { ref: pile.ref, card: pile };
  const field = matches.find(t => t.zone === action.zone && remotePhysicalSlot(t.zone, t.slot) === remotePhysicalSlot(action.zone, action.card.slot)) ?? matches[0];
  if (field) return { ref: field.ref, card: field };
  const absent = state.deckChecks.instances.find(i => i.seat === action.seat &&
    sameTwinIdentity(state, action.seat, action.card, { cardId: i.code, name: i.name }, context) &&
    i.refs.length && !twins.some(t => i.refs.includes(t.ref)));
  if (absent) return { ref: absent.refs[0] };
}
