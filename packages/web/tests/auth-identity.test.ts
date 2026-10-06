import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { ensureAuthIdentity, resolveJwtIdentity } from "../src/lib/auth-identity";

const input = { discordUserId: "900000000000000101", displayName: "Yugi", captureEmail: true };
beforeEach(() => {
  state.db = new Database(":memory:");
  migrate(state.db);
});
afterEach(() => state.db?.close());

it("captures provider verification only and clears trust when the address changes", () => {
  const first = ensureAuthIdentity({ ...input, providerEmail: " YUGI@Example.COM ", providerVerified: true });
  expect(first).toMatchObject({ email: "yugi@example.com", emailVerified: true });
  const next = ensureAuthIdentity({ ...input, providerEmail: "other@example.com", providerVerified: "true" });
  expect(next).toMatchObject({ id: first.id, email: "other@example.com", emailVerified: false });
});

it("clears verification when Discord no longer verifies the same address", () => {
  ensureAuthIdentity({ ...input, providerEmail: "yugi@example.com", providerVerified: true });
  expect(ensureAuthIdentity({ ...input, providerEmail: "yugi@example.com", providerVerified: false }))
    .toMatchObject({ email: "yugi@example.com", emailVerified: false });
});

it.each([undefined, null, "", "  ", 101])("clears provider email when Discord supplies %s", (providerEmail) => {
  ensureAuthIdentity({ ...input, providerEmail: "yugi@example.com", providerVerified: true });
  expect(ensureAuthIdentity({ ...input, providerEmail, providerVerified: true }))
    .toMatchObject({ email: null, emailVerified: false });
});

it("does not capture an email from a credential user object", () => {
  expect(ensureAuthIdentity({ ...input, captureEmail: false, providerEmail: "x@example.com", providerVerified: true }))
    .toMatchObject({ email: null, emailVerified: false });
});

it("preserves stored email and verification on credentials sign-in and JWT resolution", () => {
  const first = ensureAuthIdentity({ ...input, providerEmail: "yugi@example.com", providerVerified: true });
  expect(ensureAuthIdentity({ ...input, captureEmail: false, providerEmail: "fake@example.com", providerVerified: false }))
    .toMatchObject({ id: first.id, email: "yugi@example.com", emailVerified: true });
  expect(resolveJwtIdentity(input.discordUserId))
    .toMatchObject({ id: first.id, email: "yugi@example.com", emailVerified: true, displayName: "Yugi" });
});

it("lazily creates a Discord user without inventing a player", () => {
  const user = resolveJwtIdentity(input.discordUserId)!;
  expect(user).toMatchObject({ discordUserId: input.discordUserId, email: null, emailVerified: false });
  expect(resolveJwtIdentity(input.discordUserId)?.id).toBe(user.id);
  expect(state.db!.prepare("select count(*) as c from players").get()).toEqual({ c: 0 });
});

it.each([undefined, null, 101, {}, "clerk:123", "", "01x", "1e3", " 101", "9000000000000000000000000000"])("rejects invalid explicit Discord identity %s without writes", (value) => {
  expect(resolveJwtIdentity(value)).toBeNull();
  expect(state.db!.prepare("select count(*) as c from users").get()).toEqual({ c: 0 });
});

it("resolves explicit Discord IDs by their own column even if they resemble an application ID", () => {
  const other = createUserService(state.db!).createNonLogin("Unrelated owner");
  const user = resolveJwtIdentity(String(other.id))!;
  expect(user.id).not.toBe(other.id);
  expect(user.discordUserId).toBe(String(other.id));
});
