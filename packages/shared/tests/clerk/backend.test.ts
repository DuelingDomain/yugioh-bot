import { afterEach, describe, expect, it, vi } from "vitest";
import { ClerkBackendError, createClerkBackend } from "../../src/clerk/backend.js";

afterEach(() => vi.useRealTimers());
const secretKey = "sk_test_private_value";
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

describe("Clerk Backend REST client", () => {
  it("clears recovery metadata through Clerk's merging metadata endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "user_1", private_metadata: { unrelated: "keep" } }));
    await createClerkBackend({ secretKey, fetch: fetcher }).updateUserMetadata("user/a", { privateMetadata: { existingPlayerDiscordId: null } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.clerk.com/v1/users/user%2Fa/metadata");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ private_metadata: { existingPlayerDiscordId: null } });
  });
  it("maps every method to the REST wire contract", async () => {
    const requests: { url: string; method: string; body: unknown; auth: string | null; contentType: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null,
        auth: new Headers(init?.headers).get("Authorization"), contentType: new Headers(init?.headers).get("Content-Type") });
      if (String(input).includes("/users?")) return json([]);
      return json(String(input).includes("waitlist_entries?") ? { data: [{ id: "wait_1", email_address: "a@example.com", status: "pending" }], total_count: 1 } : { id: "user_1" });
    };
    const client = createClerkBackend({ secretKey, fetch: fetcher });
    expect(await client.getUser("user/a")).toEqual({ id: "user_1" });
    await client.listUsers({ externalId: "7", emailAddress: "a+b@example.com", username: "a_b" });
    await client.createUser({ emailAddress: "a@example.com", username: "a_b", externalId: "7", skipPasswordRequirement: true });
    await client.createUser({ emailAddress: "a@example.com", username: "a_b", externalId: "7", skipPasswordRequirement: true, skipLegalChecks: true });
    await client.updateUserExternalId("user/a", "8");
    await client.createWaitlistEntry({ emailAddress: "a@example.com", notify: true });
    expect(await client.listWaitlistEntries({ query: "a+b@example.com", status: "pending", offset: 0, limit: 10 }))
      .toEqual({ data: [{ id: "wait_1", email_address: "a@example.com", status: "pending" }], totalCount: 1 });
    expect(requests.map(({ auth, contentType, ...request }) => request)).toEqual([
      { url: "https://api.clerk.com/v1/users/user%2Fa", method: "GET", body: null },
      { url: "https://api.clerk.com/v1/users?external_id=7&email_address=a%2Bb%40example.com&username=a_b", method: "GET", body: null },
      { url: "https://api.clerk.com/v1/users", method: "POST", body: { email_address: ["a@example.com"], username: "a_b", external_id: "7", skip_password_requirement: true } },
      { url: "https://api.clerk.com/v1/users", method: "POST", body: { email_address: ["a@example.com"], username: "a_b", external_id: "7", skip_password_requirement: true, skip_legal_checks: true } },
      { url: "https://api.clerk.com/v1/users/user%2Fa", method: "PATCH", body: { external_id: "8" } },
      { url: "https://api.clerk.com/v1/waitlist_entries", method: "POST", body: { email_address: "a@example.com", notify: true } },
      { url: "https://api.clerk.com/v1/waitlist_entries?query=a%2Bb%40example.com&status=pending&offset=0&limit=10", method: "GET", body: null },
    ]);
    for (const request of requests) {
      expect(request.auth).toBe(`Bearer ${secretKey}`);
      if (request.body) expect(request.contentType).toBe("application/json");
    }
  });
  it("preserves listUsers arrays and supports a custom API URL with no empty query marker", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([{ id: "user_1" }]));
    expect(await createClerkBackend({ secretKey, apiUrl: "https://example.com/v1/", fetch: fetcher }).listUsers({}))
      .toEqual([{ id: "user_1" }]);
    expect(fetcher.mock.calls[0][0]).toBe("https://example.com/v1/users");
  });
  it("keeps only exact listUsers matches even if Clerk ignored a filter", async () => {
    const user = (id: string, externalId: string | null, email: string, username: string) => ({ id, username, first_name: null, last_name: null,
      image_url: null, external_id: externalId, primary_email_address_id: "e", email_addresses: [{ id: "e", email_address: email, verification: null }], external_accounts: [] });
    const all = [user("user_1", "7", "a@example.com", "a_b"), user("user_2", "8", "b@example.com", "b_c"), user("user_3", null, "A@Example.com", "A_B")];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(all));
    const client = createClerkBackend({ secretKey, fetch: fetcher });
    expect((await client.listUsers({ externalId: "7" })).map(u => u.id)).toEqual(["user_1"]);
    expect((await client.listUsers({ externalId: "9" })).map(u => u.id)).toEqual([]);
    expect((await client.listUsers({ emailAddress: "a@example.com" })).map(u => u.id)).toEqual(["user_1", "user_3"]);
    expect((await client.listUsers({ username: "a_b" })).map(u => u.id)).toEqual(["user_1", "user_3"]);
  });
  it.each([[404, false], [401, false], [429, true], [500, true], [503, true]])("reports status %i and retryability", async (status, retryable) => {
    const fetcher: typeof fetch = async () => json({ errors: [{ code: "request_failed", message: "Try later" }] }, status, { "Retry-After": "3" });
    const error = await createClerkBackend({ secretKey, fetch: fetcher }).getUser("user_1").catch(error => error);
    expect(error).toBeInstanceOf(ClerkBackendError);
    expect(error).toMatchObject({ status, code: "request_failed", retryable, retryAfterMs: status === 429 ? 3000 : null });
    expect(error.message).toBe("Try later");
  });
  it("handles non-JSON errors and missing retry headers", async () => {
    const fetcher: typeof fetch = async () => new Response("Bad gateway", { status: 429 });
    await expect(createClerkBackend({ secretKey, fetch: fetcher }).getUser("user_1"))
      .rejects.toMatchObject({ status: 429, code: null, retryAfterMs: null, retryable: true });
  });
  it("aborts a stalled request at the configured timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const result = createClerkBackend({ secretKey, fetch: fetcher, timeoutMs: 25 }).getUser("user_1").catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ status: 0, code: null, retryable: true });
  });
  it.each(["remote", "network"])("never exposes the secret in a %s error", async kind => {
    const fetcher: typeof fetch = async () => {
      if (kind === "network") throw new Error(`Authorization: Bearer ${secretKey}`);
      return json({ errors: [{ code: secretKey, message: `Bad ${secretKey}` }] }, 500);
    };
    const error = await createClerkBackend({ secretKey, fetch: fetcher }).getUser("user_1").catch(error => error);
    expect(error).toBeInstanceOf(ClerkBackendError);
    expect(String(error)).not.toContain(secretKey);
    expect(JSON.stringify(error)).not.toContain(secretKey);
    expect(error.stack).not.toContain(secretKey);
  });
  describe("deleteUser", () => {
    it("sends DELETE /users/{id} with the bearer secret and no body", async () => {
      const seen: { url: string; method: string; body: unknown; auth: string | null }[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        seen.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ?? null, auth: new Headers(init?.headers).get("Authorization") });
        return json({ object: "deleted_object", id: "user/a", deleted: true });
      };
      await expect(createClerkBackend({ secretKey, fetch: fetcher }).deleteUser("user/a")).resolves.toBeUndefined();
      expect(seen).toEqual([{ url: "https://api.clerk.com/v1/users/user%2Fa", method: "DELETE", body: null, auth: `Bearer ${secretKey}` }]);
    });
    it("treats a 404 as already deleted", async () => {
      const fetcher: typeof fetch = async () => json({ errors: [{ code: "resource_not_found", message: "Not found" }] }, 404);
      await expect(createClerkBackend({ secretKey, fetch: fetcher }).deleteUser("user_gone")).resolves.toBeUndefined();
    });
    it.each([[401, false], [403, false], [422, false], [429, true], [500, true], [503, true]])("maps status %i to a ClerkBackendError", async (status, retryable) => {
      const fetcher: typeof fetch = async () => json({ errors: [{ code: "request_failed", message: "Nope" }] }, status);
      const error = await createClerkBackend({ secretKey, fetch: fetcher }).deleteUser("user_1").catch(error => error);
      expect(error).toBeInstanceOf(ClerkBackendError);
      expect(error).toMatchObject({ status, retryable });
    });
    it("maps a transport failure to a retryable error without the secret", async () => {
      const fetcher: typeof fetch = async () => { throw new Error(`Bearer ${secretKey}`); };
      const error = await createClerkBackend({ secretKey, fetch: fetcher }).deleteUser("user_1").catch(error => error);
      expect(error).toMatchObject({ status: 0, retryable: true });
      expect(String(error)).not.toContain(secretKey);
    });
  });
});
