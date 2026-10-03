import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDraftRoomToken, verifyDraftRoomToken } from "../../src/ws/draft-token.js";

const secret = "existing-ws-internal-secret";
const claims = { slug: "draft-a", guildId: "guild-1", userId: "user-1", expiresAt: 1_800_000_060_000 };
const expected = { slug: "draft-a", userId: "user-1" };
const now = 1_800_000_000_000;

describe("draft room tokens", () => {
  it("accepts a valid token for its named draft and user", () => {
    expect(verifyDraftRoomToken(createDraftRoomToken(claims, secret), secret, expected, now)).toEqual(claims);
  });

  it("rejects expired tokens, including at the expiry boundary", () => {
    const token = createDraftRoomToken(claims, secret);
    expect(verifyDraftRoomToken(token, secret, expected, claims.expiresAt)).toBeNull();
    expect(verifyDraftRoomToken(token, secret, expected, claims.expiresAt + 1)).toBeNull();
  });

  it("rejects a token for another draft", () => {
    expect(verifyDraftRoomToken(createDraftRoomToken(claims, secret), secret, { ...expected, slug: "draft-b" }, now)).toBeNull();
  });

  it("rejects a token for another user", () => {
    expect(verifyDraftRoomToken(createDraftRoomToken(claims, secret), secret, { ...expected, userId: "user-2" }, now)).toBeNull();
  });

  it.each([undefined, null, "", "invalid", "a.b.c", "a.b"])("rejects missing or malformed tokens: %s", (token) => {
    expect(verifyDraftRoomToken(token, secret, expected, now)).toBeNull();
  });

  it("rejects tampering and the wrong secret", () => {
    const token = createDraftRoomToken(claims, secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, userId: "user-2" })).toString("base64url");
    expect(verifyDraftRoomToken(`${forged}.${signature}`, secret, { ...expected, userId: "user-2" }, now)).toBeNull();
    expect(verifyDraftRoomToken(token, "other-secret", expected, now)).toBeNull();
  });

  it("uses a derived key so the room token cannot authenticate internal broadcasts", () => {
    const token = createDraftRoomToken(claims, secret);
    const [payload, signature] = token.split(".");
    const internalSignature = createHmac("sha256", secret).update(Buffer.from(payload, "base64url")).digest("base64url");
    expect(signature).not.toBe(internalSignature);
    expect(verifyDraftRoomToken(`${payload}.${internalSignature}`, secret, expected, now)).toBeNull();
  });

  it("fails closed without the existing secret", () => {
    expect(() => createDraftRoomToken(claims, "")).toThrow();
    expect(verifyDraftRoomToken(createDraftRoomToken(claims, secret), "", expected, now)).toBeNull();
  });

  it.each([
    { ...claims, slug: "" },
    { ...claims, guildId: "" },
    { ...claims, userId: "" },
    { ...claims, expiresAt: NaN },
    { ...claims, expiresAt: 1.5 },
  ])("refuses invalid claims", (invalid) => {
    expect(() => createDraftRoomToken(invalid, secret)).toThrow();
  });
});
