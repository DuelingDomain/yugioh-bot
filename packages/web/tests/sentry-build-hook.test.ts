import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  for (const key of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_UPLOAD_SOURCEMAPS", "SENTRY_RELEASE"]) vi.stubEnv(key, "");
  vi.stubEnv("TURBOPACK", "1");
});
afterEach(() => vi.unstubAllEnvs());

it("keeps monitoring requests out of external Next rewrites", async () => {
  const { default: config } = await import("../next.config");
  const rewrites = await config.rewrites?.() ?? [];
  const routes = Array.isArray(rewrites) ? rewrites : [...rewrites.beforeFiles ?? [], ...rewrites.afterFiles ?? [], ...rewrites.fallback ?? []];
  expect(routes.filter(route => route.source.startsWith("/monitoring"))).toEqual([]);
});

it.each(["", "https://public@example.test/1"])("runs the installed production hook without upload credentials (DSN %s)", async dsn => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  const { default: config } = await import("../next.config");
  const directory = mkdtempSync(join(tmpdir(), "sentry-build-hook-"));
  mkdirSync(join(directory, "static"));
  try {
    const hook = config.compiler?.runAfterProductionCompile;
    expect(hook).toBeTypeOf("function");
    await expect(hook!({ distDir: directory, projectDir: process.cwd() })).resolves.toBeUndefined();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
