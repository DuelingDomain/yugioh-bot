import { afterEach, expect, it, vi } from "vitest";
import { marketingUrlFromEnv } from "../src/lib/auth-page-params";

afterEach(() => vi.unstubAllEnvs());

it.each([
  [undefined, "https://duelingdomain.com"],
  ["", "https://duelingdomain.com"],
  [" \t\n ", "https://duelingdomain.com"],
  ["marketing.example", "https://duelingdomain.com"],
  ["/marketing", "https://duelingdomain.com"],
  ["//marketing.example", "https://duelingdomain.com"],
  ["https:marketing.example", "https://duelingdomain.com"],
  ["ftp://marketing.example", "https://duelingdomain.com"],
  ["javascript:alert(1)", "https://duelingdomain.com"],
  ["https://marketing .example", "https://duelingdomain.com"],
  ["https://marketing.example", "https://marketing.example"],
  ["  https://marketing.example/ \n", "https://marketing.example"],
  ["http://localhost:8080/", "http://localhost:8080"],
  ["https://marketing.example/path?from=app#intro", "https://marketing.example/path?from=app#intro"],
])("validates the request-time marketing URL %s", (value, expected) => {
  vi.stubEnv("MARKETING_URL", value);
  expect(marketingUrlFromEnv()).toBe(expected);
});

it("reads changes in marketing configuration per request", () => {
  vi.stubEnv("MARKETING_URL", "https://first.example");
  expect(marketingUrlFromEnv()).toBe("https://first.example");
  vi.stubEnv("MARKETING_URL", "https://second.example");
  expect(marketingUrlFromEnv()).toBe("https://second.example");
});
