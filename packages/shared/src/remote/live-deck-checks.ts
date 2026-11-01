import type { RemoteAction } from "./actions.js";
import { remoteAssert } from "./actions.js";
import { flagRemoteCopies, observeRemoteCard, remoteLocationsDistinct, remotePhysicalSlot, remotePublicZone, type RemoteCardInstance, type RemoteReductionContext } from "./deck-checks.js";
import type { RemoteState } from "./types.js";

/** Pure. All catalog/validation facts are explicit replay inputs. */
export function applyLiveDeckChecks(input: RemoteState, action: RemoteAction, context: RemoteReductionContext = {}): RemoteState {
  const next = structuredClone(input);
  const checks = next.deckChecks;
  const seen: RemoteCardInstance[] = [];
  const used = new Set<string>();
  const observe = (seat: number, card: { cardId?: number; passcode?: number; cardRef?: string; zone?: string; slot?: number; faceUp?: boolean; observationId?: string }) => {
    const code = card.cardId ?? card.passcode;
    const fact = code ? context.facts?.[code] : undefined;
    if (!fact) return;
    const observation = observeRemoteCard(checks, { seat, fact, ref: card.cardRef, ...card }, action.idempotencyKey, used);
    Object.assign(checks, observation.checks);
    used.add(observation.instance.id); seen.push(observation.instance);
    if (card.cardRef && remotePublicZone(card.zone, card.faceUp)) {
      // Replacing a hidden/same-place alias removes its old tile, so a later move cannot leave a ghost copy.
      const instance = observation.instance;
      next.seats[seat].twin = next.seats[seat].twin.filter(t => {
        if (t.ref === card.cardRef || !instance.refs.includes(t.ref)) return true;
        const duplicate = !remotePublicZone(t.zone, t.faceUp) || (t.zone === card.zone && !remoteLocationsDistinct(t, card));
        if (duplicate) instance.refs = instance.refs.filter(ref => ref !== t.ref);
        return !duplicate;
      });
    }
  };
  if (action.type === "card.identified" || action.type === "cards.identified") {
    const sightings = action.type === "card.identified" ? [action] : action.cards;
    for (const card of sightings) {
      const twin = card.cardRef ? next.seats[action.seat].twin.find(t => t.ref === card.cardRef) : undefined;
      observe(action.seat, twin ? { ...card, zone: twin.zone, slot: twin.slot, faceUp: twin.faceUp } : card);
      const code = card.cardId ?? card.passcode;
      next.identified = { seat: action.seat, ...(card.cardRef ? {cardRef:card.cardRef} : {}), ...(context.privateRecognition ? {private:true} : {}), cardId: card.cardId, passcode: card.passcode, zone: card.zone,
        source: action.source, name: (code ? context.facts?.[code]?.name : undefined) ?? card.name,
        notInDecklist: context.identified?.notInDecklist ?? false, addErrors: context.identified?.addErrors ?? [] };
      // An explicit ref attaches recognition to the same physical twin card.
      if (twin && twin.faceUp) { twin.cardId = card.cardId; twin.passcode = card.passcode; twin.name = next.identified.name ?? twin.name; }
    }
  }
  if (action.type === "twin.flip" || action.type === "twin.move") {
    const twin=next.seats[action.seat].twin.find(c=>c.ref===action.cardRef);
    if(twin && remotePublicZone(twin.zone,twin.faceUp)) observe(action.seat,{...twin,cardRef:twin.ref});
  }
  if(action.type==="effect.activated" && context.effect?.source.cardRef) {
    const twin=next.seats[action.actorSeat].twin.find(c=>c.ref===context.effect!.source.cardRef);
    if(twin) observe(action.actorSeat,{...twin,cardRef:twin.ref});
  }
  if (action.type === "twin.place") observe(action.seat, { ...action.card, zone: action.zone, cardRef: action.card.ref });
  if (action.type === "twin.move" || action.type === "twin.flip" || action.type === "twin.remove") {
    const instance = checks.instances.find(i => i.seat === action.seat && i.refs.includes(action.cardRef));
    if (instance) {
      const twin = next.seats[action.seat].twin.find(c => c.ref === action.cardRef);
      if (!twin) { instance.public = false; instance.anchored = false; delete instance.zone; delete instance.slot; }
      else {
        instance.zone = twin.zone; instance.slot = remotePhysicalSlot(twin.zone, twin.slot);
        instance.public = remotePublicZone(twin.zone, twin.faceUp); instance.anchored = instance.public;
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
    const keep = checks.instances.find(i => i.id === action.keepInstanceId && i.seat === action.seat);
    const remove = checks.instances.find(i => i.id === action.removeInstanceId && i.seat === action.seat);
    remoteAssert(keep && remove && keep !== remove && keep.copyKey === remove.copyKey, "Choose two instances of the same card", 409);
    next.seats[action.seat].twin = next.seats[action.seat].twin.filter(c => !remove.refs.includes(c.ref));
    checks.instances = checks.instances.filter(i => i !== remove);
    for (const flag of checks.flags) if (flag.instanceIds.includes(remove.id)) {
      flag.dismissed = true; flag.reason = action.reason;
    }
  }
  // A previously ambiguous hidden ref becomes a proven second copy only when both twins are public.
  for (const instance of [...checks.instances]) {
    const twins = next.seats[instance.seat].twin.filter(t => instance.refs.includes(t.ref) && remotePublicZone(t.zone, t.faceUp))
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
  for (const instance of checks.instances) if (!next.seats[instance.seat].twin.some(t => instance.refs.includes(t.ref) && remotePublicZone(t.zone, t.faceUp))) {
    instance.anchored = false; instance.public = false;
  }
  return next;
}
