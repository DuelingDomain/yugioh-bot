/**
 * A player moved one of their own cards by hand (drag, keyboard, popup or voice). The auto-detect watcher listens, so the
 * camera does not move the card back: it keeps the card's binding and treats the new place as truth until the real card moves.
 */
export type ManualMove = { slug: string; seat: number; ref: string };
type Listener = (move: ManualMove) => void;
const listeners = new Set<Listener>();

export function announceManualMove(move: ManualMove): void { for (const listener of [...listeners]) listener(move); }
export function onManualMove(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
