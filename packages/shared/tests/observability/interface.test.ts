import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpectedError, errorResponseBody, flushObservability, log, redactEvent, redactText, report, setObservabilityAdapter } from "../../src/observability/index.js";
import { consoleAdapter } from "../../src/observability/console-adapter.js";

afterEach(() => { setObservabilityAdapter(consoleAdapter); vi.restoreAllMocks(); });
describe("observability", () => {
  it("defaults to redacted console output", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    report(new Error("email member@example.test"));
    expect(output).toHaveBeenCalled();
    expect(JSON.stringify(output.mock.calls)).not.toContain("member@example.test");
  });
  it("does not forward expected errors and returns safe responses", () => {
    const capture = vi.fn();
    setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
    const error = new ExpectedError("Try again later", 429);
    report(error);
    expect(errorResponseBody(error)).toEqual({ status: 429, body: { error: "Try again later" } });
    expect(capture).not.toHaveBeenCalled();
    const unexpected = new Error("database details");
    expect(errorResponseBody(unexpected)).toEqual({ status: 500, body: { error: "Something went wrong" } });
    expect(capture).toHaveBeenCalledWith(unexpected, {});
  });
  it("adapter throws do not escape reporting or logging", async () => {
    setObservabilityAdapter({ report() { throw new Error("offline"); }, log() { throw new Error("offline"); }, async flush() { throw new Error("offline"); } });
    expect(() => report(new Error("failed"))).not.toThrow();
    expect(() => log("warn", "retry")).not.toThrow();
    await expect(flushObservability()).resolves.toBeUndefined();
  });
  it("caps a flush that never settles", async () => {
    vi.useFakeTimers();
    setObservabilityAdapter({ report() {}, log() {}, flush: () => new Promise(() => {}) });
    const flushed = flushObservability(20);
    await vi.advanceTimersByTimeAsync(20);
    await flushed;
    vi.useRealTimers();
  });
  it.each([
    ["member@example.test", "[redacted]"], ["Bearer abc", "[redacted]"],
    ["sk_live_abcdef", "[redacted]"], ["pk_test_abcdef", "[redacted]"],
    ["sha256=" + "a".repeat(64), "[redacted]"], ["a".repeat(32), "[redacted]"],
    ["SELECT * FROM users WHERE id = 1", "[redacted]"], ["Retry later", "Retry later"],
  ])("redacts text %s", (input, expected) => { expect(redactText(input)).toBe(expected); });
  it("removes private event data without changing its source", () => {
    const event = { message: "member@example.test", user: { id: "4", email: "member@example.test", username: "member" },
      request: { data: "body", cookies: "session", url: "https://example.test/path?token=abc", headers: { Authorization: "abc", Cookie: "abc", "X-Internal-Signature": "abc", accept: "json" } },
      exception: { values: [{ value: "Bearer abc" }] }, breadcrumbs: [{ message: "SELECT * FROM users", data: { email: "member@example.test", token: "abc" } }],
      extra: { discordUserId: "123", title: "title", count: 2 }, tags: { username: "member", service: "worker" } };
    const clean = redactEvent(event);
    expect(clean.request).toEqual({ headers: { accept: "json" } });
    expect(clean.user).toEqual({ id: "4" });
    expect(clean.extra).toEqual({ count: 2 });
    expect(clean.tags).toEqual({ service: "worker" });
    expect(JSON.stringify(clean)).not.toContain("member@example.test");
    expect(clean.exception.values[0].value).toBe("[redacted]");
    expect(clean.breadcrumbs[0].data).toEqual({});
    expect(event.request.data).toBe("body");
  });
});
it("drops secondary identity fields and private URL details", () => {
  const clean = redactEvent({ extra: { playerId: 3, guildId: "g", displayName: "member", card_name: "Card", note: "private note", count: 2 },
    request: { url: "https://example.test/duels/private-room?token=abc", headers: { "set-cookie": "abc", "x-api-key": "abc", accept: "json" } },
    contexts: { nextjs: { request_path: "/duels/private-room", router_path: "/duels/[slug]" } } });
  expect(clean.extra).toEqual({ count: 2 });
  expect(clean.request).toEqual({ headers: { accept: "json" } });
  expect(clean.contexts.nextjs).toEqual({ router_path: "/duels/[slug]" });
});
it("preserves static stack filenames for source map lookup", () => {
  const event = { exception: { values: [{ stacktrace: { frames: [{ filename: "https://example.test/_next/static/chunks/app-123.js", lineno: 10, colno: 2 }] } }] } };
  expect(redactEvent(event).exception.values[0].stacktrace.frames[0]).toEqual({ filename: "https://example.test/_next/static/chunks/app-123.js", lineno: 10, colno: 2 });
});
it("preserves SDK identifiers and deployed release metadata", () => {
  const event = { event_id: "a".repeat(32), release: "b".repeat(40), contexts: { trace: { trace_id: "c".repeat(32), span_id: "d".repeat(16) } } };
  expect(redactEvent(event)).toEqual(event);
});
it("normalizes room paths in tracing and breadcrumb descriptions", () => {
  const event = { transaction: "/duels/private-room", spans: [{ description: "GET /api/drafts/private-draft?token=abc" }], breadcrumbs: [{ message: "/tournaments/private-tournament" }] };
  expect(redactEvent(event)).toEqual({ transaction: "/duels/[slug]", spans: [{ description: "GET /api/drafts/[slug]" }], breadcrumbs: [{ message: "/tournaments/[slug]" }] });
});
it("keeps only content metadata from request headers", () => {
  const event = { request: { headers: { accept: "json", "content-type": "application/json", "x-member-name": "member", "x-clerk-user-id": "user-one" } }, extra: { accessToken: "abc", sessionToken: "def" } };
  expect(redactEvent(event)).toEqual({ request: { headers: { accept: "json", "content-type": "application/json" } }, extra: {} });
});
it("includes only application identity in console reports", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  report(new Error("failed"), { userId: 7 });
  expect(output).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "7" } }));
});
it("redacts multiline SQL while retaining stack frames", () => {
  expect(redactText("SELECT email\nFROM users\nWHERE id = 1")).toBe("[redacted]");
  expect(redactText("SqliteError: SELECT email\nFROM users\n    at workerFrame (worker.ts:10:2)")).toBe("SqliteError: [redacted]\n    at workerFrame (worker.ts:10:2)");
});
it.each(["PRAGMA table_info(users)", "REPLACE INTO users VALUES (1)", "WITH recent AS (SELECT * FROM users) SELECT * FROM recent"])("redacts additional SQL statements %s", sql => {
  expect(redactText(sql)).toBe("[redacted]");
});
