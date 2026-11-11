/**
 * Reads one EDOPro card script and returns what the card does to the board (zone movement facts for Remote Duels).
 * Static text analysis, one pass per script: effects are rebuilt from Effect.CreateEffect / :Clone() / :SetXxx() / RegisterEffect,
 * then the functions each effect points at (cost, target, operation, and every s.name they mention) are scanned for movement calls.
 * What the scan cannot resolve (shared helpers in other files, computed arguments) is left out. Out means unknown, never "does not".
 * Each move reads its "from" zones from the Select/Get call that built the group it moves (variables are followed back to their
 * assignment). When that cannot be followed, the zones are only kept if the effect has one move and one selection call, else empty (unknown).
 */
import type { BehaviourCost, BehaviourDestination, BehaviourLocation, CardBehaviour } from "@yugidraft/shared/remote/card-behaviour";

type Own = "field" | "hand" | "deck" | "gy" | "banish" | "extra";
const LOCATION_WORDS: [RegExp, Own][] = [
  [/\bLOCATION_(?:ONFIELD|MZONE|SZONE|FZONE|PZONE|MMZONE|EMZONE)\b/, "field"], [/\bLOCATION_HAND\b/, "hand"], [/\bLOCATION_DECK\b/, "deck"],
  [/\bLOCATION_GRAVE\b/, "gy"], [/\bLOCATION_REMOVED\b/, "banish"], [/\bLOCATION_EXTRA\b/, "extra"],
];
const OPPONENT: Record<Own, BehaviourLocation> = { field: "opponentField", hand: "opponentHand", deck: "opponentDeck", gy: "opponentGy", banish: "opponentBanish", extra: "opponentExtra" };
/** The locations named in one Lua argument. */
const locationsIn = (arg: string | undefined): Own[] => (arg ? LOCATION_WORDS.filter(([re]) => re.test(arg)).map(([, own]) => own) : []);
const flip = (player: string | undefined) => /^1\s*-\s*\w+$/.test((player ?? "").trim());

/** The top-level arguments of the call whose "(" ends just before `from`. */
export function argsAt(text: string, from: number): string[] {
  const args: string[] = []; let depth = 0, start = from, quote = "";
  for (let i = from; i < text.length && i < from + 1200; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote && text[i - 1] !== "\\") quote = ""; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") { if (depth === 0) { args.push(text.slice(start, i).trim()); return args; } depth--; }
    else if (ch === "," && depth === 0) { args.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return args;
}

const isSelf = (arg: string | undefined) => /^(?:c|e:GetHandler\(\))$/.test((arg ?? "").trim());
const FUNCTION_START = /^function\s+([\w.:]+)\s*\(/gm;
/** Top-level functions by name. A body runs to the next top-level function (the scripts close them at column 0). */
function functionsOf(text: string): Map<string, string> {
  const starts = [...text.matchAll(FUNCTION_START)];
  return new Map(starts.map((m, i) => [m[1], text.slice(m.index!, starts[i + 1]?.index ?? text.length)]));
}

type Rec = { type: string; range: string; cost: string; target: string; operation: string };
const blank = (): Rec => ({ type: "", range: "", cost: "", target: "", operation: "" });
/** self = registered on this card; player = Duel.RegisterEffect (delayed effects of this card); foreign = registered on another card (skipped). */
type Effect = Rec & { kind: "self" | "player" | "foreign" };
const SETTER = { Type: "type", Range: "range", Cost: "cost", Target: "target", Operation: "operation" } as const;
const STATEMENT = new RegExp([
  String.raw`(?:local\s+)?(\w+)\s*=\s*Effect\.CreateEffect\(`,
  String.raw`(?:local\s+)?(\w+)\s*=\s*(\w+):Clone\(\)`,
  String.raw`\b(\w+):Set(Type|Range|Cost|Target|Operation)\(`,
  String.raw`([\w.:()]+?):RegisterEffect\(\s*(\w+)`,
  String.raw`\bDuel\.RegisterEffect\(\s*(\w+)`,
].join("|"), "g");
/** The effects a function builds, as the state of each effect variable when it is registered. */
function effectsIn(body: string): Effect[] {
  const vars = new Map<string, Rec>(), out: Effect[] = [];
  for (const m of body.matchAll(STATEMENT)) {
    const at = m.index! + m[0].length;
    if (m[1]) vars.set(m[1], blank());
    else if (m[2]) vars.set(m[2], { ...(vars.get(m[3]) ?? blank()) });
    else if (m[4]) { const rec = vars.get(m[4]); if (rec) rec[SETTER[m[5] as keyof typeof SETTER]] = argsAt(body, at).join(","); }
    else if (m[6] || m[8]) {
      const rec = vars.get(m[7] ?? m[8]); if (!rec) continue;
      const kind = !m[6] ? "player" : /^(?:c|e:GetHandler\(\))$/.test(m[6]) ? "self" : "foreign";
      out.push({ ...rec, kind });
    }
  }
  return out;
}

type Helper = { cost: BehaviourCost; leaves: BehaviourDestination; toGrave?: true };
const COST_HELPER: Record<string, Helper> = {
  SelfBanish: { cost: "banish", leaves: "banish" }, bfgcost: { cost: "banish", leaves: "banish" },
  SelfTribute: { cost: "tribute", leaves: "gy", toGrave: true }, SelfRelease: { cost: "tribute", leaves: "gy", toGrave: true },
  SelfToGrave: { cost: "toGY", leaves: "gy", toGrave: true }, SelfToHand: { cost: "toHand", leaves: "hand" },
  SelfToDeck: { cost: "toDeck", leaves: "deck" }, SelfToExtra: { cost: "toExtra", leaves: "extra" },
  SelfDiscard: { cost: "discard", leaves: "gy" }, SelfDiscardToGrave: { cost: "discard", leaves: "gy" },
};
const OTHER_COST_HELPER: Record<string, Exclude<BehaviourCost, "detach">> = { Discard: "discard" };
const MOVE = /\bDuel\.(SendtoGrave|SendtoHand|SendtoDeck|SendtoExtraP|Remove|Destroy|Release|Overlay|DiscardHand|DiscardDeck)\(/g;
const DETACH = /(?:\bDuel\.RemoveOverlayCard|:RemoveOverlayCard)\(/g;
const OPERATION_INFO = /\bDuel\.Set(?:Possible)?OperationInfo\(/g;
/** Operation info categories whose location argument is where the cards are taken from (not where a summon comes from). */
const MOVES_FROM = /\bCATEGORY_(?:TOHAND|SEARCH|TODECK|TOGRAVE|DECKDES|REMOVE|DESTROY|RELEASE)\b/;
const number = (arg: string | undefined) => (arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined);

/** One look at where cards are: a Select/IsExisting/Get call, or the operation info of a move. */
type Selection = { signature: string; locations: BehaviourLocation[]; target: boolean };
function selectionsIn(text: string): Selection[] {
  const out: Selection[] = [];
  const add = (own: string | undefined, opponent: string | undefined, swap: boolean, target: boolean) => {
    const [a, b] = swap ? [opponent, own] : [own, opponent];
    const locations = [...locationsIn(a), ...locationsIn(b).map(l => OPPONENT[l])] as BehaviourLocation[];
    if (locations.length) out.push({ signature: locations.join(), locations, target });
  };
  for (const m of text.matchAll(/\bDuel\.Select(Target|MatchingCard)\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[3], a[4], flip(a[2]), m[1] === "Target"); }
  for (const m of text.matchAll(/\bDuel\.(IsExistingTarget|IsExistingMatchingCard|GetMatchingGroup|GetMatchingGroupCount|GetFirstMatchingCard|GetTargetCount)\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[2], a[3], flip(a[1]), /Target/.test(m[1])); }
  for (const m of text.matchAll(/\bDuel\.GetFieldGroup(?:Count)?\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[1], a[2], flip(a[0]), false); }
  for (const m of text.matchAll(OPERATION_INFO)) {
    const a = argsAt(text, m.index! + m[0].length);
    if (a.length >= 6 && MOVES_FROM.test(a[1])) add(flip(a[4]) ? undefined : a[5], flip(a[4]) ? a[5] : undefined, false, false);
  }
  return out;
}
const hasSelection = (text: string) => /\bDuel\.(?:Select(?:Target|MatchingCard)|IsExistingTarget|IsExistingMatchingCard|GetMatchingGroup|GetFirstMatchingCard|GetFieldGroup|GetDecktopGroup)\(/.test(text);
const TARGET_GROUP = /\bDuel\.(?:GetFirstTarget|GetTargetCards)\(|:GetTargetsRelateToChain\(/;
const NOT_VARIABLE = new Set(["local", "Duel", "aux", "Cost", "nil", "e", "c", "tp", "true", "false", "function", "and", "or", "not", "if", "then", "end", "Group", "Card"]);

/** Where the cards named by an expression come from: the selection call behind a variable, or undefined when it cannot be followed. */
function originOf(unit: string, at: number, expression: string, targets: BehaviourLocation[], depth = 0): BehaviourLocation[] | undefined {
  const text = expression.trim();
  if (hasSelection(text)) { const l = selectionsIn(text).flatMap(x => x.locations); return l.length ? l : undefined; }
  if (TARGET_GROUP.test(text)) return targets.length ? targets : undefined;
  const id = /^[A-Za-z_]\w*/.exec(text)?.[0];
  if (!id || depth > 4 || NOT_VARIABLE.has(id)) return undefined;
  const before = unit.slice(0, at);
  let best: { index: number; rhs: string } | undefined;
  for (const m of before.matchAll(new RegExp(String.raw`\b${id}\s*=(?!=)([^\n]*)`, "g"))) best = { index: m.index!, rhs: m[1] };
  for (const m of before.matchAll(new RegExp(String.raw`\bfor\s+${id}\s+in\s+(?:aux\.Next\()?\s*([^\n]*)`, "g"))) if (!best || m.index! > best.index) best = { index: m.index!, rhs: m[1] };
  if (!best) return undefined;
  if (hasSelection(best.rhs)) { const l = selectionsIn(best.rhs).flatMap(x => x.locations); return l.length ? l : undefined; }
  if (TARGET_GROUP.test(best.rhs)) return targets.length ? targets : undefined;
  for (const m of best.rhs.matchAll(/\b[A-Za-z_]\w*\b/g)) {
    if (NOT_VARIABLE.has(m[0])) continue;
    if (new RegExp(String.raw`\b${m[0]}\s*=(?!=)|\bfor\s+${m[0]}\s+in\b`).test(unit.slice(0, best.index))) return originOf(unit, best.index, m[0], targets, depth + 1);
  }
  return undefined;
}

const uniqueSorted = <T extends string>(values: Iterable<T>) => [...new Set(values)].sort();
export type ScanContext = { extraDeckMonster: boolean; pendulum: boolean };

/** The own zones an effect works from (its range; an activated Spell/Trap works from the field). Empty = unknown. */
function zonesOf(effect: Rec): BehaviourLocation[] {
  const zones = locationsIn(effect.range) as BehaviourLocation[];
  return zones.length || !/\bEFFECT_TYPE_ACTIVATE\b/.test(effect.type) ? zones : ["field"];
}

/** What one script does. An empty object means nothing was found. */
export function scanScript(source: string, context: ScanContext): CardBehaviour {
  const functions = functionsOf(source);
  /** The functions an argument names (s.xxx) and everything those functions name in turn. */
  const closure = (arg: string) => {
    const seen = new Set<string>(), queue = [...arg.matchAll(/\bs\.(\w+)/g)].map(m => `s.${m[1]}`);
    while (queue.length && seen.size < 40) {
      const name = queue.pop()!;
      if (seen.has(name) || !functions.has(name)) continue;
      seen.add(name);
      // The functions a nested effect is built with (eN:SetOperation(s.xxx)) belong to that effect, not to this one.
      for (const m of functions.get(name)!.replace(/^\s*\w+:Set\w+\(.*$/gm, "").matchAll(/\bs\.(\w+)/g)) queue.push(`s.${m[1]}`);
    }
    return seen;
  };

  const cost = new Set<BehaviourCost>(), costOther = new Set<Exclude<BehaviourCost, "detach">>();
  const leaves = new Map<BehaviourDestination, Set<BehaviourLocation>>();
  const sends = new Map<BehaviourDestination, Set<BehaviourLocation>>(), attach = new Set<BehaviourLocation>();
  let handQuick = false, attaches = false, detachMin = 0, detachMax = 0, detaches = false;
  const markDetach = (min: number | undefined, max: number | undefined) => {
    const low = min ?? 1, high = max ?? 0;
    detachMin = detaches ? Math.min(detachMin, low) : low;
    detachMax = detaches ? (detachMax === 0 || high === 0 ? 0 : Math.max(detachMax, high)) : high;
    detaches = true;
  };
  const put = (map: Map<BehaviourDestination, Set<BehaviourLocation>>, to: BehaviourDestination, from: Iterable<BehaviourLocation>) => {
    const entry = map.get(to) ?? new Set<BehaviourLocation>();
    for (const l of from) entry.add(l);
    map.set(to, entry);
  };
  /** This card leaves for `to` from `zones`. A Pendulum Monster sent from the field to the GY goes to the Extra Deck face-up instead. */
  const leave = (to: BehaviourDestination, zones: BehaviourLocation[], toGrave: boolean) => {
    if (!(context.pendulum && toGrave && to === "gy")) return put(leaves, to, zones);
    if (!zones.length) { put(leaves, "extraUp", []); put(leaves, "gy", []); return; }
    if (zones.includes("field")) put(leaves, "extraUp", ["field"]);
    const rest = zones.filter(z => z !== "field");
    if (rest.length) put(leaves, "gy", rest);
  };

  for (const body of functions.values()) {
    for (const effect of effectsIn(body)) {
      if (effect.kind === "foreign") continue;
      if (effect.kind === "self" && /\bEFFECT_TYPE_QUICK_O\b/.test(effect.type) && /\bLOCATION_HAND\b/.test(effect.range)) handQuick = true;
      const names = new Set([...closure(effect.cost), ...closure(effect.target), ...closure(effect.operation)]);
      const units = [effect.cost, effect.target, effect.operation, ...[...names].map(n => functions.get(n)!)];
      const selections = units.flatMap(selectionsIn);
      const targets = [...new Set(selections.filter(x => x.target).flatMap(x => x.locations))];
      const looked = [...new Set(selections.flatMap(x => x.locations))];
      const zones = zonesOf(effect);
      // Moves of other cards (and Overlay): how many there are decides whether the effect-wide zones can stand in for a lost trail.
      const moveCount = units.reduce((n, unit) => n + [...unit.matchAll(MOVE)].filter(m => !isSelf(argsAt(unit, m.index! + m[0].length)[0]) && !/\bREASON_COST\b/.test(argsAt(unit, m.index! + m[0].length).join(","))).length, 0);
      const single = moveCount <= 1 && new Set(selections.map(x => x.signature)).size <= 1;
      const fromOf = (unit: string, at: number, expression: string | undefined) =>
        (expression === undefined ? undefined : originOf(unit, at, expression, targets)) ?? (single ? looked : []);

      for (const m of effect.cost.matchAll(/\b(?:Cost|aux|Auxiliary)\.(\w+)(?:\(|\b)/g)) {
        const helper = COST_HELPER[m[1]];
        if (helper) { cost.add(helper.cost); leave(helper.leaves, zones, !!helper.toGrave); }
        else if (OTHER_COST_HELPER[m[1]]) costOther.add(OTHER_COST_HELPER[m[1]]);
        else if (m[1] === "DetachFromSelf") {
          const a = argsAt(effect.cost, m.index! + m[0].length); cost.add("detach"); markDetach(number(a[0]), number(a[1] ?? a[0]));
        } else if (m[1] === "DetachChoiceFromSelf") { cost.add("detach"); markDetach(1, 0); }
      }
      for (const unit of units) {
        for (const m of unit.matchAll(DETACH)) {
          const a = argsAt(unit, m.index! + m[0].length), duel = m[0].startsWith("Duel");
          const [min, max, reason] = duel ? [a[3], a[4], a[5]] : [a[1], a[2], a[3]];
          markDetach(number(min), number(max)); if (/\bREASON_COST\b/.test(reason ?? "")) cost.add("detach");
        }
        for (const m of unit.matchAll(MOVE)) {
          const a = argsAt(unit, m.index! + m[0].length), verb = m[1], self = isSelf(a[0]);
          const reason = a.join(","), asCost = /\bREASON_COST\b/.test(reason), discard = verb === "DiscardHand" || /\bREASON_DISCARD\b/.test(reason);
          if (verb === "Overlay") { attaches = true; for (const l of fromOf(unit, m.index!, a[1])) attach.add(l); continue; }
          let to: BehaviourDestination, source: BehaviourLocation[] | undefined;
          if (verb === "Destroy") { // Destroy can send somewhere else than the GY (its third argument)
            const where = locationsIn(a[2])[0];
            to = where === "hand" ? "hand" : where === "deck" ? "deck" : where === "banish" ? "banish" : where === "extra" ? "extra" : "gy";
          } else if (verb === "SendtoGrave" || verb === "Release") to = "gy";
          else if (verb === "SendtoHand") to = "hand";
          else if (verb === "SendtoExtraP") to = "extraUp";
          else if (verb === "SendtoDeck") to = self && context.extraDeckMonster ? "extra" : "deck";
          else if (verb === "Remove") to = /\bPOS_FACEDOWN\b/.test(a[1] ?? "") ? "banishDown" : "banish";
          else if (verb === "DiscardHand") { to = "gy"; source = ["hand"]; }
          else { to = "gy"; source = [flip(a[0]) ? "opponentDeck" : "deck"]; } // DiscardDeck
          const costOf = (own: boolean): BehaviourCost => verb === "Remove" ? (to === "banishDown" ? "banishDown" : "banish") : verb === "Release" ? "tribute" : verb === "SendtoHand" ? "toHand"
            : verb === "SendtoDeck" ? (own && to === "extra" ? "toExtra" : "toDeck") : discard ? "discard" : "toGY";
          if (self) {
            leave(to, zones, !discard && (verb === "SendtoGrave" || verb === "Destroy" || verb === "Release") && to === "gy");
            if (asCost) cost.add(costOf(true));
          } else if (asCost) costOther.add(costOf(false) as Exclude<BehaviourCost, "detach">);
          else put(sends, to, source ?? fromOf(unit, m.index!, a[0]));
        }
      }
    }
  }

  const result: CardBehaviour = {};
  if (handQuick) result.handQuick = true;
  if (cost.size) result.cost = uniqueSorted(cost);
  if (costOther.size) result.costOther = uniqueSorted(costOther);
  if (detaches) result.detach = { min: detachMin, max: detachMax };
  if (attaches) result.attach = { from: uniqueSorted(attach) };
  if (leaves.size) result.leaves = [...leaves].map(([to, set]) => ({ to, from: uniqueSorted(set) }));
  if (sends.size) result.sends = [...sends].map(([to, set]) => ({ to, from: uniqueSorted(set) }));
  // Own draws only: Duel.Draw(1-tp, ...) is the opponent drawing.
  if ([...source.matchAll(/\bDuel\.Draw\(/g)].some(m => !flip(argsAt(source, m.index! + m[0].length)[0]))) result.draws = true;
  // Fusion and Ritual helpers move their materials out of sight of this scan.
  if (/\b(?:Fusion|Ritual)\.\w+/.test(source)) result.partial = true;
  return result;
}
