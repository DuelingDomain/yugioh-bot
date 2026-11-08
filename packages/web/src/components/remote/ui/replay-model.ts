import { applyPatch, type RemoteReplay, type RemoteState } from "@yugidraft/shared/remote";

/** The board after step `index` (-1 = before the first event). Steps are applied one by one from the initial board. */
export function boardAt(replay: RemoteReplay, index: number): RemoteState {
  let state = replay.initial;
  for (let i = 0; i <= index && i < replay.steps.length; i++) state = applyPatch(state, replay.steps[i]!.ops) as RemoteState;
  return state;
}

/** The step index where each turn first shows up, for the jump control. Turn 0 is the start of the table. */
export function turnStarts(replay: RemoteReplay): { turn: number; index: number }[] {
  const seen = new Set<number>(), list: { turn: number; index: number }[] = [];
  replay.steps.forEach((step, index) => { if (!seen.has(step.turn)) { seen.add(step.turn); list.push({ turn: step.turn, index }); } });
  return list;
}
