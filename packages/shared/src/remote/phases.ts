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

/** Soundex is used only inside the bounded phase grammar. */
function phaseSound(word: string): string {
  const codes: Record<string, string> = { b: "1", f: "1", p: "1", v: "1", c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2", d: "3", t: "3", l: "4", m: "5", n: "5", r: "6" };
  let last = codes[word[0]] ?? "";
  let result = word[0] ?? "";
  for (const letter of word.slice(1)) {
    const code = codes[letter] ?? "";
    if (code && code !== last) result += code;
    if (letter !== "h" && letter !== "w") last = code;
  }
  return result.padEnd(4, "0").slice(0, 4);
}

/** Token edit distance, including the adjacent transpositions common in transcripts. */
function phaseDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}

function phaseScore(word: string, name: string): number {
  if (word === name) return 0;
  const distance = phaseDistance(word, name);
  if (distance <= 2 && phaseSound(word) === phaseSound(name)) return 0.5;
  return distance <= (name.length >= 7 ? 2 : 1) ? distance : Infinity;
}

/** Full utterances only. Fuzzy tokens never consume card names or sentences. */
export function parsePhaseCommand(raw: string, state: RemotePosition): PhaseCommand | null {
  if (raw.length > 200) return null;
  const words = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^please /, "").replace(/ please$/, "");
  if (/^(?:undo(?: that)?|take (?:that|it) back|cancel that)$/.test(words)) return { kind: "undo" };
  if (/^(?:(?:end|and|in|pass|finish) (?:(?:my|the|your) )?turn|turn end|next turn|pass)$/.test(words)) return { kind: "turn" };

  const text = words.replace(/\b(?:face|faze|fase|phaze|fays)\b/g, "phase")
    .replace(/\bstand (?:by|bye)\b/g, "standby")
    .replace(/\b(?:one|won)\b/g, "1").replace(/\b(?:two|too)\b/g, "2");
  if (text === "next phase") {
    let index = ygoPhases.findIndex(p => p.id === state.phase) + 1;
    if (ygoPhases[index]?.id === "battle" && !ygoBattleAllowed(state)) index++;
    const phase = ygoPhases[index]?.id;
    return phase ? { kind: "phase", phase } : { kind: "turn" };
  }
  if (/^(?:go back (?:a|one|1) phase|(?:previous|last|back|undo) phase)$/.test(text)) {
    const phase = previousYgoPhase(state);
    return phase ? { kind: "phase", phase } : null;
  }
  const back = /^(?:go )?back to (?:the )?(.+)$/.exec(text);
  const directed = /^(?:(?:go|move|moving|switch) to|enter) (?:the )?/.test(text);
  let name = back ? back[1] : text.replace(/^(?:(?:go|move|moving|switch) to|enter) (?:the )?/, "");
  // Preserve explicit "set phase to main one" without permitting bare phase names.
  const set = /^set phase(?: to)? (.+)$/.exec(name);
  if (set) name = /\bphase\b/.test(set[1]) ? set[1] : `${set[1]} phase`;
  else if (name.startsWith("phase ")) name = `${name.slice(6)} phase`;
  name = name.replace(/^first main phase$/, "main phase 1").replace(/^second main phase$/, "main phase 2")
    .replace(/^(\w+) ([12]) phase$/, "$1 phase $2").replace(/^(\w+)(?: phase)? to$/, "$1 phase 2");
  const match = /^(\w+) phase(?: ([12]))?$/.exec(name) ?? /^(main) ([12])$/.exec(name);
  // An explicit direction supplies the missing "phase": "enter battle".
  const token = match?.[1] ?? (directed && /^\w+$/.test(name) ? name : undefined);
  let phase: string | undefined = name === "battle step" ? "battle" : undefined;
  if (token) {
    const aliases: Record<string, string> = { and: "end", in: "end", drop: "draw" };
    const spoken = aliases[token] ?? token;
    const numbered = match?.[2];
    const current = ygoPhases.findIndex(p => p.id === state.phase);
    const preferredMain = back
      ? (state.phase === "end" && battleEnteredThisTurn(state) ? "main2" : "main1")
      : (battleEnteredThisTurn(state) ? "main2" : "main1");
    const candidates = ygoPhases.filter(p => (!back || ygoPhases.indexOf(p) < current) && (p.id !== "battle" || ygoBattleAllowed(state)))
      .filter(p => !numbered || p.id === `main${numbered}`)
      .map(p => ({ id: p.id, score: phaseScore(spoken, p.id.startsWith("main") ? "main" : p.id),
        // Prefer the next available phase among equally close names, then turn history.
        order: !back && ygoPhases.indexOf(p) > current ? ygoPhases.indexOf(p) - current : p.id === preferredMain ? 10 : 20 }))
      .filter(p => Number.isFinite(p.score)).sort((a, b) => a.score - b.score || a.order - b.order);
    phase = candidates[0]?.id;
  }
  if (!phase) return null;
  if (back && ygoPhases.findIndex(p => p.id === phase) >= ygoPhases.findIndex(p => p.id === state.phase)) return null;
  return { kind: "phase", phase };
}
