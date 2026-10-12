import { expect, it } from "vitest";
import { createEventEnvelope, parseEnvelope, Scope, serializeEnvelope, type Event } from "@sentry/core";
import { redactEvent } from "../../src/observability/redact.js";

it.each([undefined, "transaction"] as const)("sanitizes sampling context in serialized %s envelope headers", type => {
  const client: Record<string, unknown> = {}; client.self = client;
  const capturedSpanScope = new Scope(); capturedSpanScope.setSDKProcessingMetadata({ client });
  const dynamicSamplingContext = {
    trace_id: "b".repeat(32), public_key: "c".repeat(32), release: "release-one", sample_rate: "0.05",
    transaction: "/drafts/private-slug?q=Alice",
    url: "https://example.test/players?q=Alice", "http.target": "/players?q=Alice",
    source_url: "/decks/private-slug?q=Alice", query_string: "q=Alice",
    path: "/players?q=Alice", href: "/players?q=Alice", route: "/players?q=Alice",
  };
  const event: Event = { type, sdkProcessingMetadata: { capturedSpanScope, dynamicSamplingContext } };
  const clean = redactEvent(event);
  expect(clean.sdkProcessingMetadata?.capturedSpanScope).toBe(capturedSpanScope);
  const serialized = serializeEnvelope(createEventEnvelope(clean));
  const headers = parseEnvelope(serialized)[0];
  expect(headers.trace).toEqual({ trace_id: "b".repeat(32), public_key: "c".repeat(32), release: "release-one", sample_rate: "0.05" });
  expect(JSON.stringify(headers)).not.toMatch(/private-slug|Alice/);
  expect(dynamicSamplingContext.transaction).toBe("/drafts/private-slug?q=Alice");
});

it.each(["url", "http.url", "http.query", "http.target", "url.full", "url.query", "http.request.url", "http.request.target", "http.request.uri", "http.fragment", "url.fragment", "url.original", "query_string"])("removes private URL attribute %s from events, spans and breadcrumbs", field => {
  const data = { [field]: "/api/players?q=Alice#profile", "http.method": "GET", "http.status_code": 200 };
  const event = { contexts: { trace: { data } }, spans: [{ data }], breadcrumbs: [{ data }] };
  const clean = redactEvent(event);
  const expected = { "http.method": "GET", "http.status_code": 200 };
  expect(clean.contexts.trace.data).toEqual(expected);
  expect(clean.spans[0].data).toEqual(expected);
  expect(clean.breadcrumbs[0].data).toEqual(expected);
  expect(event.spans[0].data[field]).toBe("/api/players?q=Alice#profile");
});

it("preserves SDK processing metadata without traversing captured scope references", () => {
  const client: Record<string, unknown> = {};
  client.self = client;
  const sdkProcessingMetadata = { capturedSpanScope: { _client: client } };
  const event = { type: "transaction", sdkProcessingMetadata, spans: [{ data: { email: "member@example.test", count: 2 } }] };
  const clean = redactEvent(event);
  expect(clean.sdkProcessingMetadata).toBe(sdkProcessingMetadata);
  expect(clean.spans[0].data).toEqual({ count: 2 });
});

it("redacts circular objects and arrays while preserving repeated non-circular values", () => {
  const extra: Record<string, unknown> = { message: "member@example.test" };
  const values: unknown[] = [extra];
  extra.self = extra;
  values.push(values);
  const clean = redactEvent({ extra, values, copy: extra });
  expect(clean).toEqual({
    extra: { message: "[redacted]", self: "[redacted]" },
    values: [{ message: "[redacted]", self: "[redacted]" }, "[redacted]"],
    copy: { message: "[redacted]", self: "[redacted]" },
  });
  expect(() => JSON.stringify(clean)).not.toThrow();
});

it("bounds traversal of deeply nested event data", () => {
  let nested: Record<string, unknown> = { message: "member@example.test" };
  for (let depth = 0; depth < 10000; depth++) nested = { nested };
  const clean = redactEvent({ extra: nested });
  const serialized = JSON.stringify(clean);
  expect(serialized.length).toBeLessThan(1000);
  expect(serialized).toContain("[redacted]");
  expect(serialized).not.toContain("member@example.test");
});
