import type { RemotePosition } from "./types.js";

export const ygoPhases = [
  { id: "draw", name: "Draw" }, { id: "standby", name: "Standby" }, { id: "main1", name: "Main 1" },
  { id: "battle", name: "Battle" }, { id: "main2", name: "Main 2" }, { id: "end", name: "End" },
] as const;

export function ygoBattleAllowed(state: RemotePosition): boolean {
  return state.seatCount === 2 ? state.turn > 1 : state.seats.every(s => s.eliminated || state.startedSeats.includes(s.seat));
}

/** Older snapshots lack turn history; infer it from their current phase. */
export function battleEnteredThisTurn(state: RemotePosition): boolean {
  return state.battleEntered ?? ["battle", "main2", "end"].includes(state.phase);
}

/** Never crosses a turn boundary; opening turns skip the unavailable Battle Phase. */
export function previousYgoPhase(state: RemotePosition): string | null {
  let index = ygoPhases.findIndex(p => p.id === state.phase) - 1;
  if (ygoPhases[index]?.id === "battle" && !ygoBattleAllowed(state)) index--;
  return ygoPhases[index]?.id ?? null;
}

export type PhaseCommand = { kind: "phase"; phase: string } | { kind: "turn" } | { kind: "undo" };

/** Full utterances only. Sound-alikes are deliberately limited to phase vocabulary. */
export function parsePhaseCommand(raw: string, state: RemotePosition): PhaseCommand | null {
  if (raw.length > 200) return null;
  const words = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^please /, "").replace(/ please$/, "");
  if (/^(?:undo(?: that)?|take (?:that|it) back|cancel that)$/.test(words)) return { kind: "undo" };
  if (/^(?:(?:end|pass|finish) (?:(?:my|the|your) )?turn|turn end|next turn)$/.test(words)) return { kind: "turn" };

  // A bounded phonetic lexicon, rather than edit-distance matching arbitrary conversation.
  const text = words.replace(/\b(?:face|faze)\b/g, "phase").replace(/\bmane\b/g, "main")
    .replace(/\band phase\b/g, "end phase").replace(/\bstand by\b/g, "standby")
    .replace(/\bwon\b/g, "one").replace(/\btoo\b/g, "two");
  if (/^(?:go back (?:a|one|1) phase|(?:previous|last|back|undo) phase)$/.test(text)) {
    const phase = previousYgoPhase(state);
    return phase ? { kind: "phase", phase } : null;
  }
  const back = /^(?:go )?back to (?:the )?(.+)$/.exec(text);
  let name = back ? back[1] : text.replace(/^(?:(?:go|move|switch) to|enter) (?:the )?/, "");
  // Preserve explicit "set phase to main one" without permitting bare phase names.
  const set = /^set phase(?: to)? (.+)$/.exec(name);
  if (set) name = /\bphase\b/.test(set[1]) ? set[1] : `${set[1]} phase`;
  else if (name.startsWith("phase ")) name = `${name.slice(6)} phase`;
  let phase: string | undefined;
  if (/^(?:draw|standby|battle|end) phase$/.test(name)) phase = name.split(" ")[0];
  else if (name === "battle step") phase = "battle";
  else if (/^(?:main (?:phase )?(?:one|1)|main (?:one|1) phase|first main phase)$/.test(name)) phase = "main1";
  else if (/^(?:main (?:phase )?(?:two|2|to)|main (?:two|2) phase|second main phase)$/.test(name)) phase = "main2";
  else if (name === "main phase") phase = back
    ? (state.phase === "end" && battleEnteredThisTurn(state) ? "main2" : "main1")
    : (battleEnteredThisTurn(state) ? "main2" : "main1");
  if (!phase) return null;
  if (back && ygoPhases.findIndex(p => p.id === phase) >= ygoPhases.findIndex(p => p.id === state.phase)) return null;
  return { kind: "phase", phase };
}
