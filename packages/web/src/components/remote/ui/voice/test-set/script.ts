import { parsePhaseCommand, ygoModule } from "@yugidraft/shared/remote";
import { FIXED_PHRASES } from "../phrases";
import { VOICE_PHASES, heardPhaseOf, judgePhaseWord } from "../phase-plausibility";
import { intentSchema, type Prompt, type TestSet } from "./model";

/** The finite spoken vocabulary, including natural aliases already incorporated by FIXED_PHRASES. */
export function supportedPhrases(): [string, string][] {
  const state = { ...ygoModule.initialState({ seatCount: 2 }), phase: "main1", turn: 2 };
  return [...new Map(FIXED_PHRASES.filter(([, canonical]) => {
    const parsed = parsePhaseCommand(canonical, state);
    return parsed?.kind === "phase" || parsed?.kind === "turn";
  }).map(([spoken, canonical]) => [spoken.toLowerCase(), canonical])).entries()];
}

function label(canonical: string): Pick<Prompt, "expected" | "sim" | "note"> {
  for (const phase of ["main1", ...VOICE_PHASES] as const) {
    const sim = { phase, turn: 2, mine: true };
    const state = { ...ygoModule.initialState({ seatCount: 2 }), phase, turn: 2, turnSeat: 0 };
    const heard = heardPhaseOf(canonical);
    if (heard && !judgePhaseWord(phase, 2, true, heard).accept) continue;
    const parsed = intentSchema.safeParse(parsePhaseCommand(canonical, state));
    if (parsed.success && parsed.data.kind !== "none") return { expected: parsed.data, sim, note: "" };
  }
  return { expected: { kind: "none" }, sim: { phase: "main1", turn: 2, mine: true },
    note: "Vocabulary coverage: no legal forward transition to Draw exists in the current plausibility rule. Expect no action." };
}

const NEAR_MISSES = [
  "I think the battle phase rules changed", "main deck", "next card", "it's a phase thing",
  "your turn is next after this game", "we can talk about the end phase later",
  "I was going to pass the salt", "the main phase artwork looks different",
];

/** Stable seeded shuffle makes a saved script reproducible; audio and order stay frozen on import/resume. */
export function generateScript(seed = 1, repetitions = 2): Prompt[] {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("Repetitions must be 1–10");
  let random = seed >>> 0;
  const prompts: Prompt[] = supportedPhrases().flatMap(([phrase, canonical], index) => {
    const labeled = label(canonical);
    return Array.from({ length: repetitions }, (_, repetition) => ({
      id: `phrase-${index}-${repetition}`, phrase, canonical, ...labeled,
      category: labeled.expected.kind === "none" ? "near-miss" as const : "command" as const,
      targetMs: Math.max(1600, phrase.split(" ").length * 280 + 200),
    }));
  });
  NEAR_MISSES.forEach((phrase, index) => prompts.push({ id: `near-${index}`, phrase, canonical: "", category: "near-miss",
    expected: { kind: "none" }, sim: { phase: "main1", turn: 2, mine: true }, targetMs: 3000, note: "Say the entire sentence naturally, without isolating the command words." }));
  for (let i = prompts.length - 1; i > 0; i--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(random / 4294967296 * (i + 1));
    [prompts[i], prompts[j]] = [prompts[j], prompts[i]];
  }
  prompts.push({ id: "chatter", phrase: "Talk naturally for two minutes about your deck choices, a recent game, sleeves, snacks, or plans for the weekend. Include normal table talk; do not issue commands to the app.",
    canonical: "", category: "chatter", expected: { kind: "none" }, sim: { phase: "main1", turn: 2, mine: true }, targetMs: 120000, note: "Expected: zero actions. Pause and speak as you normally would." });
  return prompts;
}

export function createTestSet(): TestSet {
  return { id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString(), prompts: generateScript(Date.now()), clips: [], skipped: [], cursor: 0 };
}

export function scriptSummary(prompts: Prompt[]) {
  return { commands: prompts.filter(p => p.category === "command").length, nearMisses: prompts.filter(p => p.category === "near-miss").length,
    chatter: prompts.filter(p => p.category === "chatter").length, expectedMs: prompts.reduce((sum, p) => sum + p.targetMs, 0) };
}

