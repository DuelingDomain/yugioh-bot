import { afterEach, expect, it, vi } from "vitest";
import type * as Sentry from "@sentry/nextjs";
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
