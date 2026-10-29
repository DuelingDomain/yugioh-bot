import type { BridgeJudgeEvidence } from "./bridge-judge.js";

/** Only the first checked edge is established; later Summons may need setup. */
export function deterministicBridgePros(evidence: BridgeJudgeEvidence): string[] {
  const pros: string[] = [];
  for (const reason of evidence.reasons.filter(reason => !reason.ancillary)) {
    const first = reason.steps?.[0];
    const source = evidence.cards.find(card => card.id === (first?.from ?? reason.cards[0]));
    const target = evidence.cards.find(card => card.id === (first?.to ?? reason.cards[1]));
    if (!source || !target) continue;
    const conditions = ", subject to its printed activation conditions.";
    const stats = target.level && target.attribute ? ` (Level ${target.level} ${target.attribute})` : "";
    let text: string | undefined;
    if (reason.key === "rule_enabler") text = `${source.name} allows ${target.name} to be activated the turn it was Set${conditions}`;
    else if (first) {
      const actions: Partial<Record<typeof first.capability, string>> = {
        search: `adds ${target.name}${stats} from the Deck to the hand`,
        special_summon: `can Special Summon ${target.name}`,
        normal_summon: `can Normal Summon ${target.name}`,
        set_spell_trap: `can Set ${target.name}`,
        place_on_field: `can place ${target.name} on the field`,
        send_to_gy: `can send ${target.name} to the GY`, discard: `can discard ${target.name}`,
        banish: `can banish ${target.name}`, tribute: `can Tribute ${target.name}`,
        return_to_hand: `can return ${target.name} to the hand`, return_to_deck: `can return ${target.name} to the Deck`,
      };
      if (actions[first.capability]) text = `${source.name} ${actions[first.capability]}${conditions}`;
    } else if (reason.key === "mention") text = reason.description + ".";
    if (text && text.length <= 500 && !pros.includes(text)) pros.push(text);
  }
  return pros.slice(0, 3);
}
