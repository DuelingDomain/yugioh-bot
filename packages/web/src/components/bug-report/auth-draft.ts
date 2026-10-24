import { BUG_TEXT_MAX } from "@/lib/bug-report";

const KEY = "bug-report-auth-draft";
const MAX_AGE_MS = 30 * 60_000;
type Draft = { description: string; expected: string };

/** Only this user's text in this tab and page while re-authenticating. Never store board data or tokens. */
export function saveAuthDraft(draft: Draft, userId: string | null) {
  if (!userId) { clearAuthDraft(); return; }
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...draft, userId, path: window.location.pathname, at: Date.now() })); }
  catch { /* The open dialog still retains its text when storage is unavailable. */ }
}

export function readAuthDraft(userId: string | null): Draft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (userId && draft && draft.userId === userId && draft.path === window.location.pathname && typeof draft.at === "number"
      && Date.now() - draft.at >= 0 && Date.now() - draft.at <= MAX_AGE_MS
      && typeof draft.description === "string" && draft.description.length <= BUG_TEXT_MAX
      && typeof draft.expected === "string" && draft.expected.length <= BUG_TEXT_MAX) return draft;
  } catch { /* Storage can be disabled or an old value can be invalid. */ }
  clearAuthDraft();
  return null;
}

export function clearAuthDraft() {
  try { sessionStorage.removeItem(KEY); } catch { /* Storage can be disabled. */ }
}
