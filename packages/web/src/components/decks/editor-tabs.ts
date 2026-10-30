import { readStore, writeStore } from "@/components/bridges/bridges-model";

/**
 * The tabs of the deck editor. A phone has all four; a desktop has the three of the right column, and
 * "deck" there means the column's first tab (the deck is always on screen).
 */
export type EditorTab = "deck" | "cards" | "suggest" | "bridges";
/** A tab of the right column. */
export type ColumnTab = Exclude<EditorTab, "deck">;

export const EDITOR_TAB_ORDER: readonly EditorTab[] = ["deck", "cards", "suggest", "bridges"];

export const TAB_LABELS: Record<EditorTab, string> = { deck: "Deck", cards: "Cards", suggest: "Suggest", bridges: "Bridges" };

const STORE_KEY = "deck-editor:tab";

/** The tab this viewer used last, or null: a first visit, or storage that is blocked. */
export function readLastTab(): EditorTab | null {
  const kept = readStore("local", STORE_KEY);
  return EDITOR_TAB_ORDER.find((tab) => tab === kept) ?? null;
}

export function rememberTab(tab: EditorTab): void {
  writeStore("local", STORE_KEY, tab);
}

/**
 * The tab that is on screen. A tab that does not exist now (Suggestions are off, a draft pool has no Bridges)
 * falls back to Cards; on a desktop "deck" is Cards too.
 */
export function shownTab(tab: EditorTab, columnTabs: readonly ColumnTab[], phone: boolean): EditorTab {
  if (tab === "deck") return phone ? "deck" : "cards";
  return columnTabs.includes(tab) ? tab : "cards";
}

/** The tab that an arrow key, Home or End asks for in a tab list. Null: the key is not for the list. */
export function tabForKey(tabs: readonly EditorTab[], current: EditorTab, key: string): EditorTab | null {
  const at = Math.max(0, tabs.indexOf(current));
  if (key === "Home") return tabs[0] ?? null;
  if (key === "End") return tabs[tabs.length - 1] ?? null;
  if (key === "ArrowRight") return tabs[(at + 1) % tabs.length] ?? null;
  if (key === "ArrowLeft") return tabs[(at - 1 + tabs.length) % tabs.length] ?? null;
  return null;
}
