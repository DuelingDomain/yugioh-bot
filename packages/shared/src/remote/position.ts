import type { RemoteState, RemoteUndoEntry } from './types.js';

/** Positions are shared; only the small, mutable history bookkeeping is copied. */
export function copyRemoteHistory(history: readonly RemoteUndoEntry[]): RemoteUndoEntry[] {
  return history.map(entry => ({...entry, cards:[...entry.cards], blockedBy:entry.blockedBy && [...entry.blockedBy]}));
}
export function cloneRemoteCurrent(state: RemoteState): RemoteState {
  const {undo, undoHistory, ...current} = state;
  return {...structuredClone(current), undo:undo && {...undo},
    ...(undoHistory ? {undoHistory:copyRemoteHistory(undoHistory)} : {})};
}

/** Applied in production too: accidental writes fail before corrupting another Undo. */
export function freezeRemoteValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRemoteValue(child);
    Object.freeze(value);
  }
  return value;
}
