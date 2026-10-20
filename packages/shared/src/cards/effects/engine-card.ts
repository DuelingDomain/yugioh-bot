import { CARD_ATTRIBUTES, CARD_TYPE_BITS as T, inArchetype, type DeckCardInfo } from "../../duels/card-query.js";
import { MONSTER_TYPES, type Card, type Subtype } from "./card.js";

const subtypeBits: Array<[Subtype, number]> = [
  ["normal", T.normal], ["effect", T.effect], ["ritual", T.ritual], ["fusion", T.fusion],
  ["synchro", T.synchro], ["xyz", T.xyz], ["link", T.link], ["pendulum", T.pendulum],
  ["tuner", T.tuner], ["flip", T.flip], ["gemini", T.gemini], ["union", T.union], ["spirit", T.spirit],
  ["toon", T.toon], ["token", T.token], ["field", T.field], ["equip", T.equip],
  ["continuous", T.continuous], ["quick_play", T.quickPlay], ["counter", T.counter],
];

/** Small metadata adapter; card text and names continue to come from our engine catalog. */
export function engineInsightCard(card: DeckCardInfo, archetypes: ReadonlyMap<number, string> = new Map(), popularity = 0): Card {
  const race = (card.race ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  const monsterType = MONSTER_TYPES.find(type => type.replace(/[^a-z]/gi, "").toLowerCase() === race);
  const attribute = CARD_ATTRIBUTES.find(value => value.bit === card.attribute)?.label.toUpperCase() as Card["attribute"];
  const subtypes = subtypeBits.filter(([, bit]) => (card.type & bit) !== 0).map(([type]) => type);
  if ((card.type & (T.spell | T.trap)) && subtypes.length === 0) subtypes.push("normal");
  return {
    id: card.canonicalPasscode ?? card.code, name: card.name, prerelease: card.prerelease, dateSearchEligible: (card.ot & 3) !== 0 && (card.ot & 0x600) === 0,
    kind: card.type & T.spell ? "spell" : card.type & T.trap ? "trap" : "monster",
    typeLine: "", subtypes,
    monsterType, attribute, level: card.type & (T.xyz | T.link) ? undefined : card.level,
    rank: card.type & T.xyz ? card.level : undefined, linkRating: card.type & T.link ? card.level : undefined,
    atk: card.attack >= 0 ? card.attack : null, def: card.defense >= 0 ? card.defense : null,
    text: card.description, archetype: [...archetypes].find(([code]) => inArchetype(card.setcodes, code))?.[1],
    genesysPoints: card.genesysPoints ?? undefined, formats: [], views: popularity, url: "",
  };
}
