import { afterEach, expect, it, vi } from "vitest";
import type * as Sentry from "@sentry/nextjs";
import { Scope, type TransactionEvent } from "@sentry/core";
import { initializeSentry } from "../src/lib/sentry";
import { ExpectedError, log, report } from "@yugidraft/shared/observability";

const sdk = vi.hoisted(() => ({ init: vi.fn<(options: Parameters<typeof Sentry.init>[0]) => void>(), captureException: vi.fn(), addBreadcrumb: vi.fn(), flush: vi.fn(async () => true) }));
vi.mock("@sentry/nextjs", () => sdk);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
it("does not initialize remote reporting with an empty DSN", () => {
  initializeSentry("", "test", "release-one");
  expect(sdk.init).not.toHaveBeenCalled();
});
it("redacts SDK events and breadcrumbs and attaches only the application user ID", () => {
  initializeSentry("configured", "test", "release-one");
  const options = sdk.init.mock.calls[0][0]!;
  expect(options).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0.05, environment: "test", release: "release-one" });
  const clean = options.beforeSend!({ type: undefined, message: "Bearer abc", request: { data: "private body", cookies: { session: "abc" }, headers: { authorization: "abc" } } }, {});
  expect(clean).toEqual({ type: undefined, message: "[redacted]", request: { headers: {} } });
  expect(options.beforeBreadcrumb!({ message: "member@example.test" }, {})).toEqual({ message: "[redacted]" });
  const error = new Error("failed");
  report(error, { userId: 7, tags: { operation: "save" } });
  expect(sdk.captureException).toHaveBeenCalledWith(error, { user: { id: "7" }, tags: { operation: "save" }, extra: undefined });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  log("warn", "Retry", { attempts: 2 });
  expect(sdk.addBreadcrumb).toHaveBeenCalledWith({ level: "warning", message: "Retry", data: { attempts: 2 } });
});
it("contains SDK capture failures", () => {
  initializeSentry("configured", "test", "release-one");
  sdk.captureException.mockImplementationOnce(() => { throw new Error("offline"); });
  expect(() => report(new Error("failed"))).not.toThrow();
});

it("excludes expected errors captured automatically by the SDK", () => {
  initializeSentry("configured", "test", "release-one");
  const options = sdk.init.mock.calls[0][0]!;
  expect(options.beforeSend!({ type: undefined, message: "Try later" }, { originalException: new ExpectedError("Try later", 429) })).toBeNull();
});

it("disables query collection and redacts URL attributes in each SDK hook", () => {
  initializeSentry("configured", "test", "release-one");
  const options = sdk.init.mock.calls[0][0]!;
  expect(options.dataCollection).toMatchObject({ urlQueryParams: false, userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], genAI: { inputs: false, outputs: false }, databaseQueryData: false });
  const data = { "http.query": "?q=Alice", "http.fragment": "#profile", "http.target": "/api/players?q=Alice#profile", "url.full": "https://example.test/api/players?q=Alice#profile", "http.method": "GET" };
  const span = { span_id: "a".repeat(16), trace_id: "b".repeat(32), start_timestamp: 1, timestamp: 2, data };
  expect(options.beforeSendSpan!(span).data).toEqual({ "http.method": "GET" });
  const event = { breadcrumbs: [{ data }], contexts: { trace: { span_id: span.span_id, trace_id: span.trace_id, data } } };
  expect(options.beforeSend!({ ...event, type: undefined }, {})).toMatchObject({ breadcrumbs: [{ data: { "http.method": "GET" } }], contexts: { trace: { data: { "http.method": "GET" } } } });
  expect(options.beforeSendTransaction!({ ...event, type: "transaction", spans: [span] }, {})).toMatchObject({ spans: [{ data: { "http.method": "GET" } }] });
  expect(options.beforeBreadcrumb!({ data }, {})).toEqual({ data: { "http.method": "GET" } });
});

it("preserves circular SDK metadata when redacting transactions", () => {
  initializeSentry("configured", "test", "release-one");
  const options = sdk.init.mock.calls[0][0]!;
  const client: Record<string, unknown> = {}; client.self = client;
  const capturedSpanScope = new Scope(); capturedSpanScope.setSDKProcessingMetadata({ client });
  const sdkProcessingMetadata = { capturedSpanScope };
  const clean = options.beforeSendTransaction!({ type: "transaction", sdkProcessingMetadata, spans: [{ span_id: "a".repeat(16), trace_id: "b".repeat(32), start_timestamp: 1, timestamp: 2, data: { "http.query": "?q=Alice", count: 2 } }] }, {});
  expect(clean).toMatchObject({ type: "transaction", spans: [{ data: { count: 2 } }] });
  expect((clean as TransactionEvent).sdkProcessingMetadata).toBe(sdkProcessingMetadata);
});
