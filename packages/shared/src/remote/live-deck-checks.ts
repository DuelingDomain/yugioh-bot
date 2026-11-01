import type { RemoteAction } from "./actions.js";
import { remoteAssert } from "./actions.js";
import { flagRemoteCopies, observeRemoteCard, remotePublicZone, type RemoteCardInstance, type RemoteReductionContext } from "./deck-checks.js";
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
  };
  if (action.type === "card.identified" || action.type === "cards.identified") {
    const sightings = action.type === "card.identified" ? [action] : action.cards;
    for (const card of sightings) {
      observe(action.seat, card);
      const code = card.cardId ?? card.passcode;
      next.identified = { seat: action.seat, cardId: card.cardId, passcode: card.passcode, zone: card.zone,
        source: action.source, name: code ? context.facts?.[code]?.name : undefined,
        notInDecklist: context.identified?.notInDecklist ?? false, addErrors: context.identified?.addErrors ?? [] };
      // An explicit ref attaches recognition to the same physical twin card.
      const twin = card.cardRef ? next.seats[action.seat].twin.find(t => t.ref === card.cardRef) : undefined;
      if (twin && twin.faceUp) { twin.cardId = card.cardId; twin.passcode = card.passcode; twin.name = next.identified.name ?? twin.name; }
    }
  }
  if (action.type === "twin.place") observe(action.seat, { ...action.card, zone: action.zone, cardRef: action.card.ref });
  if (action.type === "twin.move" || action.type === "twin.flip" || action.type === "twin.remove") {
    const instance = checks.instances.find(i => i.seat === action.seat && i.refs.includes(action.cardRef));
    if (instance) {
      const twin = next.seats[action.seat].twin.find(c => c.ref === action.cardRef);
      if (!twin) { instance.public = false; instance.anchored = false; delete instance.zone; delete instance.slot; }
      else {
        instance.zone = twin.zone; instance.slot = twin.slot;
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
  Object.assign(checks, flagRemoteCopies(checks, seen, action.idempotencyKey, action.type === "cards.identified"));
  // Hand reveals prove copies within their frame, never as stale anchors for the next scan.
  for (const instance of checks.instances) if (!next.seats[instance.seat].twin.some(t => instance.refs.includes(t.ref) && remotePublicZone(t.zone, t.faceUp))) {
    instance.anchored = false; instance.public = false;
  }
  return next;
}
