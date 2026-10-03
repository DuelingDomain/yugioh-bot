/** Render captures scene geometry; move planning sets its final clock before any FX starts. */
export type DestroySceneHold = {
  startAt: number;
  /** Wipes hand off to their own landing streaks after all victims have broken. */
  handoffMs: number;
  totalMs: number;
  reschedule: (startAt: number) => void;
};

const scenes = new Map<number, DestroySceneHold>();

export function registerDestroyScene(ids: readonly number[], hold: DestroySceneHold): () => void {
  for (const id of ids) scenes.set(id, hold);
  while (scenes.size > 400) scenes.delete(scenes.keys().next().value!);
  return () => { for (const id of ids) if (scenes.get(id) === hold) scenes.delete(id); };
}

export function holdDestroySceneUntil(id: number, at: number): DestroySceneHold | null {
  const hold = scenes.get(id);
  if (!hold) return null;
  if (at > hold.startAt) {
    hold.startAt = at;
    hold.reschedule(at);
  }
  return hold;
}
