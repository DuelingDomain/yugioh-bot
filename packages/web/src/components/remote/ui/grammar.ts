import { ygoModule, type AttackResolution, type RemoteState } from "@yugidraft/shared/remote";

/** What a spoken line means for a Yu-Gi-Oh table. Only a proposal: the UI decides what needs a confirm. */
export type VoiceIntent =
  | { kind: "wake" }
  | { kind: "undo" }
  | { kind: "turn" }
  | { kind: "phase"; phase: string }
  | { kind: "lp"; seat: number; delta: number }
  | { kind: "attack"; text: string; resolution: AttackResolution }
  | { kind: "pick"; index: number }
  | { kind: "name"; name: string }
  | { kind: "none" };

export type GrammarContext = {
  state: RemoteState;
  players: { seat: number; displayName: string }[];
  /** The seat that speaks. */
  me: number;
  trayOpen: boolean;
};

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "five hundred", "1,500", "fifteen hundred", "a thousand", "two thousand five hundred" -> number. 0 when none. */
export function spokenNumber(input: string): number {
  const text = input.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/-/g, " ");
  const digits = /\d+/.exec(text);
  if (digits) return Number(digits[0]) * (/\bk\b|thousand/.test(text.slice((digits.index ?? 0) + digits[0].length)) ? 1000 : 1);
  let total = 0; let current = 0; let seen = false;
  for (const word of text.split(/\s+/)) {
    if (word === "a" || word === "an" || word === "and") continue;
    if (word in UNITS) { current += UNITS[word]; seen = true; }
    else if (word in TENS) { current += TENS[word]; seen = true; }
    else if (word === "hundred") { current = (current || 1) * 100; seen = true; }
    else if (word === "thousand") { total += (current || 1) * 1000; current = 0; seen = true; }
  }
  return seen ? total + current : 0;
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const PHASES: [RegExp, string][] = [
  [/\b(draw phase)\b/, "draw"], [/\bstand ?by( phase)?\b/, "standby"], [/\bmain (phase )?(one|1|won)\b/, "main1"],
  [/\bbattle( phase)?\b/, "battle"], [/\bmain (phase )?(two|2|to|too)\b/, "main2"], [/\bend phase\b/, "end"],
];

function findSeat(text: string, ctx: GrammarContext): number | undefined {
  const words = norm(text);
  if (/\b(me|my|i|myself)\b/.test(words)) return ctx.me;
  for (const player of ctx.players) {
    const name = norm(player.displayName);
    if (name && (words.includes(name) || words.includes(name.split(" ")[0]))) return player.seat;
  }
  return undefined;
}

/** Turns one finished transcript into a single intent. `tolerant` numbers and names are resolved here. */
export function interpret(raw: string, ctx: GrammarContext): VoiceIntent {
  const text = norm(raw);
  if (!text) return { kind: "none" };
  if (/^(respond|chain)\b/.test(text)) return { kind: "wake" };
  if (/^(undo|take (that|it) back|cancel that)\b/.test(text)) return { kind: "undo" };
  if (ctx.trayOpen) {
    const pick = /^(?:number|pick|choose|option|guess)?\s*(one|two|three|four|five|1|2|3|4|5)$/.exec(text)
      ?? /^(?:number|pick|choose|option|guess)\s+(one|two|three|four|five|1|2|3|4|5)\b/.exec(text);
    if (pick) return { kind: "pick", index: spokenNumber(pick[1]) - 1 };
    return { kind: "name", name: raw.trim() };
  }
  if (/\b(end|pass|finish) (my |the |your )?turn\b|\bnext turn\b/.test(text)) return { kind: "turn" };
  if (/\battacks?\b/.test(text) || /\bdirect(ly)?\b/.test(text)) {
    const direct = /\bdirect attack (on|at|against|to) (.+)$/.exec(text);
    const input = direct
      ? { direct: true, targetPlayer: ctx.players.find(player => norm(player.displayName).includes(direct[2].split(" ")[0]) || direct[2].includes(norm(player.displayName).split(" ")[0]))?.displayName ?? direct[2], players: ctx.players }
      : { text, players: ctx.players };
    const resolution = ygoModule.resolveAttack(ctx.state, input, ctx.me);
    if (resolution.status !== "none") return { kind: "attack", text, resolution };
  }
  const phase = PHASES.find(([pattern]) => pattern.test(text));
  if (phase) return { kind: "phase", phase: phase[1] };
  const lp = /^(?:(.+?)\s+)?(minus|loses|lose|lost|takes|take|pays|pay|plus|gains|gain|gets|heals|heal)\s+(.+)$/.exec(text);
  if (lp) {
    const amount = spokenNumber(lp[3]);
    const seat = lp[1] ? findSeat(lp[1], ctx) : ctx.me;
    if (amount > 0 && seat !== undefined) return { kind: "lp", seat, delta: /^(minus|lose|lost|takes?|pays?)/.test(lp[2]) ? -amount : amount };
  }
  const trailing = /^(.+?)\s+(\d+|[a-z ]+)\s+lp$/.exec(text);
  if (trailing) { const seat = findSeat(trailing[1], ctx); const amount = spokenNumber(trailing[2]); if (seat !== undefined && amount) return { kind: "lp", seat, delta: amount * -1 }; }
  return { kind: "none" };
}

/** Example lines for the "Try saying" chips, built from the real players at the table. */
export function trySaying(players: { seat: number; displayName: string }[], me: number): string[] {
  const others = players.filter(player => player.seat !== me);
  const first = others[0]?.displayName.split(" ")[0] ?? "Imran";
  const second = others[1]?.displayName.split(" ")[0] ?? first;
  return ["battle phase", `${first} minus five hundred`, "Blue-Eyes attacks Dark Magician", `direct attack on ${second}`, "end turn", "undo", "chain"];
}
