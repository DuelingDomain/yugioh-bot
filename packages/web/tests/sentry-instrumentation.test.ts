// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/browser";
import type { Envelope, Event, TransactionEvent } from "@sentry/core";
import { initializeSentry } from "../src/lib/sentry";

const recording = vi.hoisted(() => ({ envelopes: [] as Envelope[], collectedQueries: [] as unknown[] }));
// Use the production setup with the browser SDK; replace only sampling and network I/O.
vi.mock("@sentry/nextjs", async () => {
  const sdk = await vi.importActual<typeof import("@sentry/browser")>("@sentry/browser");
  return {
    ...sdk,
    init: (options: Parameters<typeof sdk.init>[0]) => sdk.init({
      ...options, tracesSampleRate: 1, defaultIntegrations: false,
      integrations: [sdk.browserTracingIntegration({
        instrumentPageLoad: false, instrumentNavigation: false, enableHTTPTimings: false,
        onRequestSpanStart: span => { recording.collectedQueries.push(sdk.spanToJSON(span).data?.["http.query"]); },
      })],
      transport: () => ({
        send: async envelope => { recording.envelopes.push(envelope); return { statusCode: 200 }; },
        flush: async () => true,
      }),
    }),
  };
});
afterEach(async () => { await Sentry.close(); vi.unstubAllGlobals(); recording.envelopes.length = 0; recording.collectedQueries.length = 0; Sentry.getCurrentScope().clear(); });

it("sends redacted transactions and errors from real fetch instrumentation", async () => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  initializeSentry("https://public@example.test/1", "test", "release-one");
  await Sentry.startSpan({ name: "player request", op: "test" }, async () => {
    await fetch("/api/players?q=Alice#profile");
  });
  Sentry.addBreadcrumb({ category: "http", data: { "http.query": "?q=Alice", "http.fragment": "#profile", "http.method": "GET" } });
  Sentry.captureException(new Error("request failed"));
  await Sentry.flush(2000);
  const transactions: TransactionEvent[] = []; const errors: Event[] = [];
  for (const [, items] of recording.envelopes) {
    for (const [header, payload] of items) {
      if (header.type === "transaction") transactions.push(payload as TransactionEvent);
      if (header.type === "event") errors.push(payload as Event);
    }
  }
  expect(transactions).toHaveLength(1);
  expect(transactions[0].spans).toEqual(expect.arrayContaining([expect.objectContaining({ op: "http.client", data: expect.objectContaining({ "http.method": "GET" }) })]));
  expect(errors).toHaveLength(1);
  expect(errors[0].breadcrumbs).toEqual(expect.arrayContaining([expect.objectContaining({ data: { "http.method": "GET" } })]));
  expect(recording.collectedQueries).toEqual([undefined]);
  const serialized = JSON.stringify(recording.envelopes);
  expect(serialized).not.toContain("Alice");
  expect(serialized).not.toContain("profile");
});

it("sends transactions with circular captured scope metadata", async () => {
  initializeSentry("https://public@example.test/1", "test", "release-one");
  const client: Record<string, unknown> = {}; client.self = client;
  const capturedSpanScope = new Sentry.Scope();
  capturedSpanScope.setClient(Sentry.getClient()!);
  capturedSpanScope.setSDKProcessingMetadata({ client });
  Sentry.captureEvent({
    type: "transaction", transaction: "player request", start_timestamp: 1, timestamp: 2,
    sdkProcessingMetadata: { capturedSpanScope },
    spans: [{ span_id: "a".repeat(16), trace_id: "b".repeat(32), start_timestamp: 1, timestamp: 2, data: { "http.query": "?q=Alice", count: 2 } }],
  });
  await Sentry.flush(2000);
  const transactions = recording.envelopes.flatMap(([, items]) => items.filter(([header]) => header.type === "transaction").map(([, payload]) => payload as TransactionEvent));
  expect(transactions).toHaveLength(1);
  expect(transactions[0].spans?.[0].data).toEqual({ count: 2 });
  expect(transactions[0]).not.toHaveProperty("sdkProcessingMetadata");
  expect(JSON.stringify(recording.envelopes)).not.toContain("Alice");
});
