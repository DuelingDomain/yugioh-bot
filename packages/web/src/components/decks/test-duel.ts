import type { DuelDeck, DuelMode, GenesysSettings } from "@yugidraft/shared/duels";

/**
 * What the deck editor keeps in the browser around a test duel: the last Shuffle / Go first choice, the deck as it was
 * when the player left (unsaved edits included), and where the duel sends the player back to.
 */

export interface TestDuelPrefs {
  shuffle: boolean;
  goFirst: boolean;
}

export const DEFAULT_TEST_DUEL_PREFS: TestDuelPrefs = { shuffle: true, goFirst: true };

const PREFS_KEY = "deck-test-duel:prefs:v1";
const DRAFT_PREFIX = "deck-test-duel:draft:v1:";
const RETURN_PREFIX = "deck-test-duel:return:v1:";
/** A draft older than this is dropped: the duel is long over and the saved deck is the better truth. */
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
const EDITOR_PATH = /^\/decks\/(?:new|\d+)$/;
/** The duel sends the player back to the editor with this query. Only then is a kept copy restored. */
export const TEST_DUEL_RETURN_QUERY = "from=test-duel";

export interface TestDuelDraft {
  name: string;
  mode: DuelMode;
  genesys: GenesysSettings | null;
  deck: DuelDeck;
  masterOrigin: { section: "main" | "extra" | "side"; index: number } | null;
  /** The snapshot the saved deck had; null for a deck that was never saved. */
  baseline: string | null;
  savedId: number | null;
  registration: unknown;
}

export function loadTestDuelPrefs(): TestDuelPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<TestDuelPrefs> | null;
    return {
      shuffle: typeof raw?.shuffle === "boolean" ? raw.shuffle : DEFAULT_TEST_DUEL_PREFS.shuffle,
      goFirst: typeof raw?.goFirst === "boolean" ? raw.goFirst : DEFAULT_TEST_DUEL_PREFS.goFirst,
    };
  } catch {
    return DEFAULT_TEST_DUEL_PREFS;
  }
}

export function saveTestDuelPrefs(prefs: TestDuelPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* A blocked store only loses the memory of the choice. */
  }
}

/** The editor path a test duel returns to, or null when the value is not an editor page. */
export function editorReturnPath(value: string | null | undefined): string | null {
  return value != null && EDITOR_PATH.test(value) ? value : null;
}

/** True when this editor visit is the way back from a test duel. */
export function cameBackFromTestDuel(search: string): boolean {
  return new URLSearchParams(search).get("from") === "test-duel";
}

/** The copy belongs to one signed-in user: a shared browser never shows it to another account. */
const draftKey = (viewerId: number, path: string) => `${DRAFT_PREFIX}${viewerId}:${path}`;

/** Keeps the editor state for `path`. Returns false when the browser refuses to store it. */
export function saveTestDuelDraft(viewerId: number, path: string, draft: TestDuelDraft): boolean {
  try {
    window.localStorage.setItem(draftKey(viewerId, path), JSON.stringify({ savedAt: Date.now(), draft }));
    return true;
  } catch {
    return false;
  }
}

/** Reads the kept editor state for `path` once and removes it. */
export function takeTestDuelDraft(viewerId: number, path: string): TestDuelDraft | null {
  try {
    const key = draftKey(viewerId, path);
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    window.localStorage.removeItem(key);
    const parsed = JSON.parse(raw) as { savedAt?: unknown; draft?: Partial<TestDuelDraft> };
    const draft = parsed.draft;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > DRAFT_TTL_MS) return null;
    if (!draft || typeof draft.name !== "string" || typeof draft.mode !== "string") return null;
    const deck = draft.deck;
    if (!deck || !Array.isArray(deck.main) || !Array.isArray(deck.extra) || !Array.isArray(deck.side)) return null;
    return {
      name: draft.name,
      mode: draft.mode,
      genesys: draft.genesys ?? null,
      deck,
      masterOrigin: draft.masterOrigin ?? null,
      baseline: typeof draft.baseline === "string" ? draft.baseline : null,
      savedId: typeof draft.savedId === "number" ? draft.savedId : null,
      registration: draft.registration,
    };
  } catch {
    return null;
  }
}

export function rememberTestDuelReturn(slug: string, path: string): void {
  try {
    window.localStorage.setItem(RETURN_PREFIX + slug, JSON.stringify({ savedAt: Date.now(), path }));
  } catch {
    /* Without it the duel sends the player to the deck list. */
  }
}

/** Where the test duel `slug` sends the player when it ends: the editor page it started from (marked as a return), or the deck list. */
export function testDuelReturnPath(slug: string): string {
  try {
    const raw = window.localStorage.getItem(RETURN_PREFIX + slug);
    const parsed = raw ? (JSON.parse(raw) as { savedAt?: unknown; path?: unknown }) : null;
    if (parsed && typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt <= DRAFT_TTL_MS) {
      const path = editorReturnPath(typeof parsed.path === "string" ? parsed.path : null);
      if (path) return `${path}?${TEST_DUEL_RETURN_QUERY}`;
    }
  } catch {
    /* Fall through to the deck list. */
  }
  return "/decks";
}

/** Drops kept copies and return notes that are past their time, whoever they belong to. */
export function pruneTestDuelStorage(): void {
  try {
    const store = window.localStorage;
    for (let index = store.length - 1; index >= 0; index--) {
      const key = store.key(index);
      if (key == null || !(key.startsWith(DRAFT_PREFIX) || key.startsWith(RETURN_PREFIX))) continue;
      let savedAt: unknown = null;
      try { savedAt = (JSON.parse(store.getItem(key) ?? "null") as { savedAt?: unknown } | null)?.savedAt; } catch { /* Unreadable: drop it. */ }
      if (typeof savedAt !== "number" || Date.now() - savedAt > DRAFT_TTL_MS) store.removeItem(key);
    }
  } catch {
    /* A blocked store has nothing to clean. */
  }
}

export function forgetTestDuelReturn(slug: string): void {
  try {
    window.localStorage.removeItem(RETURN_PREFIX + slug);
  } catch {
    /* Nothing to remove. */
  }
}
