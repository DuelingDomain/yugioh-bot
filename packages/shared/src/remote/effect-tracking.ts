import { remoteAssert, type RemoteAction } from "./actions.js";
import { remotePublicCard, remotePublicZone, type RemoteReductionContext } from "./deck-checks.js";
import type { RemoteEffectCandidate, RemoteEffectPlan, RemoteEffectSource } from "./effect-filters.js";
import type { RemoteState } from "./types.js";
export type RemoteEffectOrigin = {
  id: string; seat: number; ref: string; destination: "set" | "hand"; source: RemoteEffectSource;
  announceRecommended: boolean; derivedFrom: RemoteEffectPlan["derivedFrom"];
  /** Candidates and the controller's selection bookkeeping remain private, even for a public choice. */
  pool?: RemoteEffectCandidate[]; candidates?: RemoteEffectCandidate[]; eligibleIds?: number[]; chosenCardId?: number;
  minimumCopies?: number; announcedCard?: {cardId:number;name:string}; revealedCardId?: number;
};
export type RemoteEffectContext = { id: string; source: RemoteEffectSource; plan: RemoteEffectPlan; at: number };
export type RemoteEffectTracking = {
  contexts: Record<number, RemoteEffectContext>;
  origins: RemoteEffectOrigin[];
  notes: {id:string;seat:number;originId:string;message:string;dismissed:boolean}[];
};
export const initialEffectTracking = (): RemoteEffectTracking => ({contexts:{},origins:[],notes:[]});
export function availableEffectCandidates(state: RemoteState, pool: RemoteEffectCandidate[], seat: number, minimumCopies = 1): RemoteEffectCandidate[] {
  return pool.flatMap(candidate=>{
    const seen=state.deckChecks.instances.filter(i=>i.seat===seat && i.copyKey===candidate.copyKey && i.public).length;
    const copies=Math.max(0,candidate.copies-seen);
    return copies>=minimumCopies ? [{...candidate,copies}] : [];
  });
}
/** Pure reducer companion. Only server-resolved plans enter via persisted replay context. */
export function applyRemoteEffectTracking(next: RemoteState, before: RemoteState, action: RemoteAction, context: RemoteReductionContext = {}): void {
  const tracking=next.effectTracking ??= initialEffectTracking();
  const publish=new Set<string>();
  if (before.phase!==next.phase || before.turn!==next.turn) tracking.contexts={};
  for(const [seat, active] of Object.entries(tracking.contexts)) if ((action.at ?? next.updatedAt)-active.at>120_000 || next.seats[Number(seat)].eliminated) delete tracking.contexts[Number(seat)];
  const newOrigin=(id:string, seat:number, ref:string, source:RemoteEffectSource, plan:RemoteEffectPlan) => {
    const candidates=availableEffectCandidates(next,plan.pool,seat,plan.minimumCopies);
    const origin: RemoteEffectOrigin={id,seat,ref,source,destination:plan.destination,announceRecommended:plan.announceRecommended,derivedFrom:plan.derivedFrom,
      minimumCopies:plan.minimumCopies,pool:structuredClone(plan.pool),candidates,eligibleIds:candidates.map(c=>c.cardId)};
    tracking.origins.push(origin);
    publish.add(origin.id);
    const twin=next.seats[seat].twin.find(c=>c.ref===ref); if(twin && plan.destination==="set") twin.setBy=source;
    return origin;
  };
  if(action.type==="effect.activated") {
    remoteAssert(context.effect,"Effect source metadata is unavailable");
    delete tracking.contexts[action.actorSeat];
    for(const plan of context.effect.plans) {
      if(plan.destination==="set") {
        // Check multi-copy requirements before costs. A subsequent public banish consumes one of those copies.
        const eligible=availableEffectCandidates(next,plan.pool,action.actorSeat,plan.minimumCopies);
        const prepared=plan.minimumCopies>1 ? {...plan,minimumCopies:1,pool:plan.pool.filter(c=>eligible.some(e=>e.cardId===c.cardId))} : plan;
        tracking.contexts[action.actorSeat]={id:action.idempotencyKey,source:context.effect.source,plan:prepared,at:action.at ?? next.updatedAt};
      }
      else newOrigin(action.idempotencyKey+":hand",action.actorSeat,"search-"+action.idempotencyKey.slice(0,90),context.effect.source,plan);
    }
    const sourceRef=context.effect.source.cardRef;
    const source=sourceRef ? next.seats[action.actorSeat].twin.find(c=>c.ref===sourceRef) : undefined;
    if(source) { source.faceUp=true; source.cardId=context.effect.source.cardId; source.name=context.effect.source.name; }
  }
  const placed=action.type==="twin.place" ? next.seats[action.seat].twin.find(c=>c.ref===action.card.ref) :
    action.type==="twin.move" || (action.type==="twin.flip" && !action.faceUp) ? next.seats[action.seat].twin.find(c=>c.ref===action.cardRef) : undefined;
  if(placed && "seat" in action && !placed.faceUp && ["spell-trap","monster","field","pendulum"].includes(placed.zone)) {
    const active=tracking.contexts[action.seat];
    if(active && !tracking.origins.some(o=>o.seat===action.seat && o.ref===placed.ref && o.destination==="set")) {
      newOrigin(action.idempotencyKey+":set",action.seat,placed.ref,active.source,active.plan); delete tracking.contexts[action.seat];
    }
  }
  if(action.type==="effect.choose" || action.type==="effect.announce") {
    const origin=tracking.origins.find(o=>o.id===action.originId);
    remoteAssert(origin && origin.seat===action.actorSeat,"Only the controller can choose or announce this card",403);
    if(action.type==="effect.choose") {
      remoteAssert(origin.revealedCardId===undefined && !origin.announcedCard,"This card is already public",409);
      const pick=origin.candidates?.find(c=>c.cardId===action.cardId);
      remoteAssert(pick,"Choose an available candidate",409);
      origin.chosenCardId=pick.cardId;
      publish.add(origin.id);
      let twin=next.seats[origin.seat].twin.find(c=>c.ref===origin.ref);
      if(!twin && origin.destination==="hand") {
        remoteAssert(next.seats[origin.seat].twin.length<100,"Field is full",409);
        twin={ref:origin.ref,zone:"hand",faceUp:false,position:"attack"}; next.seats[origin.seat].twin.push(twin);
      }
      remoteAssert(twin,"Card is no longer on the twin",409); twin.cardId=pick.cardId; delete twin.passcode; twin.name=pick.name;
    } else {
      remoteAssert(origin.destination==="hand" && origin.chosenCardId,"Choose the searched card first",409);
      const picked=origin.pool?.find(c=>c.cardId===origin.chosenCardId);
      remoteAssert(picked,"Unknown searched card"); origin.announcedCard={cardId:picked.cardId,name:picked.name};
      const twin=next.seats[origin.seat].twin.find(c=>c.ref===origin.ref);
      if(twin && context.showCardsSetFromDeck!==undefined) twin.publicIdentity=true;
    }
  }
  if(action.type==="effect.context.clear") delete tracking.contexts[action.actorSeat];
  if(action.type==="effect.note.dismiss") {
    const note=tracking.notes.find(n=>n.id===action.noteId); remoteAssert(note,"Unknown effect note",409); note.dismissed=true;
  }
  // Showing an effect-selected card publishes its identity. Public tables retain the physical Set orientation.
  if(action.type==="card.identified" || action.type==="cards.identified") for(const sight of action.type==="card.identified" ? [action] : action.cards) {
    const twin=sight.cardRef ? next.seats[action.seat].twin.find(c=>c.ref===sight.cardRef) : undefined;
    const origin=twin ? tracking.origins.find(o=>o.seat===action.seat && o.ref===twin.ref) : undefined;
    if(twin && origin && !["deck","extra"].includes(twin.zone) && (next.showCardsSetFromDeck!==false || (origin.destination==="set" && twin.zone!=="hand"))) {
      if(next.showCardsSetFromDeck===false) twin.faceUp=true;
      twin.cardId=sight.cardId ?? sight.passcode; delete twin.passcode;
      twin.name=context.facts?.[twin.cardId!]?.name ?? sight.name ?? twin.name;
      publish.add(origin.id);
    }
  }
  for(const origin of tracking.origins) {
    const twin=next.seats[origin.seat].twin.find(c=>c.ref===origin.ref);
    const code=twin?.cardId ?? twin?.passcode;
    if(twin && code && publish.has(origin.id) && next.showCardsSetFromDeck!==false && !["deck","extra"].includes(twin.zone)) {
      twin.publicIdentity=true;
      origin.chosenCardId=code;
      origin.announcedCard={cardId:code,name:context.facts?.[code]?.name ?? twin.name ?? "Card "+code};
    }
    if(twin && code && (context.showCardsSetFromDeck===undefined ? remotePublicZone(twin.zone,twin.faceUp) : remotePublicCard(twin)) && origin.revealedCardId!==code) {
      origin.revealedCardId=code;
      if(!origin.eligibleIds?.includes(code)) {
        const message=`${context.facts?.[code]?.name ?? twin.name ?? "Card "+code} could not be ${origin.destination==="set" ? "Set" : "added to hand"} by ${origin.source.name}`;
        if(!tracking.notes.some(n=>n.originId===origin.id && n.message===message)) tracking.notes.push({id:"note:"+action.idempotencyKey.slice(0,80)+":"+tracking.notes.length,seat:origin.seat,originId:origin.id,message,dismissed:false});
      }
    }
    if(origin.pool) origin.candidates=availableEffectCandidates(next,origin.pool,origin.seat,origin.minimumCopies);
  }
}

/** A camera result may reuse one known physical origin. Unknown/ambiguous identities need an explicit target. */
export function remoteRecognitionRef(state:RemoteState,seat:number,cardId:number,preferredRef?:string):string|undefined {
  const origins=state.effectTracking?.origins.filter(o=>o.seat===seat && o.destination==="set" &&
    state.seats[seat]?.twin.some(c=>c.ref===o.ref && !c.faceUp)) ?? [];
  if(preferredRef && origins.some(o=>o.ref===preferredRef)) return preferredRef;
  if(state.seats[seat]?.twin.some(c=>(c.cardId ?? c.passcode)===cardId && remotePublicZone(c.zone,c.faceUp))) return undefined;
  const matches=origins.filter(o=>o.chosenCardId===cardId);
  return matches.length===1 ? matches[0].ref : undefined;
}

/** A whole-frame read has no single-card target. Repeated identities or refs remain unlinked. */
export function remoteRecognitionRefs(state:RemoteState,seat:number,cardIds:readonly number[]):(string|undefined)[] {
  const counts=new Map<number,number>();
  for(const code of cardIds) counts.set(code,(counts.get(code) ?? 0)+1);
  const used=new Set<string>();
  return cardIds.map(code=>{
    if(counts.get(code)!==1) return undefined;
    const ref=remoteRecognitionRef(state,seat,code);
    if(!ref || used.has(ref)) return undefined;
    used.add(ref); return ref;
  });
}
