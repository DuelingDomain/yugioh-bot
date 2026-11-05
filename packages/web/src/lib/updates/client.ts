import type { ReleasesResponse } from "./types";

/** The releases a signed-in person can read, newest first, and the last version they saw. Null on any failure. */
export async function fetchReleases(signal?: AbortSignal): Promise<ReleasesResponse | null> {
  try {
    const res = await fetch("/api/releases", { cache: "no-store", signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ReleasesResponse> | null;
    if (!body || !Array.isArray(body.releases)) return null;
    return { releases: body.releases, lastSeenVersion: typeof body.lastSeenVersion === "string" ? body.lastSeenVersion : null };
  } catch {
    return null;
  }
}

/** Tell the server this person saw `version`. The server only moves the mark forward. Failure is silent. */
export async function markReleaseSeen(version: string): Promise<boolean> {
  try {
    const res = await fetch("/api/releases/seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
