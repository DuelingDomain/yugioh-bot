import type { AdminRelease, AdminReleasesResponse, EmailPreview, EmailSendState, ReleaseDraftInput } from "./types";

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string | null };

/** Same-origin JSON request to the owner-only release routes. The browser adds Origin; the routes check it on writes. */
async function call<T>(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<AdminResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const parsed: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: parsed as T };
    const error = parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string" ? (parsed as { error: string }).error : null;
    return { ok: false, status: res.status, error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

const base = "/api/admin/console/releases";

export const listReleases = () => call<AdminReleasesResponse>(base, "GET");
export const createRelease = (input: ReleaseDraftInput) => call<AdminRelease | { release: AdminRelease }>(base, "POST", input);
export const saveRelease = (id: string, input: ReleaseDraftInput) => call<AdminRelease | { release: AdminRelease }>(`${base}/${encodeURIComponent(id)}`, "PATCH", input);
export const publishRelease = (id: string, autoEmail: boolean) => call<unknown>(`${base}/${encodeURIComponent(id)}/publish`, "POST", { autoEmail });
export const previewEmail = (id: string) => call<EmailPreview>(`${base}/${encodeURIComponent(id)}/email/preview`, "POST", {});
export const sendEmail = (id: string, token: string) => call<EmailSendState>(`${base}/${encodeURIComponent(id)}/email/send`, "POST", { token });

/** A create or edit answer is the release itself, or `{ release }`. */
export function releaseFrom(data: AdminRelease | { release: AdminRelease }): AdminRelease | null {
  const found = "release" in data ? data.release : data;
  return found && typeof found === "object" && "id" in found ? found : null;
}
