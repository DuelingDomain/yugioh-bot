import type { RemoteAction } from "./actions.js";
import { remoteAssert } from "./actions.js";
import { flagRemoteCopies, observeRemoteCard, remoteLocationsDistinct, remotePhysicalSlot, remotePublicCard, remotePublicZone, type RemoteCardInstance, type RemoteReductionContext } from "./deck-checks.js";
import type { RemoteState } from "./types.js";
import { remoteFieldZone, sameTwinIdentity } from "./twin-placement.js";

/** Pure. All catalog/validation facts are explicit replay inputs. */
export function applyLiveDeckChecks(input: RemoteState, action: RemoteAction, context: RemoteReductionContext = {}): RemoteState {
  const next = structuredClone(input);
  const checks = next.deckChecks;
  const legacy=context.showCardsSetFromDeck===undefined;
  const isPublic=(card:{zone?:string;faceUp?:boolean;publicIdentity?:boolean})=>legacy ? remotePublicZone(card.zone,card.faceUp) : remotePublicCard(card);
  const seen: RemoteCardInstance[] = [];
  const used = new Set<string>();
  const observe = (seat: number, card: { cardId?: number; passcode?: number; cardRef?: string; zone?: string; slot?: number; faceUp?: boolean; publicIdentity?: boolean; observationId?: string; distinct?: boolean; newCopy?: boolean }) => {
    const code = card.cardId ?? card.passcode;
    const fact = code ? context.facts?.[code] : undefined;
    if (!fact) return;
    const observation = observeRemoteCard(checks, { seat, fact, ref: card.cardRef, ...card, legacyVisibility:legacy }, action.idempotencyKey, used);
    Object.assign(checks, observation.checks);
    used.add(observation.instance.id); seen.push(observation.instance);
    if (card.cardRef && isPublic(card)) {
      // Replacing a hidden/same-place alias removes its old tile, so a later move cannot leave a ghost copy.
      const instance = observation.instance;
      next.seats[seat].twin = next.seats[seat].twin.filter(t => {
        if (t.ref === card.cardRef || !instance.refs.includes(t.ref)) return true;
        const duplicate = !isPublic(t) || (t.zone === card.zone && !remoteLocationsDistinct(t, card));
        if (duplicate) instance.refs = instance.refs.filter(ref => ref !== t.ref);
        return !duplicate;
      });
    }
  };
  if (action.type === "card.identified" || action.type === "cards.identified") {
    const sightings = action.type === "card.identified" ? [action] : action.cards;
    for (const card of sightings) {
      const twin = card.cardRef ? next.seats[action.seat].twin.find(t => t.ref === card.cardRef) : undefined;
      // A new physical Set has no catalog instance until its first reveal.
      // Never merge that explicit ref into an older hidden copy's history.
      const code=card.cardId??card.passcode,copyKey=code?context.facts?.[code]?.copyKey:undefined;
      const sameFieldInstance=!!twin&&remoteFieldZone(twin.zone)&&checks.instances.some(i=>i.seat===action.seat&&i.public&&i.copyKey===copyKey&&i.zone===twin.zone&&!remoteLocationsDistinct(i,twin));
      const freshTwin=(!context.replay||(context.twinPlacementGuard??0)>=3)&&!!twin&&!sameFieldInstance&&!checks.instances.some(i=>i.seat===action.seat&&i.refs.includes(twin.ref));
      const distinct=freshTwin||context.showCardsSetFromDeck!==undefined && !!twin && next.effectTracking?.origins.some(o=>o.seat===action.seat && o.ref===twin.ref);
      observe(action.seat, twin ? { ...card, zone: twin.zone, slot: twin.slot, faceUp: twin.faceUp, publicIdentity: twin.publicIdentity, distinct } : card);
      next.identified = { seat: action.seat, ...(card.cardRef ? {cardRef:card.cardRef} : {}), ...(context.privateRecognition ? {private:true} : {}), cardId: card.cardId, passcode: card.passcode, zone: card.zone,
        source: action.source, name: (code ? context.facts?.[code]?.name : undefined) ?? card.name,
        notInDecklist: context.identified?.notInDecklist ?? false, addErrors: context.identified?.addErrors ?? [] };
      // An explicit ref attaches recognition to the same physical twin card.
      if (twin && (legacy ? twin.faceUp : isPublic(twin))) { twin.cardId = card.cardId; twin.passcode = card.passcode; twin.name = next.identified.name ?? twin.name; if(action.source!=='auto')delete twin.bestMatch;else if(card.bestMatch)twin.bestMatch=true; }
    }
  }
  if (action.type === "twin.flip" || action.type === "twin.move") {
    const twin=next.seats[action.seat].twin.find(c=>c.ref===action.cardRef);
    if(twin && isPublic(twin)) observe(action.seat,{...twin,cardRef:twin.ref});
  }
  if(action.type==="effect.activated" && context.effect?.source.cardRef) {
    const twin=next.seats[action.actorSeat].twin.find(c=>c.ref===context.effect!.source.cardRef);
    if(twin) observe(action.actorSeat,{...twin,cardRef:twin.ref});
  }
  if(!legacy && (action.type==="effect.choose" || action.type==="effect.announce")) {
    const origin=next.effectTracking?.origins.find(o=>o.id===action.originId);
    const twin=origin ? next.seats[origin.seat].twin.find(c=>c.ref===origin.ref) : undefined;
    if(origin && twin && isPublic(twin)) observe(origin.seat,{...twin,cardRef:twin.ref,distinct:true});
  }
  if (action.type === "twin.place") {
    const proof = action.copyProof, at = action.at ?? next.updatedAt;
    const currentRule = !context.replay || (context.twinPlacementGuard ?? 0) >= 2;
    const newCopy = (!context.replay || (context.twinPlacementGuard ?? 0) >= 3) ? true : currentRule ? action.anotherCopy === true || !!proof && proof.at <= at && at - proof.at <= 5000
      : context.twinPlacementGuard !== undefined && (action.source === "auto" ? !!proof && proof.at <= at && at - proof.at <= 5000 : action.anotherCopy === true);
    const twin=next.seats[action.seat].twin.find(c=>c.ref===action.card.ref)!;
    observe(action.seat, { ...twin, cardRef: twin.ref, newCopy });
  }
  const movedSeat = action.type === "twin.move" || action.type === "twin.flip" || action.type === "twin.remove" || action.type === "pile.lift" ? action.seat : -1;
  for (const cardRef of action.type === "twin.move" || action.type === "twin.flip" || action.type === "twin.remove" ? [action.cardRef] : action.type === "pile.lift" ? action.cardRefs : []) {
    const instance = checks.instances.find(i => i.seat === movedSeat && i.refs.includes(cardRef));
    if (instance) {
      const twin = next.seats[movedSeat].twin.find(c => c.ref === cardRef);
      if (!twin) { instance.public = false; instance.anchored = false; delete instance.zone; delete instance.slot; }
      else {
        instance.zone = twin.zone; instance.slot = remotePhysicalSlot(twin.zone, twin.slot);
        instance.public = isPublic(twin); instance.anchored = instance.public;
        if (instance.public) seen.push(instance);
      }
    }
  }
  if (action.type === "deck.add") {
    remoteAssert(action.seat === action.actorSeat, "Only the deck owner can edit their decklist", 403);
    remoteAssert(context.registration && context.registration.validation.issues.length === 0, "Deck addition requires successful validation");
    checks.registrations[action.seat] = structuredClone(context.registration);
    if (next.identified?.seat === action.seat && (next.identified.cardId ?? next.identified.passcode) === action.cardId)
      next.identified = { ...next.identified, notInDecklist: false, addErrors: [] };
  }
  if (action.type === "deck.flag.dismiss") {
    const flag = checks.flags.find(f => f.id === action.flagId);
    remoteAssert(flag, "Unknown deck flag", 409);
    flag.dismissed = true; flag.reason = action.reason;
  }
  if (action.type === "twin.merge") {
    remoteAssert(action.seat === action.actorSeat, "Only the field owner can merge instances", 403);
    const twins = next.seats[action.seat].twin;
    const keep = checks.instances.find(i => i.seat === action.seat && (action.keepRef ? i.refs.includes(action.keepRef) : i.id === action.keepInstanceId));
    const remove = checks.instances.find(i => i.seat === action.seat && (action.removeRef ? i.refs.includes(action.removeRef) : i.id === action.removeInstanceId));
    let removedRefs: string[];
    if (action.keepRef && action.removeRef) {
      const kept = twins.find(t => t.ref === action.keepRef), removed = twins.find(t => t.ref === action.removeRef);
      remoteAssert(kept && removed && kept !== removed && sameTwinIdentity(next, action.seat, kept, removed, context), "Choose two twins of the same card", 409);
      removedRefs = [action.removeRef];
      if (remove) remove.refs = remove.refs.filter(ref => ref !== action.removeRef);
      if (remove && remove !== keep && !remove.refs.some(ref => twins.some(t => t.ref === ref)))
        checks.instances = checks.instances.filter(i => i !== remove);
    } else {
      remoteAssert(keep && remove && keep !== remove && keep.copyKey === remove.copyKey, "Choose two instances of the same card", 409);
      removedRefs = remove.refs;
      checks.instances = checks.instances.filter(i => i !== remove);
    }
    next.seats[action.seat].twin = twins.filter(c => !removedRefs.includes(c.ref));
    for (const flag of checks.flags) if (remove && flag.instanceIds.includes(remove.id)) {
      flag.dismissed = true; flag.reason = action.reason;
    }
  }
  // A previously ambiguous hidden ref becomes a proven second copy only when both twins are public.
  for (const instance of [...checks.instances]) {
    const twins = next.seats[instance.seat].twin.filter(t => instance.refs.includes(t.ref) && isPublic(t))
      .sort((a,b) => Number(remotePhysicalSlot(b.zone,b.slot) !== undefined) - Number(remotePhysicalSlot(a.zone,a.slot) !== undefined));
    const positions: typeof twins = [];
    const distinct = twins.filter(t => {
      if (!positions.every(other => remoteLocationsDistinct(other,t))) return false;
      positions.push(t); return true;
    });
    if (!distinct.length) continue;
    const first = distinct.find(t => t.zone === instance.zone && t.slot === instance.slot) ?? distinct[0];
    instance.zone = first.zone; instance.slot = remotePhysicalSlot(first.zone, first.slot); instance.public = true; instance.anchored = true;
    for (const twin of distinct.filter(t => t !== first)) {
      instance.refs = instance.refs.filter(ref => ref !== twin.ref);
      const extra: RemoteCardInstance = { ...structuredClone(instance), id: "instance:" + action.idempotencyKey + ":" + checks.instances.length,
        refs: [twin.ref], zone: twin.zone, slot: remotePhysicalSlot(twin.zone,twin.slot) };
      checks.instances.push(extra); seen.push(extra);
    }
  }
  Object.assign(checks, flagRemoteCopies(checks, seen, action.idempotencyKey, action.type === "cards.identified"));
  // Hand reveals prove copies within their frame, never as stale anchors for the next scan.
  for (const instance of checks.instances) if (!next.seats[instance.seat].twin.some(t => instance.refs.includes(t.ref) && isPublic(t))) {
    instance.anchored = false; instance.public = false;
  }
  return next;
}
