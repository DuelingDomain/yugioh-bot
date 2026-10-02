const FAILURE_COOLDOWN_MS = 10_000;

/** Keep polling failures quiet, and never retry before Discord's 429 deadline. */
export async function discordFailureCooldownMs(response?: Response, now = Date.now()): Promise<number> {
  if (response?.status !== 429) return FAILURE_COOLDOWN_MS;
  const retryAfter = response.headers.get("Retry-After");
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  let retryMs = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : retryAfter ? Date.parse(retryAfter) - now : 0;
  try {
    const body = await response.json() as { retry_after?: unknown };
    if (typeof body.retry_after === "number" && Number.isFinite(body.retry_after) && body.retry_after >= 0) {
      retryMs = Math.max(Number.isFinite(retryMs) ? retryMs : 0, body.retry_after * 1000);
    }
  } catch {
    // A missing/malformed body can still carry a valid Retry-After header.
  }
  return Math.max(FAILURE_COOLDOWN_MS, Number.isFinite(retryMs) ? retryMs : 0);
}
