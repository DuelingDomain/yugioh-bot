import { isExtraDeckCard, type Card } from "./card.js";
import { NO_FILTER, type CardFilter } from "./tags.js";
import { matchesBridgeFilter } from "./bridge-text.js";
import type { BridgeFormat } from "./bridge-types.js";

/** Complete, deliberately narrow material procedures. Unsupported procedures fail closed. */
export function bridgeMaterials(extra: Card, source: readonly Card[], format: BridgeFormat = "advanced"): number[] | null {
  const line = extra.text.split(/[\r\n]/)[0]!.trim();
  const procedure = extra.subtypes.find(type => ["link", "synchro", "xyz", "fusion"].includes(type));
  const monsters = source.filter(card => card.kind === "monster" && !isExtraDeckCard(card)
    && !new RegExp(`cannot be used as (?:a |an? )?${procedure} Material`, "i").test(card.text));
  if (extra.subtypes.includes("link") && extra.linkRating === 1) {
    const match = /^1 (?:Level (\d+) or lower )?([A-Za-z -]+?)(?: monster)?$/i.exec(line);
    if (!match) return null;
    const allowed = match[2]!.replace(/ monster$/i, "").split(/ or /i);
    const chosen = monsters.find(card => (!match[1] || card.level !== undefined && card.level <= +match[1])
      && (allowed.includes(card.monsterType ?? "") || allowed.length === 1 && allowed[0]!.toLowerCase() === "effect" && card.subtypes.includes("effect")));
    return chosen ? [chosen.id] : null;
  }
  const xyz = /^(\d+) Level (\d+)(?: ([A-Za-z -]+))? monsters$/i.exec(line);
  if (extra.subtypes.includes("xyz") && xyz && +xyz[1]! <= 3) {
    const filter: CardFilter = { ...NO_FILTER, level_min: +xyz[2]!, level_max: +xyz[2]! };
    const bodies = monsters.filter(card => matchesBridgeFilter(filter, card)
      && (!xyz[3] || xyz[3] === card.monsterType || xyz[3] === card.attribute));
    const copies = bodies.flatMap(card => Array(format === "genesys" ? 3 : card.banTcg === "Limited" ? 1 : card.banTcg === "Semi-Limited" ? 2 : 3).fill(card.id) as number[]);
    return copies.length >= +xyz[1]! ? copies.slice(0, +xyz[1]!) : null;
  }
  if (extra.subtypes.includes("synchro") && /^1 Tuner \+ 1(?:\+| or more)? non-Tuner monsters?$/i.test(line)) {
    for (const tuner of monsters.filter(card => card.subtypes.includes("tuner"))) {
      const non = monsters.find(card => !card.subtypes.includes("tuner") && card.level && tuner.level && card.level + tuner.level === extra.level);
      if (non) return [tuner.id, non.id];
    }
  }
  return null;
}
