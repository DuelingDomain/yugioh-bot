import { remoteAssert, type RemoteAction, type TwinCard } from "./actions.js";
import { remotePhysicalSlot, type RemoteReductionContext } from "./deck-checks.js";
import type { RemoteState } from "./types.js";

type Identity = { cardId?: number; passcode?: number; name?: string; token?: unknown };
const fold = (name?: string) => name?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const remoteFieldZone = (zone: string) => ["monster", "spell-trap", "extra-monster", "field", "pendulum"].includes(zone);

/** Catalog copy groups include alternate artworks. Names cover manual/catalog-free twins. */
export function sameTwinIdentity(state: RemoteState, seat: number, a: Identity, b: Identity, context?: RemoteReductionContext): boolean {
  // Two tokens of one name are two table objects, never copies of one physical card.
  if (a.token || b.token) return false;
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

type Placement = Extract<RemoteAction, { type: "twin.place" }>;
type Reuse = { ref: string; card?: TwinCard } | { pending: true } | { noop: true };
const pileZone = (zone: string) => zone === "graveyard" || zone === "banished";
/**
 * Guard 6: a card the camera sent from the field to a pile or the Extra Deck by the rules (no camera evidence) still owns its field
 * origin, but only for 30 s, and (for a card put back on the field) only into the same zone and physical slot. A later second copy is
 * another card. A named read in another pile or the Extra Deck within 30 s is still the departed card.
 */
/** A hand card the camera lifted from the field keeps its field origin this long for a NAMED pile read (guard 8; a card tagged straight to the Extra Deck keeps only the short window; guard 7 replays used REMOTE_UNREAD_PILE_MS). */
export const REMOTE_NAMED_PILE_READ_MS = 30_000;
/** An UNREAD pile card (no name yet) can only be the card that left this recently, or it is a discard: the watcher's late-pile window. */
export const REMOTE_UNREAD_PILE_MS = 5000;
/**
 * Guard 7/8: a card the camera took off the field with no pile in view is assumed to be in the hand. If the camera then names it on a
 * pile (GY, banished) within REMOTE_NAMED_PILE_READ_MS, that is the same card (it moves, no copy). Guard 7 replays keep the old 5 s.
 */
const handLeft = (t: TwinCard, at: number, windowMs: number) => (t.zone === "hand" || t.zone === "extra") && !!t.departedFrom?.auto && remoteFieldZone(t.departedFrom.zone) &&
  t.departedFrom.at !== undefined && at >= t.departedFrom.at && at - t.departedFrom.at <= windowMs;
const autoLeft = (t: TwinCard, at: number, place: { zone: string; card: { slot?: number } }) => (pileZone(t.zone) || t.zone === "extra") && !!t.departedFrom?.auto && remoteFieldZone(t.departedFrom.zone) &&
  t.departedFrom.at !== undefined && at >= t.departedFrom.at && at - t.departedFrom.at <= REMOTE_NAMED_PILE_READ_MS &&
  (!remoteFieldZone(place.zone) || t.departedFrom.zone === place.zone && remotePhysicalSlot(place.zone, t.departedFrom.slot) === remotePhysicalSlot(place.zone, place.card.slot));
const zoneLabel = (card: { zone: string; slot?: number }) => card.zone === "monster" ? `M${card.slot ?? ""}`
  : card.zone === "spell-trap" ? `S${card.slot ?? ""}` : card.zone === "extra-monster" ? `EMZ${card.slot ?? ""}` : card.zone;

/** Keep unrelated physical cards' origin requests until their owners answer. */
export function clearTwinConfirmation(state:RemoteState,seat:number,ref:string) {
  const pending=[...(state.twinConfirmation?[state.twinConfirmation]:[]),...(state.twinConfirmationQueue??[])]
    .filter(flag=>flag.seat!==seat||flag.cardRef!==ref);
  delete state.twinConfirmation;delete state.twinConfirmationQueue;
  if(pending.length)state.twinConfirmation=pending[0];
  if(pending.length>1)state.twinConfirmationQueue=pending.slice(1);
}

/** The watcher uses the same 2.5-second window to reconnect a lifted card. */
export const REMOTE_TWIN_MOVE_WINDOW_MS = 2500;
export function recentFieldDeparture(card: TwinCard, at: number): boolean {
  const departedAt = card.departedFrom?.at;
  // Guard 6 data: a card the camera sent to a pile or the Extra Deck keeps its origin like a hand card (the data exists only then).
  return (card.zone === "hand" || !!card.departedFrom?.auto && (card.zone === "graveyard" || card.zone === "banished" || card.zone === "extra")) && departedAt !== undefined && at >= departedAt && at - departedAt <= REMOTE_TWIN_MOVE_WINDOW_MS;
}

/** A/B reuse only field origins; C/D leave every pile copy in place. */
export function guardTwinPlacement(state: RemoteState, action: Placement, context?: RemoteReductionContext): Reuse | undefined {
  if (context?.replay && context.twinPlacementGuard === 1) return legacyTwinPlacement(state, action, context);
  if (context?.replay && context.twinPlacementGuard === 2) return versionTwoTwinPlacement(state, action, context);
  // A face-down return has no identity to match. Preserve the named card
  // that the camera just lifted from this exact slot; old replays keep v3.
  if ((!context?.replay || (context.twinPlacementGuard ?? 0) >= 4) && action.source === "auto" && remoteFieldZone(action.zone) &&
      !action.fromRef && !action.anotherCopy && !action.card.faceUp && !action.card.cardId && !action.card.passcode && !action.card.name) {
    const returned = state.seats[action.seat].twin.filter(t => recentFieldDeparture(t, action.at ?? state.updatedAt) &&
      t.departedFrom?.zone === action.zone && remotePhysicalSlot(action.zone, t.departedFrom.slot) === remotePhysicalSlot(action.zone, action.card.slot))
      .sort((a,b) => b.departedFrom!.at! - a.departedFrom!.at!)[0];
    if (returned) return {ref:returned.ref,card:returned};
  }
  const matches = state.seats[action.seat].twin.filter(t => sameTwinIdentity(state, action.seat, action.card, t, context));
  if (action.fromRef) {
    const selected = matches.find(t => t.ref === action.fromRef);
    remoteAssert(selected, "The chosen card origin is no longer available", 409);
    return { ref: selected.ref, card: selected };
  }
  const hand = (!context?.replay || context.handKnowledge === 1) ? matches.find(t => t.zone === "hand" && (action.source !== "auto" || !t.departedFrom)) : undefined;
  const handDestination = remoteFieldZone(action.zone) || pileZone(action.zone);
  if (action.anotherCopy) return hand && handDestination ? {ref:hand.ref,card:hand} : undefined;
  const at = action.at ?? state.updatedAt, proof = action.copyProof;
  const exact = matches.find(t => t.ref === action.card.ref);
  if (exact && exact.zone === action.zone && remotePhysicalSlot(exact.zone, exact.slot) === remotePhysicalSlot(action.zone, action.card.slot)) {
    if ((!context?.replay || context.pileArrivalGuard !== undefined) && action.source === "auto" && pileZone(action.zone)) return {noop:true};
    return {ref:exact.ref,card:exact};
  }
  const simultaneous = !!proof && proof.simultaneousQuads >= 2 && proof.at <= at && at - proof.at <= 5000;
  // A recent departure wins even while another X remains in GY or banish.
  const recent = matches.filter(t => recentFieldDeparture(t, at) && (t.zone === "hand" || autoLeft(t, at, action))).sort((a,b) => b.departedFrom!.at! - a.departedFrom!.at!)[0] ??
    ((!context?.replay || (context.twinPlacementGuard ?? 0) >= 7) && action.source === "auto" && pileZone(action.zone) && !matches.some(t => t.zone === action.zone) ? matches.filter(t => handLeft(t, at, t.zone === "hand" && (!context?.replay || (context.twinPlacementGuard ?? 0) >= 8) ? REMOTE_NAMED_PILE_READ_MS : REMOTE_UNREAD_PILE_MS)).sort((a,b) => b.departedFrom!.at! - a.departedFrom!.at!)[0] : undefined);
  if ((!context?.replay || context.pileArrivalGuard === 2) && action.source === "auto" && pileZone(action.zone) && matches.some(t => t.zone === action.zone)) {
    if (exact && remoteFieldZone(exact.zone)) return {ref:exact.ref,card:exact};
    if (recent) return {ref:recent.ref,card:recent};
    // Existing pile + field witnesses prove two copies, never a third arrival.
    if (simultaneous && proof!.simultaneousQuads > matches.length) return;
    return {noop:true};
  }
  if (simultaneous && matches.some(t => remoteFieldZone(t.zone))) return (!context?.replay || context.handKnowledge === 1) && hand && handDestination ? {ref:hand.ref,card:hand} : undefined;
  if ((!context?.replay || (context.twinPlacementGuard ?? 0) >= 5) && action.source === "auto" && remoteFieldZone(action.zone) &&
      !matches.some(t => pileZone(t.zone) && !autoLeft(t, at, action))) {
    // A missed field card still owns its identity, even after a long correction.
    // Automatic departures retain that origin; ordinary hand copies do not.
    const owner = matches.find(t => remoteFieldZone(t.zone)) ?? matches.find(t => t.zone === "hand" && t.departedFrom && remoteFieldZone(t.departedFrom.zone)) ?? matches.find(t => autoLeft(t, at, action));
    if (owner) return {ref:owner.ref,card:owner};
  }
  if (exact && remoteFieldZone(exact.zone)) return {ref:exact.ref,card:exact};
  if ((!context?.replay || context.handKnowledge === 1) && action.source !== "auto" && hand && handDestination) return {ref:hand.ref,card:hand};
  const field = exact && remoteFieldZone(exact.zone) ? exact : recent ?? matches.find(t => remoteFieldZone(t.zone));
  if (field) return {ref:field.ref,card:field};
  if ((!context?.replay || context.handKnowledge === 1) && hand && handDestination) return {ref:hand.ref,card:hand};
  // An automatic pile top is an observation, not evidence of another copy.
  // A new physical copy needs a field origin or an explicit copy/fromRef action.
  if ((!context?.replay || context.pileArrivalGuard !== undefined) && action.source === "auto" && pileZone(action.zone) &&
      matches.some(t => t.zone === action.zone)) return {noop:true};
}

/** Version 2 origin prompts are retained only for recorded event replay. */
function versionTwoTwinPlacement(state: RemoteState, action: Placement, context?: RemoteReductionContext): Reuse | undefined {
  const twins = state.seats[action.seat].twin;
  const matches = twins.filter(t => sameTwinIdentity(state, action.seat, action.card, t, context));
  const samePlace = matches.find(t => t.zone === action.zone && remotePhysicalSlot(t.zone, t.slot) === remotePhysicalSlot(action.zone, action.card.slot));
  // A repeated observation in its current slot is never a new origin question.
  const exact = matches.find(t => t.ref === action.card.ref);
  const retireOtherFieldOrigins=(keepRef?:string)=>{
    const pending=[state.twinConfirmation,...(state.twinConfirmationQueue??[])].find(f=>f?.seat===action.seat&&f.cardRef===action.originRequestRef);
    if(!pending)return;
    for(const card of twins)if(card.ref!==keepRef&&remoteFieldZone(card.zone)&&
      pending.options?.some(o=>o.ref===card.ref&&o.label.startsWith("Moved from "))){
      card.departedFrom={zone:card.zone,...(card.slot?{slot:card.slot}:{})};card.zone="hand";delete card.publicIdentity;delete card.slot;
      const instance=state.deckChecks.instances.find(i=>i.seat===action.seat&&i.refs.includes(card.ref));
      if(instance){instance.zone="hand";delete instance.slot;instance.public=false;instance.anchored=false;}
    }
  };
  if (action.fromRef) {
    const selected = matches.find(t => t.ref === action.fromRef);
    remoteAssert(selected, "The chosen card origin is no longer available", 409);
    retireOtherFieldOrigins(selected.ref);
    clearTwinConfirmation(state,action.seat,action.originRequestRef??action.card.ref);
    return { ref: selected.ref, card: selected };
  }
  if (exact && exact === samePlace && !action.anotherCopy) return { ref: exact.ref, card: exact };
  const proof = action.copyProof, at = action.at ?? state.updatedAt;
  const simultaneous = !!proof && proof.simultaneousQuads >= 2 && proof.at <= at && at - proof.at <= 5000;
  if (action.anotherCopy)retireOtherFieldOrigins();
  if (action.anotherCopy || simultaneous && matches.some(t => remoteFieldZone(t.zone))) {
    clearTwinConfirmation(state,action.seat,action.originRequestRef??action.card.ref);
    return;
  }
  const fields = matches.filter(t => remoteFieldZone(t.zone) || t.departedFrom)
    .sort((a, b) => Number(b.ref === action.card.ref) - Number(a.ref === action.card.ref));
  const piles = matches.filter(t => pileZone(t.zone));
  if (piles.length) {
    const options = [
      ...fields.map(t => ({ ref: t.ref, label: `Moved from ${zoneLabel(t.departedFrom ?? t)}` })),
      ...piles.map(t => ({ ref: t.ref, label: t.zone === "graveyard" ? "From GY" : "From banish" })),
      { label: "New copy" },
    ];
    const flag = {
      seat: action.seat, cardRef: action.card.ref, existingRefs: [...fields, ...piles].map(t => t.ref),
      message: `Where did ${action.card.name ?? matches[0]?.name ?? "this card"} come from?`, anotherCopyAllowed: true,
      options, placement: action,
    };
    const previous=state.twinConfirmation;
    if(!previous||previous.seat===action.seat&&previous.cardRef===action.card.ref)state.twinConfirmation=flag;
    else {
      const queue=state.twinConfirmationQueue??=[];
      const index=queue.findIndex(f=>f.seat===action.seat&&f.cardRef===action.card.ref);
      if(index>=0)queue[index]=flag;else queue.push(flag);
    }
    return { pending: true };
  }
  const field = exact ?? samePlace ?? fields[0] ?? matches.find(t => !pileZone(t.zone));
  if (field) return { ref: field.ref, card: field };
  const absent = state.deckChecks.instances.find(i => i.seat === action.seat &&
    sameTwinIdentity(state, action.seat, action.card, { cardId: i.code, name: i.name }, context) &&
    i.refs.length && !twins.some(t => i.refs.includes(t.ref)));
  if (absent) return { ref: absent.refs[0] };
}

/** Event-time version 1 remains exact for previously recorded tables. */
function legacyTwinPlacement(state: RemoteState, action: Extract<RemoteAction, { type: "twin.place" }>, context?: RemoteReductionContext):
  { ref: string; card?: TwinCard } | undefined {
  const twins = state.seats[action.seat].twin;
  const matches = twins.filter(t => sameTwinIdentity(state, action.seat, action.card, t, context));
  const registration = state.deckChecks.registrations[action.seat];
  const registeredCount = registration ? [...registration.deck.main, ...registration.deck.extra, ...(registration.deck.deckMaster ? [registration.deck.deckMaster] : [])]
    .filter(code => sameTwinIdentity(state, action.seat, action.card, { cardId: code }, context)).length : 0;
  const code = action.card.cardId ?? action.card.passcode;
  const limit = code ? context?.facts?.[code]?.limit : undefined;
  const anotherCopyAllowed = !!registration && !registration.validation.issues.length && matches.length < Math.min(registeredCount, limit ?? registeredCount);
  if (action.source !== "auto") {
    if (action.anotherCopy) remoteAssert(anotherCopyAllowed, "The registered decklist does not allow another copy", 409, "TWIN_COPY_NOT_ALLOWED");
    const onField = matches.filter(t => remoteFieldZone(t.zone));
    if (onField.length && !action.anotherCopy) state.twinConfirmation = {
      seat: action.seat, cardRef: action.card.ref, existingRefs: onField.map(t => t.ref), anotherCopyAllowed,
      message: `You already have ${action.card.name ?? (code ? context?.facts?.[code]?.name : undefined) ?? onField[0].name ?? "this card"} on the field — another copy?`,
    };
    return;
  }
  const proof = action.copyProof;
  const at = action.at ?? state.updatedAt;
  if (proof && proof.simultaneousQuads > matches.length && proof.at <= at && at - proof.at <= 5000) return;
  const pile = matches.find(t => !remoteFieldZone(t.zone));
  if (pile) return { ref: pile.ref, card: pile };
  const field = matches.find(t => t.zone === action.zone && remotePhysicalSlot(t.zone, t.slot) === remotePhysicalSlot(action.zone, action.card.slot)) ?? matches[0];
  if (field) return { ref: field.ref, card: field };
  const absent = state.deckChecks.instances.find(i => i.seat === action.seat &&
    sameTwinIdentity(state, action.seat, action.card, { cardId: i.code, name: i.name }, context) &&
    i.refs.length && !twins.some(t => i.refs.includes(t.ref)));
  if (absent) return { ref: absent.refs[0] };
}
