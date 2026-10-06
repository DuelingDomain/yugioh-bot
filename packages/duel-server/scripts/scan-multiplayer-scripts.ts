/**
 * Static scanner of the official card scripts for multi-player risks (phase 3 "detection", design section 3).
 *
 * At n > 2 a card script sees only 0 (self / own team) and 1 (the opponents) after the Lua perspective fold.
 * Some script patterns stay wrong even after the fold. This scanner finds them in every official script, gives each
 * card a class and reconciles the result with MULTIPLAYER_FORBIDDEN and MULTIPLAYER_CARD_RULES.
 *
 *   U  unchanged: no pattern hit, the script never refers to an opponent
 *   C  the class behaviour of the fold is enough (field class reads, "1" predicates, target ranges)
 *   O  needs an opponent pick or binding (F5); decision-only choices bind at resolution. `ambiguous` O rules also need a product decision
 *   F  fails after the fold: needs a per-card multiplayer script or a ban
 *
 * The class of every pattern is in the one table RULES below. The class of a card is the highest class of its hits.
 * "Flagged" = class F, or class O with an ambiguous rule. A flagged card must be in one of the two lists.
 *
 *   npx tsx scripts/scan-multiplayer-scripts.ts [--scripts <dir>] [--out <dir>]
 *
 * Scripts: <repo>/data/duel-engine-next/card-scripts/official (env DUEL_SCRIPTS_DIR or --scripts overrides).
 * Output:  <repo>/.status/multiplayer-scan.json and multiplayer-scan.md. The scanner only reads the scripts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MULTIPLAYER_CARD_RULES, MULTIPLAYER_FORBIDDEN, type MultiplayerFormat } from "../src/banlists/multiplayer.js";

export type Cls = "U" | "C" | "O" | "F";
export type Tables = "all" | "ffa";

export interface Hit {
  rule: string;
  /** 1-based line in the script. */
  line: number;
  /** The script line, trimmed. */
  text: string;
}

export interface Call {
  /** Function name, for example "Draw" or "FilterSelect". */
  fn: string;
  /** "Duel" for Duel.X(...), "method" for obj:X(...). */
  owner: "Duel" | "method";
  args: string[];
  /** 1-based line of the function name. */
  line: number;
  /** 0-based column of the call start in that line (`Duel.` or `:`). */
  col: number;
}

export interface Unit {
  name: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

export interface Source {
  lines: string[];
  /** Lines without comments (same count and numbering as `lines`). */
  clean: string[];
  cleanText: string;
  calls: Call[];
  units: Unit[];
}

export interface PatternRule {
  id: string;
  cls: Exclude<Cls, "U">;
  /** Needs a product decision (a ban or a card rule) when it is the reason for the class. */
  ambiguous: boolean;
  /** "ffa": the pattern is only wrong in free-for-all. "all": also in Tag. */
  tables: Tables;
  why: string;
  detect: (source: Source) => Hit[];
}

// ---------------------------------------------------------------------------------------------------------------
// Lua text helpers

/** Replace comments (`-- ...` and `--[[ ... ]]`) with spaces. Newlines stay, so line numbers stay. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote || ch === "\n") quote = "";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      const long = /^--\[(=*)\[/.exec(text.slice(i, i + 40));
      if (long) {
        const close = `]${long[1]}]`;
        const end = text.indexOf(close, i + long[0].length);
        const stop = end < 0 ? text.length : end + close.length;
        out += text.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
      } else {
        while (i < text.length && text[i] !== "\n") {
          out += " ";
          i++;
        }
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Read the argument list that starts at the "(" at `open`. Returns null when the parentheses never close. */
function readArgs(text: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += text[++i] ?? "";
      } else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      if (depth > 1) current += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        if (current.trim() !== "" || args.length > 0) args.push(current.trim());
        return args;
      }
      current += ch;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  return null;
}

/** All `Duel.X(...)` and `obj:X(...)` calls of a cleaned text, in source order. */
export function parseCalls(cleanText: string): Call[] {
  const lineStarts = [0];
  for (let i = 0; i < cleanText.length; i++) if (cleanText[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (index: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const calls: Call[] = [];
  const pattern = /\bDuel\.([A-Za-z_]\w*)\s*\(|:([A-Za-z_]\w*)\s*\(/g;
  for (const match of cleanText.matchAll(pattern)) {
    const open = match.index! + match[0].length - 1;
    const args = readArgs(cleanText, open);
    if (!args) continue;
    const owner = match[1] !== undefined ? "Duel" : "method";
    const line = lineAt(match.index!);
    calls.push({ fn: (match[1] ?? match[2])!, owner, args, line, col: match.index! - lineStarts[line - 1]! });
  }
  return calls;
}

/** Top-level function blocks. A block starts at `function` or `local function` in column 0 and ends at `end` in column 0. */
export function parseUnits(lines: string[]): Unit[] {
  const units: Unit[] = [];
  let open: Unit | null = null;
  lines.forEach((text, index) => {
    const no = index + 1;
    const start = /^(?:local\s+)?function\s+([\w.:]+)/.exec(text);
    if (start) {
      if (open) {
        open.end = no - 1;
        units.push(open);
      }
      open = { name: start[1]!, start: no, end: lines.length };
      return;
    }
    if (open && /^end\b/.test(text)) {
      open.end = no;
      units.push(open);
      open = null;
    }
  });
  if (open) units.push(open);
  return units;
}

export function makeSource(text: string): Source {
  const lines = text.split(/\r?\n/);
  const cleanText = stripComments(text.replace(/\r\n/g, "\n"));
  const clean = cleanText.split("\n");
  return { lines, clean, cleanText, calls: parseCalls(cleanText), units: parseUnits(clean) };
}

const hitAt = (source: Source, rule: string, line: number): Hit => ({
  rule,
  line,
  text: (source.lines[line - 1] ?? "").trim().slice(0, 160),
});

const unitOf = (source: Source, line: number): number => source.units.findIndex((u) => line >= u.start && line <= u.end);

// ---------------------------------------------------------------------------------------------------------------
// Player arguments and location masks

export type Who = { kind: "self" | "opp"; base: string } | { kind: "other" };

/** `tp` and `e:GetHandlerPlayer()` are the same player. `1-X` is the opponent of X. Everything else is "other". */
export function whoOf(arg: string | undefined): Who {
  if (arg === undefined) return { kind: "other" };
  const norm = arg.replace(/\s+/g, "").replace(/^e:GetHandlerPlayer\(\)$/, "tp");
  // A player expression: a name (tp, ep, turn_player) or a name with one method call (c:GetControler()).
  const name = String.raw`[A-Za-z_]\w*(?::\w+\(\))?`;
  const opp = new RegExp(`^1-(${name})$`).exec(norm);
  if (opp) return { kind: "opp", base: opp[1] === "e:GetHandlerPlayer()" ? "tp" : opp[1]! };
  if (new RegExp(`^${name}$`).test(norm) && !/^PLAYER_|^LOCATION_|^nil$|^true$|^false$/.test(norm)) return { kind: "self", base: norm };
  return { kind: "other" };
}

export interface LocKind {
  individual: boolean;
  field: boolean;
  zero: boolean;
  unknown: boolean;
  /** The individual locations in the mask: HAND, DECK, EXTRA. */
  types: string[];
}

/** Individual locations (hand, Deck, Extra Deck) are "pick one" for an opponent. Field locations are "all opponents". */
export function locKind(arg: string | undefined): LocKind {
  const norm = (arg ?? "").replace(/\s+/g, "");
  const none = { individual: false, field: false, zero: false, unknown: false, types: [] as string[] };
  if (norm === "") return { ...none, unknown: true };
  if (norm === "0") return { ...none, zero: true };
  const all = /LOCATION_ALL\b/.test(norm);
  const types = ["HAND", "DECK", "EXTRA"].filter((type) => all || new RegExp(`LOCATION_${type}\\b`).test(norm) || (type === "DECK" && /LOCATION_DECK\w+\b/.test(norm)));
  const individual = types.length > 0;
  const field = all || /LOCATION_(MZONE|SZONE|ONFIELD|GRAVE|REMOVED|FZONE|PZONE|MMZONE|EMZONE|STZONE|OVERLAY)\b/.test(norm);
  return { ...none, individual, field, unknown: !individual && !field, types };
}

/** Calls that read cards by (player, self mask, opponent mask): the index of the three arguments. */
const LOC_CALLS: Record<string, [number, number, number]> = {
  GetFieldGroup: [0, 1, 2],
  GetFieldGroupCount: [0, 1, 2],
  GetMatchingGroup: [1, 2, 3],
  GetMatchingGroupCount: [1, 2, 3],
  GetFirstMatchingCard: [1, 2, 3],
  IsExistingMatchingCard: [1, 2, 3],
  SelectMatchingCard: [2, 3, 4],
  IsExistingTarget: [1, 2, 3],
  SelectTarget: [2, 3, 4],
  GetTargetCount: [1, 2, 3],
};

export interface LocRead {
  call: Call;
  line: number;
  /** The call acts on the opponent side of the table in these masks. */
  oppo: LocKind;
  self: LocKind;
  /** The player argument is "1-X": the first mask is the opponent's own side. */
  playerIsOpp: boolean;
}

/** Location reads with a player argument, with the opponent side already resolved. */
export function locReads(source: Source): LocRead[] {
  const reads: LocRead[] = [];
  for (const call of source.calls) {
    const idx = call.owner === "Duel" ? LOC_CALLS[call.fn] : undefined;
    if (!idx) continue;
    const who = whoOf(call.args[idx[0]]);
    if (who.kind === "other") continue;
    const first = locKind(call.args[idx[1]]);
    const second = locKind(call.args[idx[2]]);
    const playerIsOpp = who.kind === "opp";
    reads.push({ call, line: call.line, oppo: playerIsOpp ? first : second, self: playerIsOpp ? second : first, playerIsOpp });
  }
  return reads;
}

/** Individual APIs whose first argument is a player (an action or a query on one duelist). */
const INDIVIDUAL_APIS = new Set([
  "Draw",
  "Damage",
  "Recover",
  "DiscardDeck",
  "DiscardHand",
  "ShuffleHand",
  "ShuffleDeck",
  "ShuffleExtra",
  "SetLP",
  "GetLP",
  "CheckLPCost",
  "IsPlayerCanDraw",
  "IsPlayerCanDiscardDeck",
  "IsPlayerCanDiscardDeckAsCost",
  "GetDecktopGroup",
  "GetDeckbottomGroup",
  "GetExtraTopGroup",
  "ConfirmDecktop",
  "ConfirmExtratop",
  "SortDecktop",
  "SortDeckbottom",
  "GetLocationCount",
  "GetMZoneCount",
  "GetLocationCountFromEx",
  "GetUsableMZoneCount",
  "CheckLocation",
  "RegisterFlagEffect",
  "GetFlagEffect",
  "ResetFlagEffect",
  "SetTargetPlayer",
  "SwapDeckAndGrave",
]);

/** Subset of INDIVIDUAL_APIS where "both players" means one call per player ("each player"). */
const EACH_PLAYER_APIS = new Set([
  "Draw",
  "Damage",
  "Recover",
  "DiscardDeck",
  "DiscardHand",
  "SetLP",
  "IsPlayerCanDraw",
  "IsPlayerCanDiscardDeck",
  "SwapDeckAndGrave",
]);

const SPLIT_APIS = new Set(["Damage", "Recover", "Draw", "DiscardDeck"]);

const GROUP_CHOOSERS = new Set(["Select", "FilterSelect", "RandomSelect", "SelectUnselect", "SelectSubGroup", "SelectWithSumEqual", "SelectWithSumGreater"]);

/** Conservatively include local aliases that may name an opponent, including conditional choices. Inspect only the callback before the call. */
function opponentChooser(source: Source, call: Call): boolean {
  const player = call.args[0]?.trim() ?? "";
  if (whoOf(player).kind === "opp") return true;
  if (!/^[A-Za-z_]\w*$/.test(player)) return false;
  const unit = source.units[unitOf(source, call.line)];
  if (!unit) return false;
  const before = [...source.clean.slice(unit.start - 1, call.line - 1), source.clean[call.line - 1]!.slice(0, call.col)].join("\n");
  const assignments = new RegExp(`(?:^|[\\s;])(?:local\\s+)?${player}\\s*=(?!=)\\s*([^\\n;]+)`, "g");
  for (const [, expression] of before.matchAll(assignments)) {
    // Lua's `condition and tp or 1-tp` may also ask an opponent. Keep either branch as a possible chooser.
    const choices = expression!.split(/\s+(?:and|or)\s+/);
    if (choices.some((choice) => whoOf(choice.trim()).kind === "opp")) return true;
  }
  return false;
}

/** Calls where the first argument is the player who chooses. */
function choosers(source: Source): Call[] {
  return source.calls.filter((call) => {
    const chooser = call.owner === "Duel" ? /^(Select|Announce)/.test(call.fn) : GROUP_CHOOSERS.has(call.fn);
    return chooser && opponentChooser(source, call);
  });
}

const CARD_CHOOSER_WITH_MASKS = new Set(["SelectMatchingCard", "SelectTarget"]);
const CARD_CHOOSER_FIELD = new Set(["SelectReleaseGroup", "SelectReleaseGroupEx", "SelectTribute"]);

/** Choosers (the opponent picks) that pick cards from an opponent field-class group. */
function fieldChoosers(source: Source): Call[] {
  const reads = locReads(source);
  return choosers(source).filter((call) => {
    if (call.owner === "Duel") {
      if (CARD_CHOOSER_WITH_MASKS.has(call.fn)) return reads.some((r) => r.call === call && r.oppo.field);
      return CARD_CHOOSER_FIELD.has(call.fn);
    }
    // A group method: use the reads on the same line, else the field reads of the function.
    const sameLine = reads.filter((r) => r.line === call.line);
    if (sameLine.length > 0) return sameLine.some((r) => r.oppo.field);
    const unit = unitOf(source, call.line);
    return reads.some((r) => unitOf(source, r.line) === unit && r.oppo.field);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The rule table (one row per pattern, class and reason)

const lineRule = (source: Source, id: string, pattern: RegExp): Hit[] => {
  const hits: Hit[] = [];
  source.clean.forEach((text, index) => {
    if (pattern.test(text)) hits.push(hitAt(source, id, index + 1));
  });
  return hits;
};

const callRule = (source: Source, id: string, pick: (call: Call) => boolean): Hit[] =>
  source.calls.filter(pick).map((call) => hitAt(source, id, call.line));

/** True for a plain player expression: tp, ep, rp, p, player, 1-tp ... (not a call result that only contains tp). */
const isPlayerExpr = (arg: string | undefined): boolean => /^(?:1\s*-\s*)?(?:tp|ep|rp|p|player|e:GetHandlerPlayer\(\))$/.test((arg ?? "").trim());

const PLAYER_VAR = String.raw`(?:tp|ep|rp|p|player|e:GetHandlerPlayer\(\))`;

/**
 * A per-player table of the card: `s[tp]`, `s[1-tp]`, `s[rp]`, `s.name_list[tp]` ... The table is `s` or a field path of `s`
 * (a local `t[p]` or `zones[p]` indexes a local list, not state that lives across effects).
 * Literal `s[0]`/`s[1]` (or `s.list[0]`/`s.list[1]`) counts only inside a GlobalCheck script and only when both slots are used.
 */
const TABLE_NAME = String.raw`\bs(?:\.[A-Za-z_]\w*)*`;
const PLAYER_TABLE = new RegExp(String.raw`${TABLE_NAME}\[\s*(?:1\s*-\s*)?${PLAYER_VAR}\s*\]`);
const LITERAL_TABLE = new RegExp(String.raw`(${TABLE_NAME})\[\s*([01])\s*\]`, "g");

/** Lines that index a table of `s` with the literal 0 or 1, when the same table is indexed with both literals. */
function literalTableLines(source: Source): number[] {
  const slots = new Map<string, Set<string>>();
  const found: { line: number; table: string }[] = [];
  source.clean.forEach((text, index) => {
    for (const match of text.matchAll(LITERAL_TABLE)) {
      const set = slots.get(match[1]!) ?? new Set<string>();
      set.add(match[2]!);
      slots.set(match[1]!, set);
      found.push({ line: index + 1, table: match[1]! });
    }
  });
  return found.filter((item) => slots.get(item.table)!.size === 2).map((item) => item.line);
}

const isPlayerSelf = (who: string): boolean => who === "tp" || who === "e:GetHandlerPlayer()";

/** Player-valued flag registered by a global effect: `Duel.RegisterFlagEffect(<not 0>, ...)`. */
function globalPlayerFlag(source: Source): Call[] {
  return source.calls.filter((call) => {
    if (call.owner !== "Duel" || call.fn !== "RegisterFlagEffect") return false;
    const who = call.args[0]?.replace(/\s+/g, "") ?? "";
    return who !== "0" && who !== "1" && who !== "" && !isPlayerSelf(who);
  });
}

const COUNT_FNS = new Set(["GetFieldGroupCount", "GetMatchingGroupCount"]);
const GROUP_FNS = new Set(["GetFieldGroup", "GetMatchingGroup"]);

/**
 * Lines (1-based) where the own field-class count and the opponent field-class count meet in one expression
 * (`a>b`, `#g-count`), or two variables that hold them are compared.
 */
export function fieldCountCompare(source: Source): number[] {
  const found: number[] = [];
  const reads = locReads(source).filter((r) => r.call.owner === "Duel" && (COUNT_FNS.has(r.call.fn) || GROUP_FNS.has(r.call.fn)));
  const sideOf = (r: LocRead): "own" | "opp" | null =>
    r.self.field && r.oppo.zero ? "own" : r.oppo.field && r.self.zero ? "opp" : null;
  source.units.forEach((unit, index) => {
    const vars = new Map<string, "own" | "opp">();
    for (const r of reads.filter((x) => unitOf(source, x.line) === index)) {
      const side = sideOf(r);
      if (!side) continue;
      const decl = /^\s*local\s+(\w+)\s*=/.exec(source.clean[r.line - 1] ?? "");
      const isCount = COUNT_FNS.has(r.call.fn);
      // The variable holds the read only when it is the one read on its line (`local c=(A==0 and B>0) and 2 or 0` holds neither).
      const alone = reads.filter((x) => x.line === r.line).length === 1;
      if (decl && alone && (source.clean[r.line - 1] ?? "").indexOf(r.call.fn) > (source.clean[r.line - 1] ?? "").indexOf("="))
        vars.set(isCount ? decl[1]! : `#${decl[1]!}`, side);
    }
    const patterns = [...vars].map(([name, side]) => ({
      side,
      pattern: name.startsWith("#") ? new RegExp(`#\\s*${name.slice(1)}\\b`) : new RegExp(`\\b${name}\\b`),
    }));
    for (let line = unit.start; line <= unit.end; line++) {
      const text = source.clean[line - 1] ?? "";
      if (/^\s*local\s+\w+\s*=\s*Duel\.Get(?:Field|Matching)Group(?:Count)?\(/.test(text)) continue;
      // One clause = text between "and" / "or": the compare must join both sides inside one clause. A read belongs to
      // the clause that holds its column (two reads of the same function on one line stay in their own clauses).
      const spans: { start: number; end: number }[] = [];
      let from = 0;
      for (const sep of text.matchAll(/\band\b|\bor\b/g)) {
        spans.push({ start: from, end: sep.index! });
        from = sep.index! + sep[0].length;
      }
      spans.push({ start: from, end: text.length });
      for (const { start, end } of spans) {
        const clause = text.slice(start, end);
        const sides = new Set<"own" | "opp">();
        // The name in `local x=` is a declaration, not a use.
        const used = clause.replace(/^\s*local\s+\w+\s*=/, " ");
        for (const { side, pattern } of patterns) if (pattern.test(used)) sides.add(side);
        for (const read of reads) {
          if (read.line !== line || !COUNT_FNS.has(read.call.fn) || read.call.col < start || read.call.col >= end) continue;
          const side = sideOf(read);
          if (side) sides.add(side);
        }
        if (sides.size === 2 && /[<>]=?|[=~]=|[\w)]\s*-\s*[\w#(]/.test(clause.replace(/^\s*local\s+\w+\s*=/, "").replace(/\b1\s*-\s*\w+/g, "X"))) found.push(line);
      }
    }
  });
  return [...new Set(found)];
}

export const RULES: readonly PatternRule[] = [
  // ----- F: per-player Lua state, "each player" loops, win, control swap, LP reset, turn counts and skips
  {
    id: "duel-win",
    cls: "F",
    ambiguous: false,
    tables: "all",
    why: "Duel.Win(player, reason) has no defined result for more than two players (ADR-0002: all 'you win' cards are forbidden).",
    detect: (s) => callRule(s, "duel-win", (c) => c.owner === "Duel" && c.fn === "Win"),
  },
  {
    id: "tag-utility",
    cls: "F",
    ambiguous: false,
    tables: "all",
    why: "Duel.GetPlayersCount, Duel.TagSwap and aux AskEveryone/AskAny assume two teams of one or two (utility.lua 2503-2540).",
    detect: (s) => [
      ...callRule(s, "tag-utility", (c) => c.owner === "Duel" && (c.fn === "GetPlayersCount" || c.fn === "TagSwap")),
      ...lineRule(s, "tag-utility", /\b(?:Duel\.)?(?:AskEveryone|AskAny)\b/),
    ],
  },
  {
    id: "swap-control",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "Duel.SwapControl swaps two sides. A swap between the activator and one named opponent has no defined meaning for a third player.",
    detect: (s) => callRule(s, "swap-control", (c) => c.owner === "Duel" && c.fn === "SwapControl"),
  },
  {
    id: "lp-reset",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "SetLP of one player to a value read from the LP of another player (equalize, halve to match): two LP totals only.",
    detect: (s) => {
      // `local lp2=Duel.GetLP(1-tp)` ... `Duel.SetLP(tp,lp2)`: the local holds the LP of that player (same function).
      const locals = new Map<string, { unit: number; who: Who }[]>();
      const keep = (name: string, line: number, player: string): void => {
        const list = locals.get(name) ?? [];
        list.push({ unit: unitOf(s, line), who: whoOf(player) });
        locals.set(name, list);
      };
      s.clean.forEach((text, index) => {
        const pair = /\blocal\s+(\w+)\s*,\s*(\w+)\s*=\s*Duel\.GetLP\(\s*([^()]+?)\s*\)\s*,\s*Duel\.GetLP\(\s*([^()]+?)\s*\)/.exec(text);
        if (pair) {
          keep(pair[1]!, index + 1, pair[3]!);
          keep(pair[2]!, index + 1, pair[4]!);
          return;
        }
        const single = /\blocal\s+(\w+)\s*=[^\n]*?Duel\.GetLP\(\s*([^()]+?)\s*\)/.exec(text);
        if (single) keep(single[1]!, index + 1, single[2]!);
      });
      return callRule(s, "lp-reset", (c) => {
        if (c.owner !== "Duel" || c.fn !== "SetLP") return false;
        const target = whoOf(c.args[0]);
        if (target.kind === "other") return false;
        const rest = c.args.slice(1).join(",");
        for (const match of rest.matchAll(/GetLP\(\s*([^()]+?)\s*\)/g)) {
          const read = whoOf(match[1]);
          if (read.kind !== "other" && read.kind !== target.kind) return true;
        }
        const unit = unitOf(s, c.line);
        for (const word of new Set(rest.match(/[A-Za-z_]\w*/g) ?? [])) {
          for (const item of locals.get(word) ?? []) if (item.unit === unit && item.who.kind !== "other" && item.who.kind !== target.kind) return true;
        }
        return false;
      });
    },
  },
  {
    id: "each-player-pair",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "The same individual API with the same other arguments (Draw, Damage, DiscardHand, ...) is called for X and for 1-X in one function: 'each player' reaches only you and one opponent.",
    detect: (s) => {
      const hits: Hit[] = [];
      s.units.forEach((_unit, index) => {
        const seen = new Map<string, { kind: "self" | "opp"; line: number }[]>();
        for (const call of s.calls) {
          if (call.owner !== "Duel" || !EACH_PLAYER_APIS.has(call.fn) || unitOf(s, call.line) !== index) continue;
          const who = whoOf(call.args[0]);
          if (who.kind === "other") continue;
          const key = `${call.fn}|${who.base}|${call.args.slice(1).join(",").replace(/\s+/g, "")}`;
          const list = seen.get(key) ?? [];
          list.push({ kind: who.kind, line: call.line });
          seen.set(key, list);
        }
        // One key = same function, same base player, same other arguments. A pair has both a self call and an opp call.
        for (const list of seen.values()) {
          const opp = list.find((item) => item.kind === "opp");
          if (opp && list.some((item) => item.kind === "self")) hits.push(hitAt(s, "each-player-pair", opp.line));
        }
      });
      return hits;
    },
  },
  {
    id: "each-player-split",
    cls: "O",
    ambiguous: true,
    tables: "ffa",
    why: "Damage, Recover, Draw or DiscardDeck is called for you and for 1-you in one function with different amounts (Ring of Destruction, Skull Invitation). Needs a decision on who the 'opponent' is.",
    detect: (s) => {
      const hits: Hit[] = [];
      s.units.forEach((_unit, index) => {
        const calls = s.calls.filter((c) => c.owner === "Duel" && SPLIT_APIS.has(c.fn) && unitOf(s, c.line) === index);
        for (const fn of SPLIT_APIS) {
          const same = calls.filter((c) => c.fn === fn);
          const opp = same.find((c) => whoOf(c.args[0]).kind === "opp");
          if (opp && same.some((c) => whoOf(c.args[0]).kind === "self")) hits.push(hitAt(s, "each-player-split", opp.line));
        }
      });
      return hits;
    },
  },
  {
    id: "player-loop",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "A loop over the two players (`for p=0,1`, `{tp,1-tp}`, `ipairs({0,1})`) never visits players 2 and 3.",
    detect: (s) => [
      ...lineRule(s, "player-loop", /\bfor\s+\w+\s*=\s*0\s*,\s*1\s+do\b/),
      ...lineRule(s, "player-loop", /\bi?pairs\(\s*\{\s*0\s*,\s*1\s*\}\s*\)/),
      ...lineRule(s, "player-loop", /\{\s*0\s*,\s*1\s*,\s*PLAYER_ALL\s*\}/),
      ...lineRule(s, "player-loop", /\{\s*(\w+)\s*,\s*1\s*-\s*\1\s*\}/),
      ...lineRule(s, "player-loop", /\{\s*1\s*-\s*(\w+)\s*,\s*\1\s*\}/),
    ],
  },
  {
    id: "player-table",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "A Lua table indexed by player (s[tp], s[rp], s.name_list[tp], s[0], s[1]): in free-for-all every viewpoint calls itself 0, so the slots mix.",
    detect: (s) => {
      const global = /\bGlobalCheck\b/.test(s.cleanText);
      const literal = global ? literalTableLines(s).map((line) => hitAt(s, "player-table", line)) : [];
      return lineRule(s, "player-table", PLAYER_TABLE).concat(literal);
    },
  },
  {
    id: "global-player-flag",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "A GlobalCheck effect (owner player 0) registers a flag for a player read from the event: other seats fold to '1' and the flags mix.",
    detect: (s) =>
      /\bGlobalCheck\b/.test(s.cleanText) ? globalPlayerFlag(s).map((call) => hitAt(s, "global-player-flag", call.line)) : [],
  },
  {
    id: "label-player",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "A player is stored in a label (SetLabel(tp/ep/rp)) and compared or used as a player argument later, from another viewpoint.",
    detect: (s) => {
      const stores = callRule(s, "label-player", (c) => c.owner === "method" && c.fn === "SetLabel" && isPlayerExpr(c.args[0]));
      if (stores.length === 0) return [];
      // A player on one side of ==/~=: tp, ep, rp, a controler or handler player (c:GetControler(), e:GetHandlerPlayer()).
      const playerSide = String.raw`(?:1\s*-\s*)?(?:${PLAYER_VAR}|[\w:.()]*:(?:GetControler|GetHandlerPlayer|GetOwner|GetTurnPlayer)\(\))`;
      const labelSide = String.raw`(?:1\s*-\s*)?[\w:.()]*GetLabel\(\)`;
      const compareRe = [new RegExp(`${labelSide}\\s*[=~]=\\s*${playerSide}`), new RegExp(`${playerSide}\\s*[=~]=\\s*${labelSide}`)];
      // `local p=e:GetLabel()` (or `1-e:GetLabel()`): the local is a player when it is later compared or passed as a player.
      const locals = new Map<string, Set<number>>();
      s.clean.forEach((text, index) => {
        const decl = /\blocal\s+(\w+)\s*=\s*(?:1\s*-\s*)?[\w:.()]*GetLabel\(\)\s*$/.exec(text);
        if (!decl) return;
        const units = locals.get(decl[1]!) ?? new Set<number>();
        units.add(unitOf(s, index + 1));
        locals.set(decl[1]!, units);
      });
      const isLabelArg = (arg: string, line: number): boolean =>
        /^(?:1\s*-\s*)?[\w:.()]*GetLabel\(\)$/.test(arg) || (locals.get(arg.replace(/^1\s*-\s*/, ""))?.has(unitOf(s, line)) ?? false);
      const compare = s.clean.some((text, index) => {
        if (compareRe.some((re) => re.test(text))) return true;
        for (const [name, units] of locals) {
          if (!units.has(unitOf(s, index + 1))) continue;
          if (new RegExp(String.raw`\b${name}\b\s*[=~]=\s*${playerSide}|${playerSide}\s*[=~]=\s*\b${name}\b`).test(text)) return true;
        }
        return false;
      });
      // A label used as the player argument: the first argument of a Duel call or of a controler/chooser method, or the
      // new controler of Duel.GetControl(card, player).
      const asPlayer = s.calls.some((c) => {
        const first = c.args[0] !== undefined && isLabelArg(c.args[0], c.line) && (c.owner === "Duel" || /Controler|Select|Player/.test(c.fn));
        const control = c.owner === "Duel" && c.fn === "GetControl" && c.args[1] !== undefined && isLabelArg(c.args[1], c.line);
        return first || control;
      });
      return compare || asPlayer ? stores : [];
    },
  },
  {
    id: "reset-oppo-turns",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "An effect that lasts 2 or more 'opponent turns': in free-for-all one round has more than one opponent turn.",
    detect: (s) => {
      const hits: Hit[] = [];
      s.clean.forEach((text, index) => {
        const m = /RESET_OPPO_TURN(?:\s*\|\s*[\w+|]+)*\s*\)?\s*,\s*(\d+)/.exec(text);
        if (m && Number(m[1]) >= 2) hits.push(hitAt(s, "reset-oppo-turns", index + 1));
      });
      // SetReset(... RESET_OPPO_TURN, <count>) with a count that is not a literal: `x and 2 or 1`, or a local (`rct=2`
      // set in the same function). A literal 2 to 9 in the expression, or in an assignment of the local, is a hit.
      for (const call of s.calls) {
        if (call.owner !== "method" || call.fn !== "SetReset" || !/\bRESET_OPPO_TURN\b/.test(call.args[0] ?? "")) continue;
        const count = call.args[1]?.trim();
        if (count === undefined || /^\d+$/.test(count)) continue;
        const wide = (expr: string): boolean => /(?<![\w.])[2-9](?![\w.])/.test(expr);
        let found = wide(count);
        if (!found && /^[A-Za-z_]\w*$/.test(count)) {
          const unit = s.units[unitOf(s, call.line)];
          const from = unit?.start ?? 1;
          const to = unit?.end ?? s.clean.length;
          const assign = new RegExp(String.raw`(?:^|[^\w.])${count}\s*=(?!=)([^\n]*)`);
          for (let line = from; line <= to && !found; line++) {
            const rhs = assign.exec(s.clean[line - 1] ?? "");
            if (rhs && wide(rhs[1]!)) found = true;
          }
        }
        if (found) hits.push(hitAt(s, "reset-oppo-turns", call.line));
      }
      return hits;
    },
  },
  {
    id: "skip-turn",
    cls: "F",
    ambiguous: false,
    tables: "ffa",
    why: "EFFECT_SKIP_TURN: FFA turn order has no single 'opponent's turn' to skip.",
    detect: (s) => lineRule(s, "skip-turn", /\bEFFECT_SKIP_TURN\b/),
  },
  // ----- O (ambiguous): the pick is not clear, or a card rule is needed
  {
    id: "chooser-opp-field",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "The opponent chooses cards from a field-class group (Select*(1-tp) on the opponent field): the bound opponent would choose among the cards of every opponent. Needs a decision: each opponent chooses their own, or one opponent chooses.",
    detect: (s) => fieldChoosers(s).map((call) => hitAt(s, "chooser-opp-field", call.line)),
  },
  {
    id: "both-individual-locs",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "The same individual location (hand, Deck, Extra Deck) of you and of an opponent is read in one function or one mask: with 'pick one opponent' this is you and one opponent. If the card means 'each player', it needs a rule.",
    detect: (s) => {
      const hits: Hit[] = [];
      const reads = locReads(s);
      for (const unit of new Set(reads.map((r) => unitOf(s, r.line)))) {
        const inUnit = reads.filter((r) => unitOf(s, r.line) === unit);
        const sameCall = inUnit.find((r) => r.self.types.some((type) => r.oppo.types.includes(type)));
        if (sameCall) {
          hits.push(hitAt(s, "both-individual-locs", sameCall.line));
          continue;
        }
        const opp = inUnit.find((r) => r.oppo.individual && inUnit.some((o) => o.self.types.some((type) => r.oppo.types.includes(type)) && o.oppo.zero));
        if (opp) hits.push(hitAt(s, "both-individual-locs", opp.line));
      }
      return hits;
    },
  },
  {
    id: "register-effect-opp",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "Duel.RegisterEffect(effect, 1-tp): a delayed or ongoing effect registered for one opponent. R-COMMON-ONGOING says it applies to all opponents.",
    detect: (s) =>
      callRule(s, "register-effect-opp", (c) => c.owner === "Duel" && c.fn === "RegisterEffect" && whoOf(c.args[1]).kind === "opp"),
  },
  {
    id: "summon-opp-field",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "A Special Summon to the field of an opponent (effect `tp, 1-tp` or a procedure with target range (pos,1)): the summoning player picks one opponent (ADR-0002 card decisions).",
    detect: (s) => [
      ...lineRule(s, "summon-opp-field", /SpecialSummon(?:Step)?\([^\n]*,\s*tp\s*,\s*1-tp\s*,/),
      ...lineRule(s, "summon-opp-field", /SetTargetRange\(\s*POS_[A-Z_+]*\s*,\s*1\s*\)/),
    ],
  },
  {
    id: "kaiju-lava-procedure",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "Tribute a monster of an opponent and Special Summon to that field (aux.AddKaijuProcedure, aux.AddLavaProcedure): ADR-0002 card decision.",
    detect: (s) => lineRule(s, "kaiju-lava-procedure", /aux\.Add(?:Kaiju|Lava)Procedure/),
  },
  {
    id: "extra-release",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "EFFECT_EXTRA_RELEASE: a card of another duelist may be Tributed as if it were yours. Which opponent (or partner) may be used needs a rule (Soul Exchange: any opponent).",
    detect: (s) => lineRule(s, "extra-release", /\bEFFECT_EXTRA_RELEASE(?:_SUM|_NONSUM)?\b/),
  },
  {
    id: "field-count-compare",
    cls: "O",
    ambiguous: true,
    tables: "all",
    why: "The script compares the number of cards on your field with the number on the opponent field (Evenly Matched, Pineapple Blast, Kaiser Colosseum): in free-for-all the opponent side is the sum of all opponents unless a card rule picks one opponent.",
    detect: (s) => fieldCountCompare(s).map((line) => hitAt(s, "field-count-compare", line)),
  },
  // ----- O: the opponent pick is clear (R-COMMON-OPP-PICK), F5 binds it
  {
    id: "individual-opp",
    cls: "O",
    ambiguous: false,
    tables: "all",
    why: "An individual API (draw, damage, LP, Deck, hand, zone count, flags) is called for the opponent: the activator picks one opponent (R-COMMON-OPP-PICK).",
    detect: (s) =>
      callRule(s, "individual-opp", (c) => c.owner === "Duel" && INDIVIDUAL_APIS.has(c.fn) && whoOf(c.args[0]).kind === "opp"),
  },
  {
    id: "opp-individual-location",
    cls: "O",
    ambiguous: false,
    tables: "all",
    why: "The script reads or chooses cards in an opponent's hand, Deck or Extra Deck: one opponent (R-COMMON-OPP-PICK).",
    detect: (s) => locReads(s).filter((r) => r.oppo.individual).map((r) => hitAt(s, "opp-individual-location", r.line)),
  },
  {
    id: "chooser-opp",
    cls: "O",
    ambiguous: false,
    tables: "all",
    why: "The opponent is asked to choose, answer or announce (Select*/Announce*(1-tp)): the prompt goes to the bound opponent.",
    detect: (s) => {
      const field = new Set(fieldChoosers(s));
      return choosers(s)
        .filter((call) => !field.has(call))
        .map((call) => hitAt(s, "chooser-opp", call.line));
    },
  },
  {
    id: "zone-mask-shift",
    cls: "O",
    ambiguous: false,
    tables: "all",
    why: "A zone mask shifted into the opponent half (<<16, >>16) or a chosen placement on the opponent field: the bound opponent only, until MSG_SELECT_PLACE_N (task F8).",
    detect: (s) => [
      ...lineRule(s, "zone-mask-shift", /<<\s*16|>>\s*16/),
      ...callRule(s, "zone-mask-shift", (c) => c.owner === "Duel" && (c.fn === "SelectDisableField" || c.fn === "SelectFieldZone")),
    ],
  },
  {
    id: "column",
    cls: "O",
    ambiguous: false,
    tables: "all",
    why: "Column queries need a format-specific peer: FFA4 uses its fixed living facing seat; FFA3 uses R-FFA-THREE-COLUMNS (a declared opponent for approved activated effects, or the sole remaining opponent for all column logic). Review activated operations for an early opponent declaration; keep Link/EMZ sharing separate.",
    detect: (s) => callRule(s, "column", (c) => c.owner === "method" && (c.fn === "GetColumnGroup" || c.fn === "GetColumnZone")),
  },
  // ----- C: the class behaviour of the fold is enough
  {
    id: "field-opp-mask",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "A field-class read of the opponent side (GetMatchingGroup(f,tp,0,MZONE), ...): every opponent (R-COMMON-OPP-FIELD).",
    detect: (s) => locReads(s).filter((r) => r.oppo.field).map((r) => hitAt(s, "field-opp-mask", r.line)),
  },
  {
    id: "target-range-opp",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "SetTargetRange with an opponent side (0,1 or 1,1 or a location mask): every opponent (R-COMMON-ONGOING).",
    detect: (s) =>
      callRule(s, "target-range-opp", (c) => c.owner === "method" && c.fn === "SetTargetRange" && c.args.length === 2 && c.args[1]!.replace(/\s+/g, "") !== "0"),
  },
  {
    id: "reset-oppo-once",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "RESET_OPPO_TURN with a count of 1 (or no count): lasts until the end of the next opponent turn.",
    detect: (s) => lineRule(s, "reset-oppo-once", /\bRESET_OPPO_TURN\b/),
  },
  {
    id: "phase-turn-player",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "A phase trigger (EVENT_PHASE) with IsTurnPlayer/GetTurnPlayer: it fires in the phase of every duelist the predicate matches. In Tag, 'tp' matches the partner turn too (Messenger of Peace and Snatch Steal rules).",
    detect: (s) => (/\bEVENT_PHASE(?:_START)?\s*[|+]\s*PHASE_/.test(s.cleanText) ? lineRule(s, "phase-turn-player", /\b(?:IsTurnPlayer|GetTurnPlayer)\(/) : []),
  },
  {
    id: "player-all",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "PLAYER_ALL fans out to every duelist.",
    detect: (s) => lineRule(s, "player-all", /\bPLAYER_ALL\b/),
  },
  {
    id: "global-check",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "A GlobalCheck effect with no per-player slot: card flags or a flag for player 0. The fold needs nothing.",
    detect: (s) => lineRule(s, "global-check", /\bGlobalCheck\b/),
  },
  {
    id: "label-player-store",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "A player is stored in a label and read in the same scope (cost to operation). The fold is consistent there.",
    detect: (s) => callRule(s, "label-player-store", (c) => c.owner === "method" && c.fn === "SetLabel" && isPlayerExpr(c.args[0])),
  },
  {
    id: "opp-ref",
    cls: "C",
    ambiguous: false,
    tables: "all",
    why: "The script refers to the opponent (1-tp): a predicate or a filter; '1' matches any opponent.",
    detect: (s) => lineRule(s, "opp-ref", new RegExp(String.raw`\b1\s*-\s*(?:tp|ep|rp|p|player|e:GetHandlerPlayer\(\)|c:GetControler\(\))`)),
  },
];

export const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

// ---------------------------------------------------------------------------------------------------------------
// Card result

export interface CardScan {
  code: number;
  name: string;
  cls: Cls;
  /** Class of each rule that hit, most severe first. */
  rules: string[];
  hits: Hit[];
  /** Flagged: class F, or class O through an ambiguous rule. Such a card must be on a list. */
  flagged: boolean;
}

const ORDER: Record<Cls, number> = { U: 0, C: 1, O: 2, F: 3 };

/** Class a hit set to a card. Hits of rule "label-player-store" are dropped when "label-player" hit. */
export function classify(hits: Hit[]): { cls: Cls; flagged: boolean; rules: string[] } {
  const ids = [...new Set(hits.map((h) => h.rule))];
  const dropped = new Set<string>();
  if (ids.includes("label-player")) dropped.add("label-player-store");
  if (ids.includes("player-table") || ids.includes("global-player-flag")) dropped.add("global-check");
  if (ids.includes("reset-oppo-turns")) dropped.add("reset-oppo-once");
  if (ids.includes("each-player-pair")) dropped.add("each-player-split");
  const kept = ids.filter((id) => !dropped.has(id));
  let cls: Cls = "U";
  let flagged = false;
  for (const id of kept) {
    const rule = RULE_BY_ID.get(id)!;
    if (ORDER[rule.cls] > ORDER[cls]) cls = rule.cls;
    if (rule.cls === "F" || (rule.cls === "O" && rule.ambiguous)) flagged = true;
  }
  const rules = kept.sort((a, b) => ORDER[RULE_BY_ID.get(b)!.cls] - ORDER[RULE_BY_ID.get(a)!.cls] || a.localeCompare(b));
  return { cls, flagged, rules };
}

export function scanText(code: number, text: string): CardScan {
  const source = makeSource(text);
  const raw: Hit[] = [];
  for (const rule of RULES) raw.push(...rule.detect(source));
  const { cls, flagged, rules } = classify(raw);
  const hits = raw.filter((hit) => rules.includes(hit.rule));
  // One hit per (rule, line).
  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    const key = `${hit.rule}:${hit.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const title = /^--\s*(.+?)\s*$/m.exec(text.split(/\r?\n/).slice(1, 2).join("\n"));
  return { code, name: title?.[1] ?? "", cls, rules, hits: unique, flagged };
}

// ---------------------------------------------------------------------------------------------------------------
// Corpus and reconcile

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export function defaultScriptsDir(): string {
  return process.env.DUEL_SCRIPTS_DIR ?? join(repoRoot, "data/duel-engine-next/card-scripts/official");
}

export function scanCorpus(dir: string): CardScan[] {
  const files = readdirSync(dir)
    .filter((file) => /^c\d+\.lua$/.test(file))
    .sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)));
  return files.map((file) => scanText(Number(file.slice(1, -4)), readFileSync(join(dir, file), "utf8")));
}

export interface ListEntry {
  list: "forbidden" | "card-rule";
  name: string;
  formats?: MultiplayerFormat[];
}

export function listIndex(): Map<number, ListEntry> {
  const index = new Map<number, ListEntry>();
  for (const entry of MULTIPLAYER_FORBIDDEN) index.set(entry.code, { list: "forbidden", name: entry.name, formats: entry.formats });
  for (const entry of MULTIPLAYER_CARD_RULES) index.set(entry.code, { list: "card-rule", name: entry.name });
  return index;
}

export interface Reconcile {
  needsDecision: CardScan[];
  /** Entries of the two lists that the scanner does not flag. */
  falseNegatives: { code: number; name: string; list: string; cls: Cls; rules: string[] }[];
  /** Forbidden for FFA only, but flagged by a pattern that is also wrong in Tag. */
  formatGap: { code: number; name: string; formats: MultiplayerFormat[]; rules: string[] }[];
  /** Entries whose script is not in the corpus. */
  missingScripts: number[];
}

export function reconcile(cards: CardScan[]): Reconcile {
  const lists = listIndex();
  const byCode = new Map(cards.map((card) => [card.code, card]));
  const needsDecision = cards.filter((card) => card.flagged && !lists.has(card.code));
  const falseNegatives: Reconcile["falseNegatives"] = [];
  const formatGap: Reconcile["formatGap"] = [];
  const missingScripts: number[] = [];
  for (const [code, entry] of lists) {
    const card = byCode.get(code);
    if (!card) {
      missingScripts.push(code);
      continue;
    }
    if (!card.flagged) falseNegatives.push({ code, name: entry.name, list: entry.list, cls: card.cls, rules: card.rules });
    if (entry.list === "forbidden" && !entry.formats!.includes("tag")) {
      const wide = card.rules.filter((id) => {
        const rule = RULE_BY_ID.get(id)!;
        return rule.tables === "all" && (rule.cls === "F" || (rule.cls === "O" && rule.ambiguous));
      });
      if (wide.length > 0) formatGap.push({ code, name: entry.name, formats: entry.formats!, rules: wide });
    }
  }
  return { needsDecision, falseNegatives, formatGap, missingScripts };
}

export interface Summary {
  total: number;
  perClass: Record<Cls, number>;
  perRule: { rule: string; cls: Cls; cards: number }[];
  flagged: number;
}

export function summarize(cards: CardScan[]): Summary {
  const perClass: Record<Cls, number> = { U: 0, C: 0, O: 0, F: 0 };
  const perRule = new Map<string, number>();
  for (const card of cards) {
    perClass[card.cls]++;
    for (const id of card.rules) perRule.set(id, (perRule.get(id) ?? 0) + 1);
  }
  return {
    total: cards.length,
    perClass,
    flagged: cards.filter((card) => card.flagged).length,
    perRule: [...perRule.entries()]
      .map(([rule, count]) => ({ rule, cls: RULE_BY_ID.get(rule)!.cls as Cls, cards: count }))
      .sort((a, b) => b.cards - a.cards || a.rule.localeCompare(b.rule)),
  };
}

/** The most severe flagged rule of a card: the group it goes in on the decision list. */
export function primaryRule(card: CardScan): string {
  return (
    card.rules.find((id) => {
      const rule = RULE_BY_ID.get(id)!;
      return rule.cls === "F" || (rule.cls === "O" && rule.ambiguous);
    }) ?? card.rules[0] ?? "none"
  );
}

export function renderMarkdown(cards: CardScan[], summary: Summary, rec: Reconcile, scriptsDir: string): string {
  const out: string[] = [];
  out.push("# Multiplayer script scan");
  out.push("");
  out.push(`Scripts: \`${scriptsDir}\` (${summary.total} cards). Classes: U unchanged, C class behaviour is enough, O needs an opponent pick (F5), F fails (card script or ban).`);
  out.push("");
  out.push("| class | cards |");
  out.push("|---|---|");
  for (const cls of ["U", "C", "O", "F"] as const) out.push(`| ${cls} | ${summary.perClass[cls]} |`);
  out.push("");
  out.push(`Flagged (F, or O with an ambiguous rule): ${summary.flagged}. Not on a list ("needs product decision"): ${rec.needsDecision.length}.`);
  out.push("");
  out.push("## Patterns by card count");
  out.push("");
  out.push("| pattern | class | cards |");
  out.push("|---|---|---|");
  for (const row of summary.perRule) out.push(`| ${row.rule} | ${row.cls}${RULE_BY_ID.get(row.rule)!.ambiguous ? " (decision)" : ""} | ${row.cards} |`);
  out.push("");
  out.push("## Needs product decision");
  out.push("");
  const groups = new Map<string, CardScan[]>();
  for (const card of rec.needsDecision) {
    const key = primaryRule(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  for (const [rule, group] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`### ${rule} (${group.length})`);
    out.push("");
    out.push(RULE_BY_ID.get(rule)!.why);
    out.push("");
    for (const card of group.slice(0, 15)) {
      const hit = card.hits.find((h) => h.rule === rule) ?? card.hits[0];
      out.push(`- ${card.code} ${card.name}: line ${hit?.line}: \`${hit?.text.replace(/`/g, "'")}\``);
    }
    if (group.length > 15) out.push(`- ... ${group.length - 15} more (see multiplayer-scan.json)`);
    out.push("");
  }
  out.push("## List entries the scanner does not flag");
  out.push("");
  if (rec.falseNegatives.length === 0) out.push("None.");
  for (const row of rec.falseNegatives) out.push(`- ${row.code} ${row.name} (${row.list}): class ${row.cls}, patterns: ${row.rules.join(", ") || "none"}`);
  out.push("");
  if (rec.formatGap.length > 0) {
    out.push("## Forbidden for free-for-all only, but the pattern is also wrong in Tag");
    out.push("");
    for (const row of rec.formatGap) out.push(`- ${row.code} ${row.name}: ${row.rules.join(", ")}`);
    out.push("");
  }
  if (rec.missingScripts.length > 0) out.push(`List entries without an official script: ${rec.missingScripts.join(", ")}`, "");
  return out.join("\n");
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const scriptsDir = resolve(arg("--scripts") ?? defaultScriptsDir());
  if (!existsSync(scriptsDir)) throw new Error(`card scripts not found: ${scriptsDir}`);
  const outDir = resolve(arg("--out") ?? join(repoRoot, ".status"));
  const cards = scanCorpus(scriptsDir);
  const summary = summarize(cards);
  const rec = reconcile(cards);
  const lists = listIndex();
  mkdirSync(outDir, { recursive: true });
  const json = {
    scriptsDir,
    summary,
    rules: RULES.map((rule) => ({ id: rule.id, cls: rule.cls, ambiguous: rule.ambiguous, tables: rule.tables, why: rule.why })),
    reconcile: {
      needsDecision: rec.needsDecision.map((card) => ({ code: card.code, name: card.name, cls: card.cls, rules: card.rules, hits: card.hits.slice(0, 6) })),
      falseNegatives: rec.falseNegatives,
      formatGap: rec.formatGap,
      missingScripts: rec.missingScripts,
    },
    // Every card with a pattern hit (class C and above). Class U cards are only counted.
    cards: cards
      .filter((card) => card.cls !== "U")
      .map((card) => ({
        code: card.code,
        name: card.name,
        cls: card.cls,
        flagged: card.flagged,
        list: lists.get(card.code)?.list ?? null,
        rules: card.rules,
        hits: card.hits.slice(0, 8),
      })),
  };
  writeFileSync(join(outDir, "multiplayer-scan.json"), JSON.stringify(json, null, 1) + "\n");
  writeFileSync(join(outDir, "multiplayer-scan.md"), renderMarkdown(cards, summary, rec, scriptsDir));
  console.log(
    `${summary.total} cards: U ${summary.perClass.U}, C ${summary.perClass.C}, O ${summary.perClass.O}, F ${summary.perClass.F}. ` +
      `Flagged ${summary.flagged}, needs decision ${rec.needsDecision.length}, list entries not flagged ${rec.falseNegatives.length}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
