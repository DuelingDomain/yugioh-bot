import {
  isEffectMonster,
  isExtraDeckMonster,
  isMonster,
  isNormalMonster,
  isSpell,
  isTrap,
  tributeTierForLevel,
  type CardSummary,
  type TributeTier,
} from "@/lib/card-types";

export type PoolFilter = "all" | "effect" | "normal" | "extra" | "spell" | "trap";
export type PoolSort = "newest" | "oldest" | "name" | "type";
export type PoolTribute = "any" | TributeTier;

export const FILTER_OPTIONS: Array<{ value: PoolFilter; label: string }> = [
  { value: "all", label: "All cards" },
  { value: "effect", label: "Effect Monsters" },
  { value: "normal", label: "Normal Monsters" },
  { value: "extra", label: "Extra deck" },
  { value: "spell", label: "Spells" },
  { value: "trap", label: "Traps" },
];

export const TRIBUTE_OPTIONS: Array<{ value: PoolTribute; label: string }> = [
  { value: "any", label: "Any tributes" },
  { value: "none", label: "No tributes" },
  { value: "one", label: "1 tribute" },
  { value: "two", label: "2 tributes" },
];

export const SORT_OPTIONS: Array<{ value: PoolSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name" },
  { value: "type", label: "Type" },
];

export interface PoolView {
  search: string;
  filter: PoolFilter;
  tribute: PoolTribute;
  sort: PoolSort;
}

export const DEFAULT_VIEW: PoolView = { search: "", filter: "all", tribute: "any", sort: "newest" };

/** The pool's cards are in the order they were added (oldest first). */
export function viewPool(cards: readonly CardSummary[], view: PoolView): CardSummary[] {
  const needle = view.search.trim().toLowerCase();
  let list = cards.filter((card) => {
    const matchSearch = needle.length === 0 || card.name.toLowerCase().includes(needle);
    const matchFilter =
      view.filter === "all" ||
      (view.filter === "effect" && isEffectMonster(card)) ||
      (view.filter === "normal" && isNormalMonster(card)) ||
      (view.filter === "extra" && isExtraDeckMonster(card)) ||
      (view.filter === "spell" && isSpell(card.type)) ||
      (view.filter === "trap" && isTrap(card.type));
    const matchTribute = view.tribute === "any" || tributeTierForLevel(card.level) === view.tribute;
    return matchSearch && matchFilter && matchTribute;
  });
  if (view.sort === "newest") list = [...list].reverse();
  else if (view.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else if (view.sort === "type") {
    const order = (c: CardSummary) => (isMonster(c.type) ? 0 : isSpell(c.type) ? 1 : isTrap(c.type) ? 2 : 3);
    list = [...list].sort((a, b) => order(a) - order(b));
  }
  return list;
}

export function viewIsDefault(view: PoolView): boolean {
  return view.search === "" && view.filter === "all" && view.tribute === "any" && view.sort === "newest";
}
