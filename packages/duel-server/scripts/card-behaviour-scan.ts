/**
 * Reads one EDOPro card script and returns what the card does to the board (zone movement facts for Remote Duels).
 * Static text analysis, one pass per script: effects are rebuilt from Effect.CreateEffect / :Clone() / :SetXxx() / RegisterEffect,
 * then the functions each effect points at (cost, target, operation, and every s.name they mention) are scanned for movement calls.
 * What the scan cannot resolve (shared helpers in other files, computed arguments) is left out. Out means unknown, never "does not".
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
type Effect = Rec & { card: boolean };
const SETTER = { Type: "type", Range: "range", Cost: "cost", Target: "target", Operation: "operation" } as const;
const STATEMENT = new RegExp([
  String.raw`(?:local\s+)?(\w+)\s*=\s*Effect\.CreateEffect\(`,
  String.raw`(?:local\s+)?(\w+)\s*=\s*(\w+):Clone\(\)`,
  String.raw`\b(\w+):Set(Type|Range|Cost|Target|Operation)\(`,
  String.raw`[\w.:()]+?:RegisterEffect\(\s*(\w+)`,
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
    else if (m[6] || m[7]) { const rec = vars.get(m[6] ?? m[7]); if (rec) out.push({ ...rec, card: !!m[6] }); }
  }
  return out;
}

const COST_HELPER: Record<string, { cost: BehaviourCost; leaves: BehaviourDestination }> = {
  SelfBanish: { cost: "banish", leaves: "banish" }, bfgcost: { cost: "banish", leaves: "banish" },
  SelfTribute: { cost: "tribute", leaves: "gy" }, SelfRelease: { cost: "tribute", leaves: "gy" },
  SelfToGrave: { cost: "toGY", leaves: "gy" }, SelfToHand: { cost: "toHand", leaves: "hand" },
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

/** Where the effect looks for cards: the own and opponent locations named in its selection calls and operation info. */
function selectionLocations(text: string): Set<BehaviourLocation> {
  const out = new Set<BehaviourLocation>();
  const add = (own: string | undefined, opponent: string | undefined, swap = false) => {
    const [a, b] = swap ? [opponent, own] : [own, opponent];
    for (const l of locationsIn(a)) out.add(l); for (const l of locationsIn(b)) out.add(OPPONENT[l]);
  };
  for (const m of text.matchAll(/\bDuel\.Select(?:Target|MatchingCard)\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[3], a[4], flip(a[2])); }
  for (const m of text.matchAll(/\bDuel\.(?:IsExistingTarget|IsExistingMatchingCard|GetMatchingGroup|GetMatchingGroupCount|GetFirstMatchingCard|GetTargetCount)\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[2], a[3], flip(a[1])); }
  for (const m of text.matchAll(/\bDuel\.GetFieldGroup(?:Count)?\(/g)) { const a = argsAt(text, m.index! + m[0].length); add(a[1], a[2], flip(a[0])); }
  for (const m of text.matchAll(OPERATION_INFO)) {
    const a = argsAt(text, m.index! + m[0].length);
    if (a.length >= 6 && MOVES_FROM.test(a[1])) for (const l of locationsIn(a[5])) out.add(flip(a[4]) ? OPPONENT[l] : l);
  }
  return out;
}

const uniqueSorted = <T extends string>(values: Iterable<T>) => [...new Set(values)].sort();
export type ScanContext = { extraDeckMonster: boolean };

/** What one script does. An empty object means nothing was found. */
export function scanScript(source: string, context: ScanContext): CardBehaviour {
  const functions = functionsOf(source);
  const textOf = (names: Iterable<string>) => [...names].map(n => functions.get(n) ?? "").join("\n");
  /** The functions an argument names (s.xxx) and everything those functions name in turn. */
  const closure = (arg: string) => {
    const seen = new Set<string>(), queue = [...arg.matchAll(/\bs\.(\w+)/g)].map(m => `s.${m[1]}`);
    while (queue.length && seen.size < 40) {
      const name = queue.pop()!;
      if (seen.has(name) || !functions.has(name)) continue;
      seen.add(name);
      for (const m of functions.get(name)!.matchAll(/\bs\.(\w+)/g)) queue.push(`s.${m[1]}`);
    }
    return seen;
  };

  const cost = new Set<BehaviourCost>(), costOther = new Set<Exclude<BehaviourCost, "detach">>(), leaves = new Set<BehaviourDestination>();
  const sends = new Map<BehaviourDestination, Set<BehaviourLocation>>(), attach = new Set<BehaviourLocation>();
  let handQuick = false, attaches = false, detachMin = 0, detachMax = 0, detaches = false;
  const markDetach = (min: number | undefined, max: number | undefined) => {
    const low = min ?? 1, high = max ?? 0;
    detachMin = detaches ? Math.min(detachMin, low) : low;
    detachMax = detaches ? (detachMax === 0 || high === 0 ? 0 : Math.max(detachMax, high)) : high;
    detaches = true;
  };

  for (const body of functions.values()) {
    for (const effect of effectsIn(body)) {
      if (effect.card && /\bEFFECT_TYPE_QUICK_O\b/.test(effect.type) && /\bLOCATION_HAND\b/.test(effect.range)) handQuick = true;
      const names = new Set([...closure(effect.cost), ...closure(effect.target), ...closure(effect.operation)]);
      const text = [effect.cost, effect.target, effect.operation, textOf(names)].join("\n");
      const found = selectionLocations(text);

      for (const m of effect.cost.matchAll(/\b(?:Cost|aux|Auxiliary)\.(\w+)(?:\(|\b)/g)) {
        const helper = COST_HELPER[m[1]];
        if (helper) { cost.add(helper.cost); leaves.add(helper.leaves); }
        else if (OTHER_COST_HELPER[m[1]]) costOther.add(OTHER_COST_HELPER[m[1]]);
        else if (m[1] === "DetachFromSelf") {
          const a = argsAt(effect.cost, m.index! + m[0].length); cost.add("detach"); markDetach(number(a[0]), number(a[1] ?? a[0]));
        } else if (m[1] === "DetachChoiceFromSelf") { cost.add("detach"); markDetach(1, 0); }
      }
      for (const m of text.matchAll(DETACH)) {
        const a = argsAt(text, m.index! + m[0].length), duel = m[0].startsWith("Duel");
        const [min, max, reason] = duel ? [a[3], a[4], a[5]] : [a[1], a[2], a[3]];
        markDetach(number(min), number(max)); if (/\bREASON_COST\b/.test(reason ?? "")) cost.add("detach");
      }
      for (const m of text.matchAll(MOVE)) {
        const a = argsAt(text, m.index! + m[0].length), verb = m[1], self = isSelf(a[0]);
        const reason = a.join(","), asCost = /\bREASON_COST\b/.test(reason);
        if (verb === "Overlay") { attaches = true; for (const l of found) attach.add(l); continue; }
        let to: BehaviourDestination, source: BehaviourLocation[] = [];
        if (verb === "SendtoGrave" || verb === "Destroy" || verb === "Release") to = "gy";
        else if (verb === "SendtoHand") to = "hand";
        else if (verb === "SendtoExtraP") to = "extraUp";
        else if (verb === "SendtoDeck") to = self && context.extraDeckMonster ? "extra" : "deck";
        else if (verb === "Remove") to = /\bPOS_FACEDOWN\b/.test(a[1] ?? "") ? "banishDown" : "banish";
        else if (verb === "DiscardHand") { to = "gy"; source = ["hand"]; }
        else { to = "gy"; source = [flip(a[0]) ? "opponentDeck" : "deck"]; } // DiscardDeck
        if (self) {
          leaves.add(to);
          if (asCost) cost.add(verb === "Remove" ? "banish" : verb === "Release" ? "tribute" : verb === "SendtoHand" ? "toHand" : verb === "SendtoDeck" ? (to === "extra" ? "toExtra" : "toDeck") : /\bREASON_DISCARD\b/.test(reason) ? "discard" : "toGY");
        } else if (asCost) {
          costOther.add(verb === "Remove" ? "banish" : verb === "Release" ? "tribute" : verb === "SendtoHand" ? "toHand" : verb === "SendtoDeck" ? "toDeck" : verb === "DiscardHand" || /\bREASON_DISCARD\b/.test(reason) ? "discard" : "toGY");
        } else {
          const entry = sends.get(to) ?? new Set<BehaviourLocation>();
          for (const l of source.length ? source : found) entry.add(l);
          sends.set(to, entry);
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
  if (leaves.size) result.leaves = uniqueSorted(leaves);
  if (sends.size) result.sends = [...sends].map(([to, set]) => ({ to, from: uniqueSorted(set) }));
  if (/\bDuel\.Draw\(/.test(source)) result.draws = true;
  return result;
}
