import { cloneRemoteCurrent } from "../position.js";
import { applyRemoteHand, moveRemoteCardToHand, reduceRemoteHandAction } from "../hand.js";
import { rememberRemoteAction, undoRemoteAction } from "../undo.js";
import { ensureRemoteMatch, finishRemoteGame, initialRemoteMatch, reduceRemoteMatch } from "../match.js";
import { remoteActionSchema, remoteAssert, remoteSummonKinds, type RemoteAction, type TwinCard } from "../actions.js";
import type { GameModule, RemoteSeatState, RemoteState } from "../types.js";
import { resolveAttack } from "../attack-resolver.js";
import { parseRemoteCommand } from "../command-parser.js";
import { initialDeckChecks, remotePhysicalSlot, remotePublicCard, type RemoteReductionContext } from "../deck-checks.js";
import { applyLiveDeckChecks } from "../live-deck-checks.js";
import { clearTwinConfirmation, guardTwinPlacement, remoteFieldZone } from "../twin-placement.js";

import { applyRemoteEffectTracking, availableEffectCandidates } from "../effect-tracking.js";
import { battleEnteredThisTurn, ygoBattleAllowed, ygoPhases as phases } from "../phases.js";
export { ygoBattleAllowed } from "../phases.js";

const zones = [
  { id: "monster", name: "Monster", shape: "row" }, { id: "spell-trap", name: "Spell / Trap", shape: "row" },
  { id: "extra-monster", name: "Extra Monster", shape: "row" }, { id: "field", name: "Field", shape: "single" },
  { id: "graveyard", name: "Graveyard", shape: "pile" }, { id: "banished", name: "Banished", shape: "pile" },
  { id: "hand", name: "Hand (hidden)", shape: "pile" }, { id: "deck", name: "Deck (hidden)", shape: "pile" },
  { id: "extra", name: "Extra Deck", shape: "pile" }, { id: "pendulum", name: "Pendulum", shape: "row" },
  { id: "hand-reveal", name: "Hand reveal", shape: "pile" },
  { id: "material", name: "Xyz material", shape: "pile" },
] as const;
const MONSTER_ZONES = new Set(["monster", "extra-monster"]);
const FIELD_ZONES = new Set(["monster", "extra-monster", "spell-trap", "field", "pendulum"]);
/** A material that the summon may take: on the field, or sent to the hand by the camera moments ago. */
const SUMMON_DEPARTURE_MS = 30_000;
const validMaterial = (card: TwinCard | undefined, top: TwinCard, at: number): card is TwinCard => !!card && card !== top &&
  (MONSTER_ZONES.has(card.zone) || card.zone === "hand" && !!card.departedFrom && MONSTER_ZONES.has(card.departedFrom.zone) &&
    card.departedFrom.at !== undefined && at - card.departedFrom.at <= SUMMON_DEPARTURE_MS);
function takeMaterial(seat: RemoteSeatState, top: TwinCard, ref: string, at: number): TwinCard {
  const card = seat.twin.find(c => c.ref === ref);
  remoteAssert(validMaterial(card, top, at), "A material must be a monster on the field or one that just left it", 409);
  for (const key of ["slot", "departedFrom", "trapZone", "equippedTo", "publicIdentity"] as const) delete card[key];
  if (cardKnown(card)) card.faceUp = true;
  card.position = "attack";
  return card;
}
const cardKnown = (card: TwinCard) => !!(card.cardId || card.passcode || card.name);
/** Xyz: the materials go under the card (an Xyz material brings its own: rank-up). Others: the materials go to the GY. */
function applySummon(seat: RemoteSeatState, top: TwinCard, kind: (typeof remoteSummonKinds)[number], refs: readonly string[], at: number, strict: boolean) {
  if (kind === "xyz") remoteAssert(MONSTER_ZONES.has(top.zone) && top.faceUp, "Xyz materials need a face-up Xyz Monster on the field", 409);
  // A camera placement keeps a good read: a material that changed since the read (moved to the GY …) is skipped, not fatal.
  const usable = refs.filter(ref => validMaterial(seat.twin.find(c => c.ref === ref), top, at));
  if (strict) remoteAssert(usable.length === refs.length, "A material must be a monster on the field or one that just left it", 409);
  for (const ref of usable) {
    const card = takeMaterial(seat, top, ref, at);
    if (kind !== "xyz") {
      delete card.materialOf; seat.twin.splice(seat.twin.indexOf(card), 1); seat.twin.push(card); card.zone = "graveyard"; continue;
    }
    const carried = card.materials ?? [];delete card.materials;
    top.materials = [...(top.materials ?? []).filter(m => m !== card.ref && !carried.includes(m)), ...carried, card.ref];
    for (const m of carried) { const under = seat.twin.find(c => c.ref === m); if (under) under.materialOf = top.ref; }
    card.zone = "material"; card.materialOf = top.ref;
  }
}
/** Trap Monster zones and Equip links last only while the cards are on the field. */
function clearZoneLinks(state: RemoteState, at: number) {
  // Xyz materials stay only under a face-up Xyz Monster on the field; else they go to the GY (bottom first).
  // A camera lift to the hand (the default for a card out of view) holds them for 30 s: the Xyz may come back.
  for (const seat of state.seats) {
    for (const card of seat.twin) if (card.zone !== "material") delete card.materialOf;
    for (const card of [...seat.twin]) if (card.materials) {
      const lifted = card.zone === "hand" && !!card.departedFrom?.auto && MONSTER_ZONES.has(card.departedFrom.zone) && card.departedFrom.at !== undefined && at - card.departedFrom.at <= SUMMON_DEPARTURE_MS;
      const keep = MONSTER_ZONES.has(card.zone) && card.faceUp || lifted;
      const live = card.materials.map(ref => seat.twin.find(c => c.ref === ref)).filter((m): m is TwinCard => !!m && m.zone === "material" && m.materialOf === card.ref);
      if (!keep) for (const m of live) { delete m.materialOf; seat.twin.splice(seat.twin.indexOf(m), 1); seat.twin.push(m); m.zone = "graveyard"; }
      if (keep && live.length) card.materials = live.map(m => m.ref); else delete card.materials;
    }
    for (const card of [...seat.twin]) if (card.zone === "material" && !seat.twin.some(c => c.ref === card.materialOf && c.materials?.includes(card.ref))) {
      delete card.materialOf; seat.twin.splice(seat.twin.indexOf(card), 1); seat.twin.push(card); card.zone = "graveyard";
    }
  }
  for (const seat of state.seats) for (const card of seat.twin) {
    if (card.trapZone !== undefined && !MONSTER_ZONES.has(card.zone)) delete card.trapZone;
    if (card.equippedTo && (!FIELD_ZONES.has(card.zone) || !state.seats[card.equippedTo.seat]?.twin.some(c => c.ref === card.equippedTo!.ref && MONSTER_ZONES.has(c.zone)))) delete card.equippedTo;
  }
}
/** Graveyard and banished piles are ordered by the twin list: oldest first, newest last. Undo restores the list as it was. */
const enteringPile = (from: string, to: string) => from !== to && (to === "graveyard" || to === "banished");
function reduce(state: RemoteState, input: RemoteAction, context?: RemoteReductionContext): RemoteState {
  const parsed = remoteActionSchema.safeParse(input);
  remoteAssert(parsed.success, "Invalid remote action");
  const action = parsed.data;
  let deckAction = action;
  const at = action.at ?? state.updatedAt;
  remoteAssert(at >= state.updatedAt, "Action time precedes state");
  remoteAssert(state.seats[action.actorSeat], "Invalid actor seat");
  if (!state.match) state = ensureRemoteMatch(cloneRemoteCurrent(state));
  if (action.type === "detection.mode") return { ...cloneRemoteCurrent(state), updatedAt: at };
  const matchResult = reduceRemoteMatch(state, action, ygoModule.initialState, context);
  if (matchResult) {
    if (action.type === "match.confirm" && action.accept && state.match.pendingResult?.lpSeat !== undefined) {
      clearZoneLinks(matchResult, at);
      rememberRemoteAction(state, matchResult, action);
      // Admission is undoable by the owner. Its LP declaration cannot be undone
      // underneath it; undoing the admission first restores the pending request.
      const declaration = matchResult.undoHistory?.find(entry => entry.actionId === state.match.pendingResult!.id);
      if (declaration) (declaration.blockedBy ??= []).push(action.idempotencyKey);
    }
    return matchResult;
  }
  if (action.type === "undo") {
    remoteAssert(state.match.phase !== "siding", "Undo is unavailable during siding", 409, "UNDO_UNAVAILABLE");
    if (!context?.replay || context.undoVersion === 1) return undoRemoteAction(state, action);
    // Preserve the semantics of already accepted legacy events, including cross-seat undo.
    const undo = state.undo;
    remoteAssert(undo && undo.actionId === action.targetActionId && at - undo.at <= 5000, "Undo expired or action is no longer the latest reversible action", 409, "UNDO_UNAVAILABLE");
    return { ...structuredClone(undo.before), updatedAt: at, undo: null };
  }
  remoteAssert(!state.ended, "Game has ended", 409);
  remoteAssert(!state.seats[action.actorSeat].eliminated, "Actor seat is eliminated", 403);
  let next: RemoteState = { ...cloneRemoteCurrent(state), updatedAt: at };
  next.deckChecks ??= initialDeckChecks();
  if (!context?.replay || (context.twinPlacementGuard ?? 0) >= 3) { delete next.twinConfirmation; delete next.twinConfirmationQueue; }
  else if (context.twinPlacementGuard !== 2 && action.type !== "log.note") delete next.twinConfirmation;
  const ownTurn = () => remoteAssert(action.actorSeat === state.turnSeat || state.seats[state.turnSeat].eliminated, "Only the turn player can advance", 403);
  const seat = (n: number) => {
    const s = next.seats[n]; remoteAssert(s && !s.eliminated, "Target seat is unavailable", 409); return s;
  };
  const ownField = (n: number) => { remoteAssert(n === action.actorSeat, "Only the field owner can edit their twin", 403); return seat(n); };
  const validZone = (z: string) => remoteAssert(zones.some(item => item.id === z), "Unknown zone");
  const freeSlot = (s: RemoteSeatState, zone: string, slot?: number, exceptRef?: string, materials: readonly string[] = []) => {
    const shape = zones.find(item => item.id === zone)?.shape;
    if (shape === "pile") return;
    const physicalSlot = remotePhysicalSlot(zone, slot);
    remoteAssert(shape !== "row" || slot === undefined || physicalSlot !== undefined, "Invalid physical slot");
    // Legacy row twins without a slot do not identify a physical position.
    if (shape === "row" && physicalSlot === undefined) return;
    if (context?.replay) return;
    // A Trap Monster holds its Spell & Trap Zone; Pendulum Zones 1/2 are S1/S5.
    const heldSlot = zone === "spell-trap" ? physicalSlot : zone === "pendulum" ? (physicalSlot === 1 ? 1 : physicalSlot === 2 ? 5 : undefined) : undefined;
    // An Xyz goes on top of its materials: their slot is free for it.
    remoteAssert(!s.twin.some(card => card.ref !== exceptRef && !materials.includes(card.ref) && (card.zone === zone &&
      (shape === "single" || remotePhysicalSlot(card.zone, card.slot) === physicalSlot) ||
      card.trapZone !== undefined && card.trapZone === heldSlot)),
    "Physical field slot is occupied", 409, "TWIN_SLOT_OCCUPIED");
  };
  const endTurn = () => {
    ownTurn(); remoteAssert(!state.attack, "Resolve the attack first", 409);
    let n = state.turnSeat;
    do { n = (n + 1) % state.seatCount; } while (next.seats[n].eliminated);
    next.turnSeat = n; next.turn++; next.phase = "draw"; next.battleEntered = false;
    if (!next.startedSeats.includes(n)) next.startedSeats.push(n);
  };
  const setPhase = (phase: string) => {
    ownTurn(); remoteAssert(!state.attack, "Resolve the attack first", 409);
    remoteAssert(phases.some(p => p.id === phase), "Unknown phase");
    // Backward phase.set is a same-turn correction with the normal Undo snapshot.
    if (!context?.replay && phases.findIndex(p => p.id === phase) < phases.findIndex(p => p.id === state.phase))
      remoteAssert(action.actorSeat === state.turnSeat, "Only the turn player can go back a phase", 403);
    remoteAssert(phase !== "battle" || ygoBattleAllowed(state), "Battle Phase is unavailable in the opening turns", 409);
    next.battleEntered = battleEnteredThisTurn(state) || phase === "battle";
    next.phase = phase;
  };
  switch (action.type) {
    case "hand.add": case "hand.reveal": case "hand.forget": case "hand.count": case "hand.draw": case "deck.count":
      if(!reduceRemoteHandAction(next, action, context))return state;
      break;
    case "phase.set": setPhase(action.phase); break;
    case "phase.advance": {
      const index = phases.findIndex(p => p.id === state.phase);
      if (index === phases.length - 1) endTurn();
      else {
        let nextIndex = index + 1;
        if (phases[nextIndex].id === "battle" && !ygoBattleAllowed(state)) nextIndex++;
        setPhase(phases[nextIndex].id);
      }
      break;
    }
    case "turn.end": endTurn(); break;
    case "lp.change": {
      const s = seat(action.seat);
      remoteAssert(s.resources.lp + action.delta <= 999999, "LP exceeds supported maximum");
      s.resources.lp = Math.max(0, s.resources.lp + action.delta);
      if (next.match.pendingResult?.lpSeat === s.seat && s.resources.lp > 0) delete next.match.pendingResult;
      if (next.tournament && action.actorSeat !== s.seat && s.resources.lp === 0) {
        remoteAssert(!next.match.pendingResult, "A result declaration is already pending", 409);
        const others = next.seats.filter(other => other.seat !== s.seat && !other.eliminated);
        next.match.pendingResult = { id: action.idempotencyKey, winnerSeat: others.length === 1 ? others[0].seat : null,
          confirmed: [action.actorSeat], lpSeat: s.seat };
      } else s.eliminated = s.resources.lp === 0;
      break;
    }
    case "player.concede": next.seats[action.actorSeat].eliminated = true; break;
    case "attack.declare":
      ownTurn(); seat(action.targetSeat);
      remoteAssert(action.attackerSeat === action.actorSeat && action.targetSeat !== action.actorSeat, "Invalid attacker or target seat");
      remoteAssert(state.phase === "battle" && ygoBattleAllowed(state) && !state.attack, "Attack requires an available Battle Phase and no pending attack", 409);
      remoteAssert(action.direct === true ? !action.targetCardRef : !!action.targetCardRef, "Choose a target card or a direct attack");
      if (action.attackerCardRef) remoteAssert(seat(action.attackerSeat).twin.some(c => c.ref === action.attackerCardRef), "Unknown attacker card");
      if (action.targetCardRef) remoteAssert(seat(action.targetSeat).twin.some(c => c.ref === action.targetCardRef), "Unknown target card");
      next.attack = { id: action.idempotencyKey, attackerSeat: action.attackerSeat, attackerCardRef: action.attackerCardRef, targetSeat: action.targetSeat, targetCardRef: action.targetCardRef, direct: action.direct };
      break;
    case "attack.resolve":
      remoteAssert(state.attack?.id === action.attackId, "Attack is no longer pending", 409);
      remoteAssert(action.actorSeat === state.attack.attackerSeat || action.actorSeat === state.attack.targetSeat, "Only the attacker or target can resolve an attack", 403);
      next.attack = null; break;
    case "card.identified": case "cards.identified": {
      seat(action.seat);
      const sightings = action.type === "card.identified" ? [action] : action.cards;
      for (const card of sightings) {
        remoteAssert(card.cardId || card.passcode, "A cardId or passcode is required");
        if (card.zone) validZone(card.zone);
        if (card.cardRef) remoteAssert(ownField(action.seat).twin.some(c => c.ref === card.cardRef), "Unknown twin card", 409);
      }
      break;
    }
    case "effect.activated": case "effect.choose": case "effect.announce": case "effect.context.clear": case "effect.note.dismiss": break;
    case "deck.add": ownField(action.seat); break;
    case "deck.flag.dismiss": break;
    case "twin.merge": ownField(action.seat); break;
    case "twin.place": {
      const s = ownField(action.seat); validZone(action.zone);
      const reuse = !context?.replay || context.twinPlacementGuard !== undefined ? guardTwinPlacement(next, action, context) : undefined;
      if (reuse && "noop" in reuse) return next;
      if (reuse && "pending" in reuse) return next;
      if (!context?.replay || (context.twinPlacementGuard ?? 0) >= 2) clearTwinConfirmation(next,action.seat,action.originRequestRef??action.card.ref);
      const ref = reuse?.ref ?? action.card.ref;
      remoteAssert((!!reuse?.card || s.twin.length < 100) && (!s.twin.some(c => c.ref === ref) || !!reuse?.card), "Duplicate card ref or field is full", 409);
      freeSlot(s, action.zone, action.card.slot, reuse?.ref, action.summon?.materialRefs);
      const card = { ...reuse?.card, ...action.card, ref, zone: action.zone };
      if (card.zone !== "hand") delete card.departedFrom;
      if(!card.faceUp&&!reuse?.card?.publicIdentity || ["hand","deck","extra"].includes(card.zone)) delete card.publicIdentity;
      if (action.card.slot === undefined) delete card.slot;
      if (reuse?.card && enteringPile(reuse.card.zone, action.zone)) { s.twin.splice(s.twin.indexOf(reuse.card), 1); s.twin.push(card); }
      else if (reuse?.card) s.twin[s.twin.indexOf(reuse.card)] = card;
      else s.twin.push(card);
      if (action.summon) applySummon(s, card, action.summon.kind, action.summon.materialRefs, at, false);
      deckAction = { ...action, card };
      break;
    }
    case "twin.move": case "twin.flip": case "twin.remove": {
      const s = ownField(action.seat); const card = s.twin.find(c => c.ref === action.cardRef);
      remoteAssert(card, "Unknown twin card", 409);
      const fieldFaceState=!context?.replay||context.fieldFaceState===1;
      // A player who turns over the same field card by hand does not erase its publicly shown identity.
      // The camera seeing a card turned face-down makes it a plain Set for the opponent. Earlier face-down flips carry no source, so replays stay the same.
      const cameraSet = action.type === "twin.flip" && !action.faceUp && action.source === "auto";
      const settingInPlace = action.type === "twin.flip" ? !action.faceUp : action.type === "twin.move" &&
        action.faceUp === false && action.zone === card.zone && (action.slot ?? card.slot) === card.slot;
      if (fieldFaceState && settingInPlace && !cameraSet && remoteFieldZone(card.zone) && remotePublicCard(card) && (card.cardId || card.passcode)) card.publicIdentity = true;
      if (action.type === "twin.move") {
        validZone(action.zone);
        const slot = action.slot ?? (card.zone === action.zone ? card.slot : undefined);
        freeSlot(s, action.zone, slot, card.ref);
        if ((!context?.replay || (context.twinPlacementGuard ?? 0) >= 2) && action.zone === "hand" && ["monster", "spell-trap", "extra-monster", "field", "pendulum"].includes(card.zone))
          card.departedFrom = { zone: card.zone, ...(card.slot ? { slot: card.slot } : {}), ...(!context?.replay || (context.twinPlacementGuard ?? 0) >= 3 ? {at} : {}), ...(action.source === "auto" ? { auto: true } : {}) };
        else if (action.zone !== "hand") delete card.departedFrom;
        // A Trap Monster still occupies the Spell & Trap Zone it was activated in.
        if (action.trapMonster && card.zone === "spell-trap" && remotePhysicalSlot(card.zone, card.slot) !== undefined && MONSTER_ZONES.has(action.zone)) card.trapZone = card.slot;
        if (card.zone !== action.zone) delete card.slot;
        if (action.slot !== undefined) card.slot = action.slot;
        // GY and banished keep their order in the twin list (oldest first), so a card that enters goes to the end.
        if (enteringPile(card.zone, action.zone)) { s.twin = s.twin.filter(c => c !== card); s.twin.push(card); }
        card.zone = action.zone;
        if((fieldFaceState?["hand","deck","extra"]:["deck","extra"]).includes(card.zone)) delete card.publicIdentity;
        if (action.position !== undefined) card.position = action.position;
        if (action.faceUp !== undefined) card.faceUp = action.faceUp;
      }
      if (action.type === "twin.flip") {
        card.faceUp = action.faceUp;
        if((!fieldFaceState||cameraSet)&&!action.faceUp)delete card.publicIdentity;
        if(action.position!==undefined)card.position=action.position;
        if(action.faceUp&&action.cardId){remoteAssert(remoteFieldZone(card.zone)||['graveyard','banished','hand-reveal'].includes(card.zone),'Reveal identity requires a public card zone',409);deckAction={type:'card.identified',idempotencyKey:action.idempotencyKey,actorSeat:action.actorSeat,seat:action.seat,at:action.at,cardRef:card.ref,cardId:action.cardId,name:action.name,bestMatch:action.bestMatch,zone:card.zone,slot:card.slot,source:action.source??'click'};}
      }
      if (action.type === "twin.remove") s.twin = s.twin.filter(c => c.ref !== action.cardRef);
      break;
    }
    case "twin.equip": {
      const s = ownField(action.seat); const card = s.twin.find(c => c.ref === action.cardRef);
      remoteAssert(card && FIELD_ZONES.has(card.zone), "Only a card on the field can be an Equip Card", 409);
      if (!action.target) { delete card.equippedTo; break; }
      const target = next.seats[action.target.seat]?.twin.find(c => c.ref === action.target!.ref);
      remoteAssert(target && target !== card && MONSTER_ZONES.has(target.zone), "Equip target must be a monster on the field", 409);
      card.equippedTo = { seat: action.target.seat, ref: target.ref };
      break;
    }
    case "twin.attach": {
      const s = ownField(action.seat); const card = s.twin.find(c => c.ref === action.cardRef);
      remoteAssert(card && MONSTER_ZONES.has(card.zone), "Summon materials need the summoned monster on the field", 409);
      applySummon(s, card, action.kind, action.materialRefs, at, true);
      break;
    }
    case "twin.detach": {
      const s = ownField(action.seat); const card = s.twin.find(c => c.ref === action.cardRef);
      const material = s.twin.find(c => c.ref === action.materialRef);
      remoteAssert(card?.materials?.includes(action.materialRef) && material?.zone === "material" && material.materialOf === card.ref, "That card is not a material of this Xyz Monster", 409);
      if (!card?.materials || !material) break;
      card.materials = card.materials.filter(ref => ref !== material.ref); if (!card.materials.length) delete card.materials;
      delete material.materialOf;
      if (enteringPile("material", action.zone)) { s.twin.splice(s.twin.indexOf(material), 1); s.twin.push(material); }
      material.zone = action.zone;
      if (["hand", "deck", "extra"].includes(action.zone)) { delete material.publicIdentity; if (action.zone !== "hand") material.faceUp = false; }
      break;
    }
    case "pile.order": {
      const s = ownField(action.seat); const pile = s.twin.filter(c => c.zone === action.zone);
      remoteAssert(pile.length === action.cardRefs.length && action.cardRefs.every(ref => pile.some(c => c.ref === ref)), "The order must list every card of the pile", 409);
      const ordered = action.cardRefs.map(ref => pile.find(c => c.ref === ref)!);let i = 0;
      s.twin = s.twin.map(c => c.zone === action.zone ? ordered[i++] : c);
      break;
    }
    case "pile.lift": {
      const s = ownField(action.seat);
      for (const ref of action.cardRefs) {
        const card = s.twin.find(c => c.ref === ref);
        remoteAssert(card && card.zone === action.zone, "A card left that pile before it was picked up", 409);
        moveRemoteCardToHand(card);
        if(!context?.replay||context.handReview===1)card.inspectionFrom=action.zone;
      }
      break;
    }
    case "log.note": return next;
  }
  applyRemoteEffectTracking(next, state, deckAction, context);
  next = applyLiveDeckChecks(next, deckAction, context);
  applyRemoteHand(next, state, action, context);
  for(const origin of next.effectTracking?.origins ?? []) if(origin.pool)
    origin.candidates=availableEffectCandidates(next,origin.pool,origin.seat,origin.minimumCopies,origin.searchSource);
  for (const s of next.seats) if (s.eliminated) s.twin = [];
  if (next.attack && (next.seats[next.attack.attackerSeat].eliminated || next.seats[next.attack.targetSeat].eliminated)) next.attack = null;
  const living = next.seats.filter(s => !s.eliminated);
  if (living.length <= 1) finishRemoteGame(next, living[0]?.seat ?? null, action.type === "player.concede" ? "concede" : "lp", at);
  else if (action.type === "player.concede" || action.type === "lp.change" && next.seats[action.seat].eliminated) delete next.match.pendingResult;
  // After merges and eliminations, so no hold or link points to a card that is gone.
  clearZoneLinks(next, at);
  // Camera placements may retain an existing physical ref. History must point to the card actually placed.
  const remembered = action.type === "twin.place" && deckAction.type === "twin.place"
    ? { ...action, card: { ...action.card, ref: deckAction.card.ref } } : action;
  rememberRemoteAction(state, next, remembered);
  return next;
}
export const ygoModule: GameModule = {
  id: "ygo", name: "Yu-Gi-Oh!", phases, seatsAllowed: [2, 3, 4],
  resources: [{ id: "lp", name: "LP", start: 8000, min: 0, loseAtZero: true }], zones,
  initialState({ seatCount, firstSeat = 0, bestOf, tournament }) {
    remoteAssert([2, 3, 4].includes(seatCount) && Number.isInteger(firstSeat) && firstSeat >= 0 && firstSeat < seatCount, "Invalid seats");
    return { gameId: "ygo", seatCount, ...(tournament ? { tournament: true } : {}), match: initialRemoteMatch(seatCount, bestOf), phase: "draw", turn: 1, turnSeat: firstSeat, battleEntered: false, startedSeats: [firstSeat],
      seats: Array.from({ length: seatCount }, (_, seat) => ({ seat, resources: { lp: 8000 }, eliminated: false, twin: [], knownHand: [] })),
      ended: false, winnerSeat: null, attack: null, identified: null, deckChecks: initialDeckChecks(), showCardsSetFromDeck: true, revealedHand: "until-played", updatedAt: 0, undo: null };
  }, reduce, parseCommand: parseRemoteCommand, resolveAttack,
};
