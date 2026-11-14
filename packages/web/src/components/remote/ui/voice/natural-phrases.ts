/**
 * The common things players say at a Yu-Gi-Oh table, mapped to text the strict parsers already accept (`parsePhaseCommand`,
 * `ygoModule.parseCommand`, the attack resolver, `parseMove`). Nothing here is a new action. Two users:
 *  - phrases.ts (keyword spotter) and speech-matcher.ts (speech model) take `NATURAL_PHRASES` as extra whole-utterance commands;
 *  - grammar.ts `interpret` runs `naturalCommand` on a finished transcript, so the live table hears the same wording.
 * A phrase counts only as a whole utterance. A phrase in `SOFT_PHRASES` is also an ordinary sentence start ("go ahead and ...",
 * "your turn is next"), so it is treated like a bare word: only a short, isolated utterance fires it.
 */
export type Natural = readonly [spoken: string, canonical: string];

const PHASES: readonly Natural[] = [
  ["DRAW PHASE", "draw phase"], ["STANDBY", "standby phase"], ["MAIN", "main phase"], ["MAIN ONE", "main phase one"], ["MAIN TWO", "main phase two"],
  ["BATTLE", "battle phase"], ["END PHASE", "end phase"],
];
const LEADS = ["GO TO", "GOING TO", "MOVING TO", "ENTER"] as const;

/** "go to battle", "moving to main two", "enter end phase", "into battle". */
const MOVES: readonly Natural[] = [
  ...LEADS.flatMap(lead => PHASES.map(([spoken, canonical]) => [`${lead} ${spoken}`, canonical] as const)),
  ["INTO BATTLE", "battle phase"], ["INTO BATTLE PHASE", "battle phase"],
];

export const NATURAL_PHRASES: readonly Natural[] = [
  // Passing the turn
  ["PASS TURN", "end turn"], ["I PASS", "end turn"], ["I'LL PASS", "end turn"], ["END MY TURN", "end turn"], ["TURN END", "end turn"],
  ["THAT'S MY TURN", "end turn"], ["YOUR TURN", "end turn"], ["YOUR GO", "end turn"],
  // Phases
  ["M ONE", "main phase one"], ["M TWO", "main phase two"], ["EM ONE", "main phase one"], ["EM TWO", "main phase two"],
  ...MOVES,
  // Battle
  ["I ATTACK", "attack"], ["SWING", "attack"], ["SWING AT", "attack"], ["I ATTACK WITH", "attack with"], ["ATTACK DIRECTLY", "direct attack"],
  ["GO DIRECT", "direct attack"], ["GOING DIRECT", "direct attack"],
  // Chain and response (the table notes a response; "chain" also wakes an idle microphone)
  ["CHAIN", "chain"], ["I CHAIN", "chain"], ["RESPOND", "chain"], ["I RESPOND", "chain"], ["IN RESPONSE", "chain"],
  // Sets (flip summon needs a card name and a face-down monster, so only the grammar reads it)
  ["SET", "set"], ["SET A CARD", "set"], ["SET IT", "set"], ["I SET", "set"], ["I SET ONE", "set"], ["I SET A CARD", "set"], ["I SET ONE FACE DOWN", "set"], ["I SET A CARD FACE DOWN", "set"],
  // Said at the table but with no action in the app yet. They are listed so the listener hears "no response" as itself and not as "in response".
  ["NO RESPONSE", ""], ["NO CHAIN", ""], ["RESOLVE", ""], ["SUMMON", ""], ["NORMAL SUMMON", ""], ["TRIBUTE SUMMON", ""], ["SPECIAL SUMMON", ""],
];

/** Phrases the listener knows and ignores because the table has no action for them. */
export const NO_ACTION_PHRASES: readonly string[] = NATURAL_PHRASES.filter(([, canonical]) => canonical === "").map(([spoken]) => spoken);

/** Also an ordinary sentence start, so never fired from a long utterance. */
export const SOFT_PHRASES: ReadonlySet<string> = new Set(["YOUR TURN", "YOUR GO", "I PASS", "I'LL PASS", "THAT'S MY TURN", "I SET", "SET IT"]);

/** The turn order of phases (same ids as shared ygoPhases; not imported so the speech workers stay small). */
const ORDER = ["draw", "standby", "main1", "battle", "main2", "end"];
const SOFT_TURN = new Set(["your turn", "your go", "i pass", "i ll pass", "ill pass", "that s my turn"]);
const TURN = new Set(["pass turn", "i pass turn", "turn end"]);

export type NaturalResult = { text: string; flip?: true } | { ignore: string } | null;

/** The phase a spoken name stands for, as parser text ("main phase two"). Null when it is not a phase name. */
function phaseText(name: string): string | null {
  // A bare "the end" is not a phase name ("going to the end of it").
  if (/^(?:the )?end$/.test(name)) return null;
  const words = name.replace(/\bstand (?:by|bye)\b/, "standby").replace(/\b(?:face|faze|fase)\b/, "phase").replace(/ phase$/, "");
  if (/^(?:draw|standby|battle|end)$/.test(words)) return `${words} phase`;
  if (words === "main") return "main phase";
  const main = /^(?:main(?: phase)?|(first|second) main(?: phase)?) ?(one|won|1|two|too|2)?$/.exec(words);
  if (main) {
    const number = main[1] ? (main[1] === "first" ? "1" : "2") : main[2] ? (/^(?:one|won|1)$/.test(main[2]) ? "1" : "2") : "";
    return number ? `main phase ${number === "1" ? "one" : "two"}` : null;
  }
  return null;
}

/**
 * One finished utterance (already folded to words) to parser text. `text` replaces the utterance; `ignore` is a recognized phrase
 * that makes no sense right now (said off turn, or too early to pass); null is "not one of these phrases".
 * `startsWithCard` keeps card names that begin with a command word ("Swing of Memories") out of the rewrites.
 */
export function naturalCommand(text: string, state: { phase: string; turnSeat: number }, me: number, startsWithCard = false): NaturalResult {
  if (TURN.has(text)) return { text: "end turn" };
  if (SOFT_TURN.has(text)) {
    // These are also plain talk. They pass the turn only for the turn player, after the Main Phase has begun.
    return state.turnSeat === me && ORDER.indexOf(state.phase) >= ORDER.indexOf("main1") ? { text: "end turn" } : { ignore: "not the time to pass the turn" };
  }

  const move = /^(?:go(?:ing)? to|mov(?:e|ing) to|head(?:ing)? to|enter(?:ing)?|into) (?:the )?(.+)$/.exec(text);
  const moved = move && phaseText(move[1]);
  if (moved) return { text: moved };
  // "m1" and "m2" are Monster Zone 1 and 2 (the zone parser reads them), so only the spoken words "em one", "m two" are a phase.
  const short = /^e?m (one|two)$/.exec(text);
  if (short) return { text: short[1] === "one" ? "main phase one" : "main phase two" };

  // The attack resolver reads "attack directly"; a bare "direct attack" has no verb for it to split on.
  if (/^(?:(?:go|going) direct(?:ly)?|swings? direct(?:ly)?|direct attack)$/.test(text)) return { text: "attack directly" };
  const swings = /^(.+) swings (?:at|on|into) (.+)$/.exec(text);
  if (swings) return { text: `${swings[1]} attacks ${swings[2]}` };
  if (!startsWithCard) {
    const swing = /^(?:i )?(?:ll )?swings?(?: (at|on|into|with))?( .*)?$/.exec(text);
    if (swing) return { text: `${swing[1] === "with" ? "attack with" : "attack"}${swing[2] ?? ""}` };
  }
  const attacker = /^i (?:ll )?(attack\b.*)$/.exec(text);
  if (attacker) return { text: attacker[1] };

  if (/^(?:i )?(?:ll )?(?:chain|respond)$|^(?:in )?response(?: to (?:that|this|it))?$/.test(text)) return { text: "chain" };

  // "I set two face down" would set only one card, so it is left for the player to do by hand.
  if (/^(?:i )?(?:ll )?set (?:two|2|three|3|four|4|five|5|some|a few) /.test(text)) return { ignore: "sets more than one card" };
  if (/^(?:i )?(?:ll )?set(?: (?:a|one|1|it|this|that|the))?(?: card)?(?: face ?down)?$/.test(text)) return { text: "set" };
  // Without a name "flip summon" would turn the last card touched face up, whatever it is, so a name is required.
  const flip = /^(?:i )?(?:ll )?flip summon(?: (.+))?$/.exec(text);
  if (flip) return flip[1] ? { text: `${flip[1]} face up attack position`, flip: true } : { ignore: "flip summon needs a card name" };
  return null;
}
