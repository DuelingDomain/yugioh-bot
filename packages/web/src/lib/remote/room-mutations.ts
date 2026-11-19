import { applyPatch, type RemoteActionProposal, type RemoteRoom, type RoomPatch } from '@yugidraft/shared/remote';
import { markFieldAction } from './field-timing';
import { adoptManualCorrection, beginManualCorrection, cameraCorrectionBlocked } from './manual-corrections';
import { rememberRecentRead } from './recent-reads';
import { OutageGaveUpError, writeWaiting, retryThroughOutage, SKIPPED } from './outage';
/** A player's own action waits this long for the connection, then gives up and the table is refreshed (a stale click must not land minutes later). */
export const MANUAL_OUTAGE_CAP_MS=20_000;
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
/** Opt in for one ref and cell. Any stale-write retry must revalidate the callback's evidence. */
type CardScope = {seat: number; cardRef: string; cell: {zone: string; slot?: number}};
export type RoomTransaction = <T>(work:(room:RemoteRoom,act:RoomMutation)=>Promise<T>,scope?:CardScope)=>Promise<T>;

export const hasPendingTwinConfirmation = (room: RemoteRoom) =>
  !!(room.state.twinConfirmation || room.state.twinConfirmationQueue?.length);

function scopeKeys({seat,cardRef,cell}: CardScope) {
  const {zone,slot}=cell;
  const location=zone==='extra-monster'?'shared:extra-monster':zone==='pendulum'
    ?`${seat}:spell-trap:${slot===2?5:1}`
    :`${seat}:${zone}:${slot??0}`;
  return [`ref:${seat}:${cardRef}`,`cell:${location}`];
}

/** A room-wide transaction remains a barrier for card-scoped work. Log writes have no board dependency. */
export function createRoomMutationQueue(read:()=>RemoteRoom|undefined,post:RoomMutation,giveUp?:(error:Error)=>void,valid?:()=>boolean) {
  const idle = Promise.resolve();
  let chain: Promise<unknown> = idle, manual: Promise<unknown> = idle;
  let latest: RemoteRoom | undefined;
  const scoped = new Map<string, Promise<unknown>>();
  const current = () => {
    const rendered = read();
    if (rendered && (!latest || rendered.lastSeq >= latest.lastSeq)) latest = rendered;
    return latest;
  };
  const write = async (proposal:RemoteActionProposal, key?:string, prepared?:()=>void, patient=false) => {
    const now = current();
    const rollback = prepared ?? (now ? beginManualCorrection(now, proposal) : undefined);
    try {
      if (valid?.() === false || (now && cameraCorrectionBlocked(now, proposal))) {
        rollback?.();
        return null;
      }
      if (key) markFieldAction(key, 'writeDequeued');
      const result = patient
        ? await retryThroughOutage(() => post(proposal, key), {valid, capMs: MANUAL_OUTAGE_CAP_MS})
        : await post(proposal, key);
      if (result === SKIPPED || !result) {
        rollback?.();
        return null;
      }
      adoptManualCorrection(result, proposal);
      rememberRecentRead(result, proposal);
      if (!latest || result.lastSeq >= latest.lastSeq) latest = result;
      return result;
    } catch (error) {
      rollback?.();
      if (!(error instanceof OutageGaveUpError) || !patient) throw error;
      giveUp?.(new Error('Could not reach the table. Check the connection and try again.'));
      return null;
    }
  };
  const transaction: RoomTransaction = (work, scope) => {
    const keys = scope && scopeKeys(scope);
    const ready = scoped.size
      ? Promise.all([chain, ...(keys ? keys.map(key => scoped.get(key)) : new Set(scoped.values()))])
      : chain;
    const result = ready.then(async () => {
      const room = current();
      if (!room) throw new Error('Table is not loaded');
      let writes: Promise<unknown> = idle;
      // A callback can start more than one write before awaiting either.
      const act: RoomMutation = (proposal, key) => {
        if (key) markFieldAction(key, 'writeQueued');
        const sent = writes.then(() => write(proposal, key));
        writes = sent.catch(() => undefined);
        return sent;
      };
      try { return await work(room, act); }
      finally { await writes; }
    });
    const tail = result.catch(() => undefined);
    if (keys) {
      for (const key of keys) scoped.set(key, tail);
      void tail.then(() => {
        for (const key of keys) if (scoped.get(key) === tail) scoped.delete(key);
      });
    } else chain = tail;
    return result;
  };
  return {
    transaction,
    action: (proposal:RemoteActionProposal, idempotencyKey?:string) => {
      if (writeWaiting()) {
        giveUp?.(new Error('Reconnecting… try again in a moment.'));
        return Promise.resolve(null);
      }
      const room = current();
      const rollback = room && beginManualCorrection(room, proposal);
      const key = idempotencyKey ?? crypto.randomUUID();
      if (idempotencyKey) markFieldAction(key, 'writeQueued');
      const prior = manual;
      const run = () => prior.then(() => write(proposal, key, rollback, true));
      // A log note can clear a pending placement confirmation in the reducer.
      const independent = proposal.type === 'log.note' && room && !hasPendingTwinConfirmation(room);
      const result = independent ? run() : transaction(run);
      manual = result.catch(() => undefined);
      return result;
    },
  };
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
