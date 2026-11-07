import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
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
