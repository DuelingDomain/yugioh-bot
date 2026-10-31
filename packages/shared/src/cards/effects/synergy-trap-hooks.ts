import type { Card, Subtype } from "./card.js";
import type { MatchEffect, MatchFilter, MatchEvent } from "./effect-match.js";
import { filterReachesCard } from "./synergy.js";

/** Unnamed witnesses for the mechanic, not a claim that any named engine's Traps fit.
 * Temple's Set-Trap plan uses Normal/Continuous Traps; Labrynth uses Normal Traps.
 * A named/typed/otherwise narrow filter must not match these unrestricted resources. */
export function trapMechanicTargets(normalOnly: boolean): Card[] {
  return (normalOnly ? ["normal"] : ["normal", "continuous"]).map(subtype => ({
    id: 0, name: "", kind: "trap", typeLine: "", subtypes: [subtype as Subtype], text: "", formats: [], views: 0, url: "",
  }));
}

function reachesTrap(filter: MatchFilter, targets: readonly Card[]): boolean {
  // filterReachesCard checks structured restrictions. Fail closed on residual
  // requirements such as '"Hole" Normal Trap' or 'Traps that equip themselves'.
  // Exclusions and different-name rules still leave this mechanic reachable.
  const other = (filter.other ?? "").replace(/(?:except|non-)\s*["“][^"”]+["”]/gi, "")
    .replace(/(?:with )?(?:a )?different names?(?: from (?:this card|the activated (?:Normal )?Trap))?/gi, "")
    .replace(/\b(?:set|face-down)\b/gi, "").replace(/[\s,.-]/g, "");
  return !other && targets.some(card => filterReachesCard({ ...filter, other: "" }, card));
}

const trapNoun = (filter: MatchFilter) => filter.subtypes.includes("normal") ? "a Normal Trap"
  : filter.subtypes.includes("continuous") ? "a Continuous Trap" : "a Trap";

type TrapMatch = { score: number; label: string };

const unsupportedGate = (text: string) => /(?:if|while|unless|requires?)\b[^.;]*["“]/i.test(text);

/** Validate the same effect/action that supplies the resource, including its
 * source. A GY-to-hand action cannot masquerade as Deck search or a Set. */
export function trapMechanicMatch(effects: readonly MatchEffect[], printed: string, targets: readonly Card[]): TrapMatch | undefined {
  // A mandatory named Summoning engine is not supplied by a Trap mechanic.
  if (/must be special summoned with ["“]|activate this card[^.]*while[^.]*["“]/.test(printed)) return undefined;
  let best: TrapMatch | undefined;
  const retain = (match: TrapMatch) => { if (!best || match.score > best.score) best = match; };
  for (const effect of effects) {
    // A Trap deck does not establish an unrelated Extra Deck material engine.
    if (effect.triggers.some(event => event.verb === "used_as_material" || /ritual summoned/i.test(event.note ?? ""))
      || effect.costs.some(cost => !cost.what.this_card && (cost.what.archetypes.length || cost.what.names.length))
      || effect.conditions?.some(condition => unsupportedGate(condition)
        || /(?:ritual|fusion|synchro|xyz|link)/i.test(condition) && !/trap/i.test(condition))) continue;
    for (const action of effect.actions) {
      if (action.player === "opponent" || action.what.this_card || !["set_spell_trap", "add_to_hand"].includes(action.verb)) continue;
      // Notes can retain a resource restriction or named prerequisite omitted
      // from the compact structured filter. Never promote it to unrestricted.
      if (unsupportedGate(action.note ?? "") || /must be able to|with an? effect that|that can only be activated/i.test(action.note ?? "")) continue;
      let filter = action.what;
      if (!filter.kinds.length && action.verb === "set_spell_trap") {
        // Lilith's Set refers to the Normal Traps revealed by this same effect.
        // Do not borrow a filter from another effect elsewhere on the card.
        const revealed = effect.actions.find(event => event.verb === "reveal_or_look" && event.player !== "opponent"
          && event.what.kinds.includes("trap") && event.from.some(zone => action.from.includes(zone)));
        if (!revealed) continue;
        if (!targets.some(card => reachesTrap(filter, [card]) && reachesTrap(revealed.what, [card]))) continue;
        filter = revealed.what;
      }
      if (!filter.kinds.includes("trap") || !reachesTrap(filter, targets)) continue;
      // Generic Spell/Trap recovery alone is not a Trap-engine connection.
      if (filter.kinds.includes("spell") && !effect.triggers.some(event => event.verb === "activate"
        && event.what.kinds.includes("trap") && reachesTrap(event.what, targets)
        || /by your normal trap effect/i.test(event.note ?? ""))) continue;
      if (!/\btraps?\b/.test(printed)) continue; // Missing/placeholder printed text cannot ground a hook.
      if (action.verb === "set_spell_trap") {
        const source = ["deck", "hand"].filter(zone => action.from.includes(zone as "deck" | "hand"));
        if (source.length) retain({ score: 140, label: effect.actions.some(event => event.verb === "excavate")
          ? "Sets an excavated Trap from your Deck"
          : `Sets ${trapNoun(filter)} from your ${source.map(zone => zone === "deck" ? "Deck" : "hand").join(" or ")}` });
        else if (action.from.includes("gy")) retain({ score: 115, label: `Re-Sets ${trapNoun(filter)} from your GY` });
      } else if (action.from.includes("deck")) {
        // Excavation/top-card luck is not a search for the required Trap.
        if (effect.actions.some(event => event.verb === "excavate") || /(?:excavate|top \d*\s*cards? of)/.test(printed)) continue;
        retain({ score: 140, label: `Adds ${trapNoun(filter)} from your Deck to your hand` });
      } else if (action.from.includes("gy")) {
        const tributes = action.note?.match(/if (\d+) Tributed/i)?.[1];
        retain({ score: 110, label: tributes ? `Tributes ${tributes} monsters to return ${trapNoun(filter)} from GY to hand`
          : `Returns ${trapNoun(filter)} from your GY to your hand` });
      }
    }
    const activation = effect.triggers.find(event => event.verb === "activate" && event.player === "you"
      && event.what.kinds.includes("trap") && event.what.subtypes.includes("normal") && reachesTrap(event.what, targets));
    if (!activation) continue;
    // Re-Setting a named Trap after activation is checked as a resource above;
    // it must not qualify a second time as an unrestricted activation payoff.
    const payoff = effect.actions.find(action => ["draw", "special_summon"].includes(action.verb) && action.player !== "opponent"
      && !unsupportedGate(action.note ?? ""));
    if (!payoff) continue;
    const label = payoff.verb === "draw" ? "Draws when you activate a Normal Trap"
      : `Summons ${payoff.what.types[0] ? `a ${payoff.what.types[0]}` : "a monster"} after a Normal Trap`;
    retain({ score: 140, label });
  }
  return best;
}

/** A removal hook must describe the field-removal action, not an unrelated
 * cost (e.g. Dogmatika Punishment's Extra Deck send) or the profile's name. */
export function trapRemovalReason(action: MatchEvent): string {
  const targets = action.what.kinds.includes("monster") ? "monsters" : "cards";
  return ({ destroy: `Destroys ${targets} on the field`, banish: `Banishes ${targets} from the field`,
    return_to_hand: `Returns ${targets} from the field to hand`, send_to_gy: `Sends ${targets} from the field to the GY` } as Record<string, string>)[action.verb]!;
}
