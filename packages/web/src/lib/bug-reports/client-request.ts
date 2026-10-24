import type { RefreshSessionToken } from "@/components/auth/session-token";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

function needsSession(response: Response): boolean {
  // Fetches must not follow Clerk's navigation handshake and replay report text there.
  return response.status === 401 || response.type === "opaqueredirect"
    || (response.status >= 300 && response.status < 400);
}

/** Refresh is not abortable in Clerk; stop waiting when the report times out or closes. */
async function refreshWithinSignal(refresh: RefreshSessionToken, signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      refresh(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Only an auth refusal is retried, once, with the exact same serialized report. */
export async function requestBugReport(
  path: "/api/bug-reports" | "/api/bug-reports/precheck",
  payload: unknown,
  signal: AbortSignal,
  refresh: RefreshSessionToken,
): Promise<Response> {
  const init: RequestInit = {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload), signal, redirect: "manual", cache: "no-store",
  };
  let response = await fetch(path, init);
  if (!needsSession(response)) return response;
  let token: string | null;
  try {
    token = await refreshWithinSignal(refresh, signal);
  } catch (error) {
    // Only missing/rejected sessions mean sign-out; other Clerk failures are unavailable auth.
    if (isClerkAPIResponseError(error) && error.status >= 400 && error.status <= 599) {
      return new Response(null, { status: error.status === 401 || error.status === 404 ? 401 : 503,
        headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined });
    }
    throw error;
  }
  signal.throwIfAborted();
  if (token) {
    response = await fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    if (!needsSession(response)) return response;
  }
  return new Response(null, { status: 401 });
}
