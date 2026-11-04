import { ATTRIBUTES, MONSTER_TYPES, type Card } from "../cards/effects/card.js";
import { archetypeMember } from "../cards/effects/archetype-roles.js";
import { filterReachesCard } from "../cards/effects/synergy.js";
import { NO_FILTER, type CardFilter, type CardTags } from "../cards/effects/tags.js";

export type RemoteEffectSource = { cardId: number; name: string; cardRef?: string };
export type RemoteEffectCandidate = { cardId: number; copyKey: number; name: string; copies: number };
export const REMOTE_SEARCH_SOURCE_ZONES = {deck:'deck',gy:'graveyard',banish:'banished'} as const;
export type RemoteSearchSource = keyof typeof REMOTE_SEARCH_SOURCE_ZONES;
export type RemoteEffectPlan = {
  source: RemoteSearchSource; destination: "set" | "hand"; filters: CardFilter[]; excludedNames: string[];
  minimumCopies: number; announceRecommended: boolean; derivedFrom: "effect-index" | "text" | "fallback";
  pool: RemoteEffectCandidate[];
};
const empty = (): CardFilter => structuredClone(NO_FILTER);
const normalize = (value: string) => value.replace(/[“”]/g, '"').replace(/\bTraps\b/g, "Trap").replace(/\bSpells\b/g, "Spell");

/** Read the moved object, not costs or unrelated sentences elsewhere on the card. */
function textFilter(clause: string, source: RemoteSearchSource): { filter: CardFilter; certain: boolean } {
  const place = {deck:'Deck',gy:'(?:GY|Graveyard)',banish:'banishment'}[source];
  const verbs = source==='deck' ? 'set|add|take|reveal|banish|choose|select|special summon' : 'add';
  const descriptor = clause.match(new RegExp(`(?:${verbs})\\s+(?:up to\\s+)?\\d+\\s+(.+?)\\s+(?:directly\\s+)?from\\s+(?:your\\s+|the\\s+)?${place}`, 'i'))?.[1] ??
    (source!=='deck' && /;\s*add\s+(?:it|them|that (?:target|card))\b/i.test(clause)
      ? clause.match(new RegExp(`target\\s+(?:up to\\s+)?\\d+\\s+(.+?)\\s+in\\s+(?:your\\s+|the\\s+)?${place}`, 'i'))?.[1] ??
        (source==='banish' ? clause.match(/target\s+\d+\s+(?:of your|your) banished (.+?);/i)?.[1] : undefined) : undefined) ?? "";
  const filter = empty();
  const facetWords=descriptor.replace(/"[^"]*"/g, "");
  if (/\bspell\b/i.test(facetWords)) filter.kinds.push("spell");
  if (/\btrap\b/i.test(facetWords)) filter.kinds.push("trap");
  if (/\bmonsters?\b/i.test(facetWords)) filter.kinds.push("monster");
  for (const [pattern, subtype] of [[/\bnormal\b/i,"normal"], [/\bcontinuous\b/i,"continuous"], [/quick[- ]play/i,"quick_play"], [/\bfield\b/i,"field"], [/\bequip\b/i,"equip"], [/\bcounter\b/i,"counter"]] as const)
    if (pattern.test(facetWords)) filter.subtypes.push(subtype);
  for (const attribute of ATTRIBUTES) if (new RegExp(`\\b${attribute}\\b`, "i").test(facetWords)) filter.attributes.push(attribute);
  let raceWords=facetWords;
  for (const race of [...MONSTER_TYPES].sort((a,b)=>b.length-a.length)) {
    const pattern=new RegExp(`\\b${race.replaceAll("-", "[- ]")}\\b`,"i");
    if(pattern.test(raceWords)) {filter.types.push(race);raceWords=raceWords.replace(pattern,"");}
  }
  const level = facetWords.match(/level\s+(\d+)(?:\s+or\s+(lower|less|higher|more))?/i);
  if (level) {
    if (!level[2] || /higher|more/i.test(level[2])) filter.level_min = Number(level[1]);
    if (!level[2] || /lower|less/i.test(level[2])) filter.level_max = Number(level[1]);
  }
  for (const quote of descriptor.matchAll(/"([^"]+)"/g)) filter.archetypes.push(quote[1]);
  const atk = facetWords.match(/\d+ or (?:less|lower) ATK/i)?.[0];
  if (atk) filter.other = atk;
  return { filter, certain: !!descriptor && !!(filter.kinds.length || filter.archetypes.length) };
}

/** Existing effect-search events carry the movement source and CardFilter. Text supplies exclusions,
 * same-name copy requirements and a conservative fallback when a card has no indexed reading. */
export function deriveRemoteEffectPlans(source: Card, tags?: CardTags): Omit<RemoteEffectPlan, "pool">[] {
  const text = normalize(source.text);
  const clauses = text.split(/(?<=[.!])\s+|\r?\n/);
  const result: Omit<RemoteEffectPlan, "pool">[] = [];
  for (const destination of ["set", "hand"] as const) for (const searchSource of ['deck','gy','banish'] as const) {
    if(destination==='set' && searchSource!=='deck') continue;
    const indexedSource=searchSource==='banish' ? 'banished' : searchSource;
    const indexed = tags?.effects.flatMap(effect => effect.actions.flatMap(event => {
      const search=effect.actions.find(a=>a.verb==="add_to_hand" && a.from.includes("deck") && a.player!=="opponent");
      const addThenSet=destination==="set" && event.from.includes("hand") && search;
      if(event.what.this_card || event.player==="opponent" || (!event.from.includes(indexedSource) && !addThenSet)) return [];
      if(destination==="hand" ? event.verb!=="add_to_hand" : event.verb!=="set_spell_trap" &&
        !(["special_summon","place_on_field"].includes(event.verb) && /face[- ]down/i.test(text))) return [];
      const filter=structuredClone(event.what);
      if(addThenSet && search) {
        for(const key of ["kinds","subtypes","types","attributes","archetypes","names"] as const)
          if(!filter[key].length) (filter[key] as string[])=[...search.what[key]];
        filter.level_min=Math.max(filter.level_min,search.what.level_min);
        filter.level_max=Math.min(filter.level_max || Infinity,search.what.level_max || Infinity);
        if(!Number.isFinite(filter.level_max)) filter.level_max=0;
        filter.other=[filter.other,search.what.other].filter(Boolean).join("; ");
      }
      return [filter];
    })) ?? [];
    const relevant = clauses.filter(clause => (searchSource==='deck' ? /\bDeck\b/i.test(clause) : textFilter(clause,searchSource).certain) && (destination === "set"
      ? /\bSet\s+\d|\bto\s+Set\b|place.+face[- ]down|special summon.+face[- ]down/i.test(clause)
      : /\badd\b.+\bhand\b/i.test(clause)));
    if (!indexed.length && !relevant.length) continue;
    const textReadings = relevant.map(clause=>textFilter(clause,searchSource));
    let filters = indexed.length ? structuredClone(indexed) : textReadings.filter(r=>r.certain).map(r=>r.filter);
    if(indexed.length && textReadings.length===1 && textReadings[0].certain) {
      const printed=textReadings[0].filter;
      for(const filter of filters) {
        for(const key of ["kinds","subtypes","types","attributes","archetypes","names"] as const)
          if(!filter[key].length) (filter[key] as string[])=[...printed[key]];
        filter.level_min=Math.max(filter.level_min,printed.level_min);
        filter.level_max=Math.min(filter.level_max || Infinity,printed.level_max || Infinity);
        if(!Number.isFinite(filter.level_max)) filter.level_max=0;
        filter.other=[filter.other,printed.other].filter(Boolean).join("; ");
      }
    }
    const fallback = !filters.length;
    if (fallback) { const filter=empty(); if(destination === "set") filter.kinds=["spell","trap"]; filters=[filter]; }
    // Some old facets omit the object of a same-name Set. The immediately preceding Deck object supplies it.
    if (destination === "set" && filters.every(f=>!f.kinds.length && !f.archetypes.length && !f.names.length) && textReadings.some(r=>r.certain))
      filters=textReadings.filter(r=>r.certain).map(r=>r.filter);
    result.push({ source:searchSource, destination, filters, excludedNames: [...text.matchAll(/except\s+"([^"]+)"/gi)].map(m=>m[1]),
      minimumCopies: destination === "set" && /banish.+Deck.+Set.+same name/i.test(relevant.join(" ")) ? 2 : 1,
      announceRecommended: destination === "hand" && !/do not (?:have to )?reveal|without revealing/i.test(relevant.join(" ")),
      derivedFrom: indexed.length ? "effect-index" : fallback ? "fallback" : "text" });
  }
  return result;
}
export function remoteEffectMatches(plan: Pick<RemoteEffectPlan,"filters"|"excludedNames">, card: Card): boolean {
  return !plan.excludedNames.some(name=>name.toLowerCase()===card.name.toLowerCase()) && plan.filters.some(filter=>filterReachesCard(filter,card) || (filter.archetypes.some(name=>archetypeMember(card,name)) && filterReachesCard({...filter,archetypes:[]},card)));
}
