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

type Placement = Extract<RemoteAction, { type: "twin.place" }>;
type Reuse = { ref: string; card?: TwinCard } | { pending: true };
const pileZone = (zone: string) => zone === "graveyard" || zone === "banished";
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

/** A current second quad proves a copy. Pile origins always need the owner's choice. */
export function guardTwinPlacement(state: RemoteState, action: Placement, context?: RemoteReductionContext): Reuse | undefined {
  if (context?.replay && context.twinPlacementGuard === 1) return legacyTwinPlacement(state, action, context);
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
      card.departedFrom={zone:card.zone,...(card.slot?{slot:card.slot}:{})};card.zone="hand";delete card.slot;
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
