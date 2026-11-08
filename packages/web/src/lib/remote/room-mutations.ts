import { applyPatch, type RemoteActionProposal, type RemoteRoom, type RoomPatch } from '@yugidraft/shared/remote';
export type RoomMutation = (proposal:RemoteActionProposal,idempotencyKey?:string)=>Promise<RemoteRoom|null>;
/** The server's last refusal text for a table action, for notices and the Debug view. */
let lastActionError:{message:string;at:number}|undefined;
export function noteRemoteActionError(error:unknown){lastActionError={message:error instanceof Error?error.message:String(error),at:Date.now()};}
export const remoteActionError=()=>lastActionError;
/**
 * `remote:changed` only says that a table moved. The GET it used to start returns the same room that `remote:private` already carried
 * (or that this browser's own action reply carried), so it is needed only when the announced sequence is newer than the newest one held.
 * A lost private message leaves the held sequence behind, so the GET still runs; the slow poll repairs anything else.
 */
export const remoteChangeNeedsFetch=(heldSeq:number,announcedSeq:number)=>announcedSeq>heldSeq;
export type RoomTransaction = <T>(work:(room:RemoteRoom,act:RoomMutation)=>Promise<T>)=>Promise<T>;
/** Manual reads, prompts and watcher changes share one queue and returned state. */
export function createRoomMutationQueue(read:()=>RemoteRoom|undefined,post:RoomMutation) {
  let chain:Promise<unknown>=Promise.resolve(),writes:Promise<unknown>=Promise.resolve(),latest:RemoteRoom|undefined;
  const current=()=>{const rendered=read();if(rendered&&(!latest||rendered.lastSeq>=latest.lastSeq))latest=rendered;return latest;};
  // A transaction can start more than one write before awaiting either. Choose
  // baseSeq in post only after the preceding response has updated the room ref.
  const act:RoomMutation=(proposal,idempotencyKey)=>{
    const result=writes.then(async()=>{const updated=await post(proposal,idempotencyKey);if(updated&&(!latest||updated.lastSeq>=latest.lastSeq))latest=updated;return updated;});
    writes=result.catch(()=>undefined);return result;
  };
  const transaction:RoomTransaction=work=>{
    const result=chain.then(()=>{const room=current();if(!room)throw new Error('Table is not loaded');return work(room,act);});
    chain=result.catch(()=>undefined);return result;
  };
  return {transaction,action:(proposal:RemoteActionProposal,idempotencyKey?:string)=>transaction((_,apply)=>apply(proposal,idempotencyKey))};
}

/** What a browser holding sequence `held` does with a patch: apply it, drop it as old, or repair because it cannot be applied in order. */
export const classifyPatch=(held:number,patch:RoomPatch):'apply'|'stale'|'repair'=>
  patch.seq<=held?'stale':patch.base===held&&patch.seq>patch.base?'apply':'repair';
/** The view after a patch. The old view is untouched; parts the patch does not reach keep their identity. A throw means a bad patch: repair. */
export const applyRoomPatch=(room:RemoteRoom,patch:RoomPatch):RemoteRoom=>({...applyPatch(room,patch.ops),lastSeq:patch.seq});

/**
 * One repair GET at a time, never a storm. Every trigger (gap, bad patch, reconnect, tab shown, a notice with no data) asks here.
 * Asks that come while one is waiting join it. The GET starts after a random delay, and it is skipped when the sequence it was
 * asked for has arrived meanwhile (`wantedSeq` 0 means always run). An ask during the GET adds nothing for a wanted sequence the GET may already cover; only a wanted sequence still missing afterwards starts one more.
 * An ask with `wantedSeq` 0 during the GET (join ack, tab shown) always starts one more afterwards, because the GET may have been read before the socket joined.
 */
export function createRepairScheduler(run:()=>Promise<unknown>,held:()=>number,options:{random?:()=>number;timers?:{set:(fn:()=>void,ms:number)=>unknown;clear:(id:unknown)=>void}}={}){
  const random=options.random??Math.random,timers=options.timers??{set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(id:unknown)=>clearTimeout(id as ReturnType<typeof setTimeout>)};
  let timer:unknown,need:number|undefined,running=false,laterNeed=0,rerun=false;
  const start=()=>{
    timer=undefined;const wanted=need;need=undefined;
    if(wanted!==undefined&&wanted>0&&held()>=wanted)return;
    running=true;
    void run().catch(()=>undefined).finally(()=>{running=false;const later=laterNeed,again=rerun;laterNeed=0;rerun=false;if(again)ask(0,300);else if(later>held())ask(later,300);});
  };
  /** `wantedSeq`: the sequence that makes the GET useless once held. `jitterMs`: the longest random delay. */
  function ask(wantedSeq:number,jitterMs:number){
    if(running){if(wantedSeq===0)rerun=true;else laterNeed=Math.max(laterNeed,wantedSeq);return;}
    need=need===undefined?wantedSeq:need===0||wantedSeq===0?0:Math.max(need,wantedSeq);
    if(timer!==undefined)return;
    timer=timers.set(start,Math.floor(random()*jitterMs));
  }
  return {ask,cancel(){if(timer!==undefined)timers.clear(timer);timer=undefined;need=undefined;laterNeed=0;rerun=false;}};
}
