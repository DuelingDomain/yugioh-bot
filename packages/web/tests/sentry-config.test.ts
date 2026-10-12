import { afterEach, beforeEach, expect, it, vi } from "vitest";
const configure = vi.hoisted(() => vi.fn((config: unknown, _options: unknown) => config));
vi.mock("@sentry/nextjs", () => ({ withSentryConfig: configure }));
beforeEach(() => {
  vi.resetModules();
  for (const key of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_UPLOAD_SOURCEMAPS", "NEXT_PUBLIC_SENTRY_DSN"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each(["", "https://public@example.test/1"])("keeps uploads disabled without credentials with DSN %s", async dsn => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  await import("../next.config");
  const options = configure.mock.calls[0][1];
  expect(options).toMatchObject({ tunnelRoute: "/monitoring", sourcemaps: { disable: true, deleteSourcemapsAfterUpload: true } });
  for (const key of ["org", "project", "authToken"]) expect(options).not.toHaveProperty(key);
});
it.each([
  ["SENTRY_AUTH_TOKEN", ""], ["SENTRY_ORG", ""], ["SENTRY_PROJECT", ""], ["SENTRY_UPLOAD_SOURCEMAPS", ""],
  ["SENTRY_AUTH_TOKEN", " "], ["SENTRY_ORG", " "], ["SENTRY_PROJECT", " , "], ["SENTRY_UPLOAD_SOURCEMAPS", "0"],
])("keeps uploads disabled when %s is %j", async (key, value) => {
  vi.stubEnv("SENTRY_AUTH_TOKEN", "configured"); vi.stubEnv("SENTRY_ORG", "organization");
  vi.stubEnv("SENTRY_PROJECT", "web,server"); vi.stubEnv("SENTRY_UPLOAD_SOURCEMAPS", "1"); vi.stubEnv(key, value);
  await import("../next.config");
  const options = configure.mock.calls[0][1];
  expect(options).toMatchObject({ sourcemaps: { disable: true } });
  for (const name of ["org", "project", "authToken"]) expect(options).not.toHaveProperty(name);
});
it("uploads maps only with enablement and all credentials", async () => {
  vi.stubEnv("SENTRY_AUTH_TOKEN", "configured"); vi.stubEnv("SENTRY_ORG", "organization");
  vi.stubEnv("SENTRY_PROJECT", "web,server"); vi.stubEnv("SENTRY_UPLOAD_SOURCEMAPS", "1");
  await import("../next.config");
  expect(configure.mock.calls[0][1]).toMatchObject({ org: "organization", authToken: "configured", project: ["web", "server"], sourcemaps: { disable: false, deleteSourcemapsAfterUpload: true } });
});
