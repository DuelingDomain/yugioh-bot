export interface ClerkUserJson {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  external_id: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string; verification: { status: string } | null }[];
  external_accounts: { provider: string; provider_user_id: string; verification: { status: string } | null }[];
}

export interface ClerkWaitlistEntryJson { id: string; email_address: string; status: string }

export class ClerkBackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "ClerkBackendError";
  }
  get retryable(): boolean { return this.status === 0 || this.status === 429 || this.status >= 500; }
}

export interface ClerkBackend {
  getUser(clerkUserId: string): Promise<ClerkUserJson>;
  listUsers(query: { externalId?: string; emailAddress?: string; username?: string }): Promise<ClerkUserJson[]>;
  createUser(input: { emailAddress: string; username: string; externalId: string; skipPasswordRequirement: true; skipLegalChecks?: boolean }): Promise<ClerkUserJson>;
  updateUserExternalId(clerkUserId: string, externalId: string): Promise<ClerkUserJson>;
  createWaitlistEntry(input: { emailAddress: string; notify: boolean }): Promise<ClerkWaitlistEntryJson>;
  listWaitlistEntries(query: { query?: string; status?: string; offset?: number; limit?: number }): Promise<{ data: ClerkWaitlistEntryJson[]; totalCount: number }>;
  /** DELETE /users/{id}. A 404 means the user is already gone and resolves like a success. */
  deleteUser(clerkUserId: string): Promise<void>;
}

export function createClerkBackend(opts: { secretKey: string; apiUrl?: string; fetch?: typeof fetch; timeoutMs?: number }): ClerkBackend {
  const apiUrl = (opts.apiUrl ?? "https://api.clerk.com/v1").replace(/\/+$/, "");
  const fetcher = opts.fetch ?? globalThis.fetch;
  const redact = (value: string) => opts.secretKey ? value.split(opts.secretKey).join("[redacted]") : value;

  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
    try {
      const response = await fetcher(`${apiUrl}${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${opts.secretKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { errors?: { code?: unknown; message?: unknown }[] } | null;
        if (controller.signal.aborted) throw new ClerkBackendError("Clerk request timed out", 0, null, null);
        const first = payload?.errors?.[0];
        const retryAfter = response.status === 429 ? response.headers.get("Retry-After") : null;
        const seconds = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : NaN;
        throw new ClerkBackendError(
          redact(typeof first?.message === "string" ? first.message : `Clerk request failed (${response.status})`),
          response.status,
          typeof first?.code === "string" ? redact(first.code) : null,
          Number.isFinite(seconds) ? seconds * 1000 : null,
        );
      }
      // A deleted-object body is informational; an empty 2xx body must not turn a delete into a failure.
      if (method === "DELETE") return await response.json().catch(() => ({})) as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ClerkBackendError) throw error;
      // Transport exceptions may echo headers; never retain their message/cause.
      throw new ClerkBackendError(controller.signal.aborted ? "Clerk request timed out" : "Clerk request failed", 0, null, null);
    } finally {
      clearTimeout(timer);
    }
  }

  function queryPath(path: string, params: URLSearchParams): string {
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }

  return {
    getUser(clerkUserId) { return request(`/users/${encodeURIComponent(clerkUserId)}`); },
    async listUsers(query) {
      // Clerk's own SDK repeats the plain snake_case key for array filters.
      const params = new URLSearchParams();
      if (query.externalId !== undefined) params.append("external_id", query.externalId);
      if (query.emailAddress !== undefined) params.append("email_address", query.emailAddress);
      if (query.username !== undefined) params.append("username", query.username);
      const users = await request<ClerkUserJson[]>(queryPath("/users", params));
      // Never trust an ignored filter: keep only exact matches for every filter given.
      const email = query.emailAddress?.trim().toLowerCase();
      return users.filter(user =>
        (query.externalId === undefined || user.external_id === query.externalId)
        && (email === undefined || user.email_addresses.some(address => address.email_address.trim().toLowerCase() === email))
        && (query.username === undefined || user.username?.toLowerCase() === query.username.toLowerCase()));
    },
    createUser(input) {
      return request("/users", "POST", {
        email_address: [input.emailAddress], username: input.username, external_id: input.externalId,
        skip_password_requirement: input.skipPasswordRequirement,
        ...(input.skipLegalChecks === undefined ? {} : { skip_legal_checks: input.skipLegalChecks }),
      });
    },
    async deleteUser(clerkUserId) {
      try { await request(`/users/${encodeURIComponent(clerkUserId)}`, "DELETE"); }
      catch (error) { if (!(error instanceof ClerkBackendError) || error.status !== 404) throw error; }
    },
    updateUserExternalId(clerkUserId, externalId) { return request(`/users/${encodeURIComponent(clerkUserId)}`, "PATCH", { external_id: externalId }); },
    createWaitlistEntry(input) { return request("/waitlist_entries", "POST", { email_address: input.emailAddress, notify: input.notify }); },
    async listWaitlistEntries(query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value !== undefined) params.append(key, String(value));
      const result = await request<{ data: ClerkWaitlistEntryJson[]; total_count: number }>(queryPath("/waitlist_entries", params));
      return { data: result.data, totalCount: result.total_count };
    },
  };
}
