import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTournamentRoomToken, verifyTournamentRoomToken } from "../../src/ws/tournament-token.js";

const secret = "existing-ws-internal-secret";
const claims = { slug: "tournament-a", guildId: "guild-1", userId: 101, expiresAt: 1_800_000_060_000 };
const expected = { slug: "tournament-a", userId: 101 };
const now = 1_800_000_000_000;

function signPayload(json: string, domain = "yugidraft:tournament-room:v2"): string {
  const payload = Buffer.from(json);
  const key = createHmac("sha256", secret).update(domain).digest();
  return `${payload.toString("base64url")}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

function signRaw(value: unknown, domain = "yugidraft:tournament-room:v2"): string {
  return signPayload(JSON.stringify(value), domain);
}

describe("tournament room tokens", () => {
  it("accepts independently signed v2 numeric claims", () => {
    expect(verifyTournamentRoomToken(signRaw(claims), secret, expected, now)).toEqual(claims);
  });

  it.each(["yugidraft:tournament-room:v1", "yugidraft:tournament-room:v3"])("rejects tokens signed with the wrong version: %s", (domain) => {
    expect(verifyTournamentRoomToken(signRaw(claims, domain), secret, expected, now)).toBeNull();
    expect(verifyTournamentRoomToken(signRaw({ ...claims, userId: "101" }, domain), secret, expected, now)).toBeNull();
  });

  it.each(["101", "01", "1e3", "900000000000000101", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, true])("rejects v2 invalid user identity: %s", (userId) => {
    expect(verifyTournamentRoomToken(signRaw({ ...claims, userId }), secret, { ...expected, userId: Number(userId) }, now)).toBeNull();
  });

  it.each(["01", "1e3", "1E3", "1.0", "0", "-1", "9007199254740992"])("rejects non-canonical JSON user numbers: %s", (source) => {
    const json = `{"slug":"tournament-a","guildId":"guild-1","userId":${source},"expiresAt":1800000060000}`;
    expect(verifyTournamentRoomToken(signPayload(json), secret, { slug: "tournament-a", userId: Number(source) }, now)).toBeNull();
  });

  it.each([1, Number.MAX_SAFE_INTEGER])("accepts positive safe integer boundary: %s", (userId) => {
    const input = { ...claims, userId };
    expect(verifyTournamentRoomToken(signRaw(input), secret, { ...expected, userId }, now)).toEqual(input);
  });

  it("accepts a valid token for its named tournament and user", () => {
    expect(verifyTournamentRoomToken(createTournamentRoomToken(claims, secret), secret, expected, now)).toEqual(claims);
  });

  it("rejects expired tokens, including at the expiry boundary", () => {
    const token = createTournamentRoomToken(claims, secret);
    expect(verifyTournamentRoomToken(token, secret, expected, claims.expiresAt)).toBeNull();
    expect(verifyTournamentRoomToken(token, secret, expected, claims.expiresAt + 1)).toBeNull();
  });

  it("rejects a token for another tournament", () => {
    expect(verifyTournamentRoomToken(createTournamentRoomToken(claims, secret), secret, { ...expected, slug: "tournament-b" }, now)).toBeNull();
  });

  it("rejects a token for another user", () => {
    expect(verifyTournamentRoomToken(createTournamentRoomToken(claims, secret), secret, { ...expected, userId: 102 }, now)).toBeNull();
  });

  it.each([undefined, null, "", "invalid", "a.b.c", "a.b"])("rejects missing or malformed tokens: %s", (token) => {
    expect(verifyTournamentRoomToken(token, secret, expected, now)).toBeNull();
  });

  it("rejects tampering and the wrong secret", () => {
    const token = createTournamentRoomToken(claims, secret);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, userId: 102 })).toString("base64url");
    expect(verifyTournamentRoomToken(`${forged}.${signature}`, secret, { ...expected, userId: 102 }, now)).toBeNull();
    expect(verifyTournamentRoomToken(token, "other-secret", expected, now)).toBeNull();
  });

  it("uses a derived key so the room token cannot authenticate internal broadcasts", () => {
    const token = createTournamentRoomToken(claims, secret);
    const [payload, signature] = token.split(".");
    const internalSignature = createHmac("sha256", secret).update(Buffer.from(payload, "base64url")).digest("base64url");
    expect(signature).not.toBe(internalSignature);
    expect(verifyTournamentRoomToken(`${payload}.${internalSignature}`, secret, expected, now)).toBeNull();
  });

  it("fails closed without the existing secret", () => {
    expect(() => createTournamentRoomToken(claims, "")).toThrow();
    expect(verifyTournamentRoomToken(createTournamentRoomToken(claims, secret), "", expected, now)).toBeNull();
  });

  it.each([
    { ...claims, slug: "" },
    { ...claims, guildId: "" },
    { ...claims, userId: 0 },
    { ...claims, userId: -1 },
    { ...claims, userId: 1.5 },
    { ...claims, userId: Number.MAX_SAFE_INTEGER + 1 },
    { ...claims, userId: NaN },
    { ...claims, userId: Infinity },
    { ...claims, expiresAt: NaN },
    { ...claims, expiresAt: 1.5 },
  ])("refuses invalid claims", (invalid) => {
    expect(() => createTournamentRoomToken(invalid, secret)).toThrow();
  });
});
