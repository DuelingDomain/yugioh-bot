import { afterEach, expect, it, vi } from "vitest";
import type * as Sentry from "@sentry/node";
import { Scope, type TransactionEvent } from "@sentry/core";

const sdk = vi.hoisted(() => ({ init: vi.fn<(options: Parameters<typeof Sentry.init>[0]) => void>() }));
vi.mock("@sentry/node", () => sdk);
vi.mock("dotenv", () => ({ config() {} }));
vi.mock("dotenv/config", () => ({}));
vi.mock("@yugidraft/shared/observability/node-bootstrap", () => ({ bootstrapObservability: (factory: () => unknown) => { factory(); } }));
afterEach(() => vi.clearAllMocks());

it.each(["bot", "ws", "worker", "duel-server"])("disables query collection and redacts %s spans and transactions", async service => {
  await import(`../../../${service}/src/instrument.ts`);
  const options = sdk.init.mock.calls[0][0]!;
  expect(options.dataCollection).toMatchObject({ urlQueryParams: false, userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], genAI: { inputs: false, outputs: false }, databaseQueryData: false });
  const data = { "http.query": "?q=Alice", "http.request.url": "/api/players?q=Alice#profile", "http.fragment": "#profile", "http.method": "GET" };
  const span = { span_id: "a".repeat(16), trace_id: "b".repeat(32), start_timestamp: 1, timestamp: 2, data };
  expect(options.beforeSendSpan!(span).data).toEqual({ "http.method": "GET" });
  expect(options.beforeSend!({ type: undefined, breadcrumbs: [{ data }] }, {})).toMatchObject({ breadcrumbs: [{ data: { "http.method": "GET" } }] });
  expect(options.beforeBreadcrumb!({ data }, {})).toEqual({ data: { "http.method": "GET" } });
  const client: Record<string, unknown> = {}; client.self = client;
  const capturedSpanScope = new Scope(); capturedSpanScope.setSDKProcessingMetadata({ client });
  const sdkProcessingMetadata = { capturedSpanScope };
  const clean = options.beforeSendTransaction!({ type: "transaction", sdkProcessingMetadata, spans: [span] }, {});
  expect(clean).toMatchObject({ spans: [{ data: { "http.method": "GET" } }] });
  expect((clean as TransactionEvent).sdkProcessingMetadata).toBe(sdkProcessingMetadata);
});
