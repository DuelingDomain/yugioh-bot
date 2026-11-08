import { naturalCommand } from "./voice/natural-phrases";
import { parsePhaseCommand, ygoModule, type AttackResolution, type RemoteState, type RemoteActionProposal } from "@yugidraft/shared/remote";

/** What a spoken line means for a Yu-Gi-Oh table. Only a proposal: the UI decides what needs a confirm. */
export type VoiceIntent =
  | { kind: "effect"; proposal: RemoteActionProposal }
  | { kind: "wake" }
  | { kind: "undo" }
  | { kind: "turn" }
  | { kind: "phase"; phase: string }
  | { kind: "lp"; seat: number; delta: number }
  | { kind: "attack"; text: string; resolution: AttackResolution }
  | { kind: "move"; move: MoveIntent }
  | { kind: "pick"; index: number }
  | { kind: "name"; name: string }
  | { kind: "none" };

/** Where a spoken move sends a card. slot is 1 to 5 (EMZ 1 = left, 2 = right); an Extra Monster Zone without a side has no slot. */
export type MoveDest = { zone: "monster" | "spell-trap" | "field" | "extra-monster" | "graveyard" | "banished" | "hand" | "extra"; slot?: number };
/** "Dark Magician to monster zone two", "set in trap zone one", "defense position", "graveyard". No query = the card placed last. */
export type MoveIntent = { query?: string; dest?: MoveDest; position?: "attack" | "defense"; faceUp?: boolean };

export type GrammarContext = {
  state: RemoteState;
  players: { seat: number; displayName: string }[];
  /** The seat that speaks. */
  me: number;
  trayOpen: boolean;
  /** Actual card names from the table and registered decks, most recent first. */
  cardNames?: readonly string[];
  now?: number;
  lookupCard?: (code: number) => { name: string; type?: string } | undefined;
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

function contextCardNames(ctx: GrammarContext): string[] {
  return [...(ctx.cardNames ?? []), ...ctx.state.seats.flatMap(seat => seat.twin.flatMap(card => card.name ? [card.name] : [])),
    ...(ctx.state.identified?.name ? [ctx.state.identified.name] : [])];
}

/** Remove only leading speech fillers; keep card names and the "and"/"end" sound-alike. */
function commandText(raw: string, ctx: GrammarContext): string {
  let text = raw.trim();
  const cards = contextCardNames(ctx).map(norm).filter(Boolean);
  let filler: RegExpExecArray | null;
  while ((filler = /^(um|uh|okay|so|alright|and)\b[\s,]*/i.exec(text))) {
    const words = norm(text);
    if (cards.some(card => words === card || words.startsWith(`${card} `))) break;
    if (filler[1].toLowerCase() === "and" && parsePhaseCommand(text, ctx.state)) break;
    text = text.slice(filler[0].length);
  }
  return text;
}

/** Check sentence scaffolding outside known card names. Card names can contain ordinary words. */
function commandUtterance(raw: string, ctx: GrammarContext): boolean {
  let text = ` ${norm(raw)} `;
  for (const name of contextCardNames(ctx).map(norm).filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.replace(` ${name} `, " card ");
  }
  text = text.trim();
  const count = text.split(" ").length;
  if (!text || count > 24 || /\b(?:um|uh|erm|hmm|like|i ve|we ve|and now|you know|i think|i was|because|and then|every|always|usually|sometimes|often|all the time|my opponent|is|are|was|were|should|would|could|we can|when|whenever|while|if|unless|until|after|before)\b/.test(text)) return false;
  if (/^(?:like |do you |did you |can i |could you |don t |do not |let me |we |you |he |she |they |i (?:placed|have|had|will) )/.test(text)
    || /\b(?:phase|turn|undo(?: that)?) later$/.test(text)) return false;
  if (/^(?:i )?activate (?:(?:this|that) )?card .+/.test(text) && !/^(?:i )?activate card(?: s)? effect$/.test(text)) return false;
  return count <= 12 || /^(?:i )?(?:activate|use|summon|normal summon|special summon|set|tribute|chain|banish|send|move|attach|detach|negate)\b/.test(text);
}

const SLOT = "(1|2|3|4|5|one|won|two|too|three|four|for|five)";
const SLOT_VALUE: Record<string, number> = { "1": 1, one: 1, won: 1, "2": 2, two: 2, too: 2, "3": 3, three: 3, "4": 4, four: 4, for: 4, "5": 5, five: 5 };
const slotOf = (word: string | undefined) => (word ? SLOT_VALUE[word] : undefined);
const MOVE_VERBS = new Set(["put", "place", "move", "send", "summon", "set", "bring", "return", "banish", "play", "flip", "turn", "switch", "change", "back"]);
const MOVE_FILLER = new Set(["to", "in", "into", "on", "onto", "at", "as", "the", "my", "it", "this", "that", "card", "face", "down", "up", "mode", "position", "from"]);

/** Zone words, positions and face words in one line. The words left over name the card. Null when the line is not a move. */
export function parseMove(raw: string): MoveIntent | null {
  let text = ` ${norm(raw)} `;
  if (text.length > 200) return null;
  let dest: MoveDest | undefined; let position: MoveIntent["position"]; let faceUp: boolean | undefined; let viaSet = false;
  const take = (pattern: RegExp, use: (match: RegExpExecArray) => void) => { const match = pattern.exec(text); if (!match) return false; use(match); text = text.replace(pattern, " "); return true; };
  take(/ attack (?:position|mode) /, () => { position = "attack"; });
  take(/ (?:(?:in )?(?:defense|defence) (?:position|mode)|in (?:defense|defence)) /, () => { position = "defense"; });
  take(/ (?:face down|facedown|face-down) /, () => { faceUp = false; });
  take(/ (?:face up|faceup|face-up) /, () => { faceUp = true; });
  const found = take(new RegExp(` (?:extra monster zone|e m z|emz)(?: (left|right|${SLOT}))? `), match => { dest = { zone: "extra-monster", ...(match[1] === "left" ? { slot: 1 } : match[1] === "right" ? { slot: 2 } : slotOf(match[1]) ? { slot: slotOf(match[1]) } : {}) }; })
    || take(new RegExp(` (?:main )?monster zone ${SLOT} `), match => { dest = { zone: "monster", slot: slotOf(match[1]) }; })
    || take(/ m ?([1-5]) /, match => { dest = { zone: "monster", slot: Number(match[1]) }; })
    || take(new RegExp(` (?:spell trap|spell and trap|spell|trap|s t|st) zone ${SLOT} `), match => { dest = { zone: "spell-trap", slot: slotOf(match[1]) }; })
    || take(/ (?:s|st) ?([1-5]) /, match => { dest = { zone: "spell-trap", slot: Number(match[1]) }; })
    || take(/ (?:field zone|field spell zone) /, () => { dest = { zone: "field" }; })
    || take(/ (?:graveyard|grave yard|gy) /, () => { dest = { zone: "graveyard" }; })
    || take(/ (?:banish|banished|banishes) /, () => { dest = { zone: "banished" }; })
    || take(/ (?:(?:back )?(?:to|into) (?:my |the )?hand|return (?:it )?(?:to )?(?:my |the )?hand) /, () => { dest = { zone: "hand" }; })
    || (text === " hand " && take(/ hand /, () => { dest = { zone: "hand" }; }))
    || take(/ (?:to|into|in) (?:my |the )?extra deck /, () => { dest = { zone: "extra" }; });
  // "set" turns a card face down. It only counts with a zone, or alone ("set", "set it"); "set phase to main two" is not a move.
  const setWord = /^ set(?: it| this| that)? $/.test(text);
  if (found && / set /.test(text)) { viaSet = true; faceUp = false; }
  if (setWord) { viaSet = true; faceUp = false; text = " "; }
  if (!found && !position && faceUp === undefined && !viaSet) return null;
  if (!found && viaSet && !setWord) return null;
  const words = text.trim().split(/\s+/).filter(word => word && !MOVE_VERBS.has(word) && !MOVE_FILLER.has(word));
  const query = words.join(" ");
  // A leftover of more than six words is a sentence, not a card name.
  if (words.length > 6) return null;
  return { ...(query ? { query } : {}), ...(dest ? { dest } : {}), ...(position ? { position } : {}), ...(faceUp !== undefined ? { faceUp } : {}) };
}

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
  raw = commandText(raw, ctx);
  let text = norm(raw);
  if (!commandUtterance(raw, ctx)) return { kind: "none" };
  // Common table talk ("pass", "going to battle", "swing at Dark Magician", "I chain") becomes the text the strict parsers know.
  // With the card tray open every line names a card, so it is left alone.
  const cards = contextCardNames(ctx).map(norm).filter(Boolean);
  const natural = ctx.trayOpen ? null : naturalCommand(text, ctx.state, ctx.me, cards.some(card => text === card || text.startsWith(`${card} `)));
  if (natural && "ignore" in natural) return { kind: "none" };
  if (natural) { raw = natural.text; text = norm(raw); }
  if (/^(respond|chain)\b/.test(text)) return { kind: "wake" };
  const phase = parsePhaseCommand(text === "standby" ? "standby phase" : raw, ctx.state);
  if (phase) return phase;
  const activation=ygoModule.parseCommand({text:raw,actorSeat:ctx.me,state:ctx.state,now:ctx.now,lookupCard:ctx.lookupCard});
  if(activation?.type==="effect.activated") return {kind:"effect",proposal:activation};
  if (ctx.trayOpen) {
    const pick = /^(?:number|pick|choose|option|guess)?\s*(one|two|three|four|five|1|2|3|4|5)$/.exec(text)
      ?? /^(?:number|pick|choose|option|guess)\s+(one|two|three|four|five|1|2|3|4|5)\b/.exec(text);
    if (pick) return { kind: "pick", index: spokenNumber(pick[1]) - 1 };
    return { kind: "name", name: raw.trim() };
  }
  // Attack lines are for the attack resolver. "attack position" is a position word, not an attack.
  const attacking = /\battacks\b|\bdirect/.test(text) || /\battack\b(?! (?:position|mode)\b)/.test(text);
  const move = attacking ? null : parseMove(raw);
  if (move) return { kind: "move", move };
  if (/\battacks?\b/.test(text) || /\bdirect(ly)?\b/.test(text)) {
    const direct = /\bdirect attack (on|at|against|to) (.+)$/.exec(text);
    const input = direct
      ? { direct: true, targetPlayer: ctx.players.find(player => norm(player.displayName).includes(direct[2].split(" ")[0]) || direct[2].includes(norm(player.displayName).split(" ")[0]))?.displayName ?? direct[2], players: ctx.players }
      : { text, players: ctx.players };
    const resolution = ygoModule.resolveAttack(ctx.state, input, ctx.me);
    if (resolution.status !== "none") return { kind: "attack", text, resolution };
  }
  const lpText = text.replace(/\b(?:lp|life points)\b/g, " ").replace(/\s+/g, " ").trim();
  const lp = /^(?:(.+?)\s+)?(minus|loses|lose|lost|takes|take|pays|pay|plus|gains|gain|gets|heals|heal)\s+(.+)$/.exec(lpText);
  if (lp) {
    const amount = spokenNumber(lp[3]);
    const seat = lp[1] ? findSeat(lp[1], ctx) : ctx.me;
    if (amount > 0 && seat !== undefined) return { kind: "lp", seat, delta: /^(minus|lose|lost|takes?|pays?)/.test(lp[2]) ? -amount : amount };
  }
  const trailing = /^(.+?)\s+(\d+|[a-z ]+)\s+lp$/.exec(text);
  if (trailing) { const seat = findSeat(trailing[1], ctx); const amount = spokenNumber(trailing[2]); if (seat !== undefined && amount) return { kind: "lp", seat, delta: amount * -1 }; }
  return { kind: "none" };
}

/** Example lines use only the actual players and cards supplied by the table. */
export function trySaying(players: { seat: number; displayName: string }[], me: number, cardNames: readonly string[] = []): string[] {
  const others = players.filter(player => player.seat !== me);
  const first = others[0]?.displayName.split(" ")[0] ?? "me";
  const second = others[1]?.displayName.split(" ")[0] ?? first;
  const cards = [...new Set(cardNames.filter(name => name.trim()))];
  return ["main phase", "battle phase", "go back a phase", `${first} minus five hundred`, `direct attack on ${second}`, "end turn", "undo", "chain",
    "monster zone two", "set in trap zone one", "field zone", ...cards.slice(0, 3).map(name => `${name} to monster zone two`),
    "extra monster zone left", "graveyard", "defense position"];
}

/** Suggestions are labels for explicit user picks, never a fallback execution path. */
export function suggestCommands(raw: string, ctx: GrammarContext): string[] {
  raw = commandText(raw, ctx);
  if (!commandUtterance(raw, ctx) || interpret(raw, ctx).kind !== "none") return [];
  const words = new Set(norm(raw).split(" "));
  const cardNames = contextCardNames(ctx);
  const text = norm(raw);
  // Keep unrecognized effect utterances quiet, including ordinary conversation about a named card.
  if (/\beffect\b/.test(text)) return [];
  if (/^(?:draw|standby|stand|main|mane|battle|bottle|end|and|in)\b/.test(text)
    && !/^[a-z]+(?: (?:by|bye))?(?: (?:phase|face|faze|fase|phas|phaze|fays|[12]|one|two|too|to|won)){0,2}$/.test(text)) return [];
  const commandStart = /^(?:(?:i |my )?(?:activate|effect|use|summon|normal|special|set|tribute|chain|banish|graveyard|gy|link|xyz|synchro|fusion|attach|detach|negate|lp|life|draw|standby|stand|main|mane|battle|bottle|end|pass|go|enter|next|move|send|put|place|undo|phase|monster|spell|trap|field|extra|defense|attack|direct|respond|pay|take|gain|minus|plus))\b/.test(text);
  if (!commandStart && !cardNames.some(name => text.startsWith(norm(name)))) return [];
  const samples = [...new Set(["draw phase", "standby phase", "main phase", "main phase one", "main phase two",
    "battle phase", "end phase", "go back a phase", "end turn", "undo", ...trySaying(ctx.players, ctx.me, cardNames)])];
  return samples.filter(text => interpret(text, ctx).kind !== "none")
    .map((text, index) => ({ text, index, score: norm(text).split(" ").filter(word => words.has(word)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).map(item => item.text);
}
