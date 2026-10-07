import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isE2EAuthEnabled, signE2ESession, verifyE2ESession } from "../src/lib/e2e-auth";
const secret = "a".repeat(32);
function cookie(uid: unknown, exp = 3700) {
  const payload = Buffer.from(JSON.stringify({ uid, exp })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", secret).update(`dd-e2e-session:v1.${payload}`).digest("base64url")}`;
}
describe("signed E2E cookie", () => {
  it("round trips an application user ID and expires after an hour", () => {
    const value = signE2ESession(42, secret, 100);
    expect(value).toBe(cookie(42));
    expect(verifyE2ESession(value, secret, 100)).toBe(42);
    expect(verifyE2ESession(value, secret, 3700)).toBeNull();
  });
  it.each([0, -1, 1.5, "1", 9007199254740993])("rejects signed malformed uid %s", uid => {
    expect(verifyE2ESession(cookie(uid), secret, 100)).toBeNull();
  });
  it("rejects tampering, unknown versions, malformed encoding and short secrets", () => {
    const value = cookie(42);
    for (const bad of [undefined, "", value.replace("v1.", "v2."), value + "x", value.replace(/v1.[^.]+/, "v1.e30"), "v1.@@.@@"]) {
      expect(verifyE2ESession(bad, secret, 100)).toBeNull();
    }
    expect(verifyE2ESession(value, "a".repeat(31), 100)).toBeNull();
    expect(verifyE2ESession(value, "b".repeat(32), 100)).toBeNull();
  });
  it.each([{}, { E2E_AUTH: "true", E2E_AUTH_SECRET: secret }, { E2E_AUTH: "1" }, { E2E_AUTH: "1", E2E_AUTH_SECRET: "a".repeat(31) }])("keeps the gate closed for %j", env => {
    expect(isE2EAuthEnabled({ NODE_ENV: "test", ...env })).toBe(false);
  });
  it("reads the gate on each call", () => {
    const env = { E2E_AUTH: "1", E2E_AUTH_SECRET: secret };
    expect(isE2EAuthEnabled({ NODE_ENV: "test", ...env })).toBe(true); env.E2E_AUTH = "0";
    expect(isE2EAuthEnabled({ NODE_ENV: "test", ...env })).toBe(false);
  });
});
