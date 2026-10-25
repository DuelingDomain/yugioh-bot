/**
 * Answer floor for public join answers (/api/join/<code>, /api/waitlist). A new email waits for a Clerk call; an email
 * with an account or a live grant does not. Holding every success or retry answer to the same minimum time since the
 * request started keeps one request from telling the two apart.
 *
 * CREATOR_ANSWER_FLOOR_MS (non-negative integer, default 1200) is parsed once per distinct value: once per process in
 * production, and again when a test stubs a new value. Tests set "0".
 */
const DEFAULT_FLOOR_MS = 1200;
let parsed: { raw: string | undefined; ms: number } | null = null;

export function answerFloorMs(): number {
  const raw = process.env.CREATOR_ANSWER_FLOOR_MS;
  if (parsed?.raw !== raw || parsed === null) {
    const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
    parsed = { raw, ms: Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_FLOOR_MS };
  }
  return parsed.ms;
}

/** Waits until at least the floor has passed since `startedAt` (Date.now() at request start). */
export async function waitForAnswerFloor(startedAt: number): Promise<void> {
  const wait = startedAt + answerFloorMs() - Date.now();
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}
