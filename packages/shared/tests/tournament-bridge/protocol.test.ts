import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readTournamentRequest, signTournamentAssertion, signTournamentRequest } from "../../src/tournament-bridge/index.js";

const secret = "tournament-bridge-test-secret-32-chars";
const path = "/api/tournament-bridge/users/lookup?one=%2F&two=2";
const rawBody = '{"ids":[1,2]}';
const timestamp = 1700000000;
const signature = "t=1700000000,v1=00d6521cc1908f3aeed65226945387d6e6d929ebfdbc010c9fc5d8b50c7406b5";
const request = (body = rawBody, header = signature, method = "POST", target = path) => new Request(`https://app.test${target}`, {
  method, headers: { "x-bridge-signature": header }, ...(method === "GET" ? {} : { body }),
});
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(timestamp * 1000); });
afterEach(() => vi.useRealTimers());

it("signs the exact published API bytes and accepts an independent HMAC test vector", async () => {
  expect(signTournamentRequest({ secret, method: "POST", pathWithQuery: path, rawBody })).toBe(signature);
  expect(await readTournamentRequest(request(), secret)).toEqual({ ok: true, rawBody });
});

it.each([-61, -60, 60, 61])("enforces the 60 second window at offset %s", async offset => {
  vi.setSystemTime((timestamp + offset) * 1000);
  expect((await readTournamentRequest(request(), secret)).ok).toBe(Math.abs(offset) <= 60);
});

it.each([
  [rawBody + " ", signature, "POST", path],
  [rawBody, signature, "PUT", path],
  [rawBody, signature, "POST", path.replace("%2F", "/")],
  [rawBody, signature, "POST", path.replace("lookup", "search")],
  [rawBody, signature.replace(/.$/, "0"), "POST", path],
  [rawBody, signature.replace("v1=", "v2="), "POST", path],
  [rawBody, "", "POST", path],
  [rawBody, "t=1700000000,v1=abcd", "POST", path],
])("refuses tampered bytes or headers (%s, %s, %s, %s)", async (body, header, method, target) => {
  expect(await readTournamentRequest(request(body, header, method, target), secret)).toEqual({ ok: false });
});

it("bounds streamed bytes, not characters, and authenticates before JSON parsing", async () => {
  for (const [body, accepted] of [["é".repeat(32768), true], ["é".repeat(32769), false]] as const) {
    const header = signTournamentRequest({ secret, method: "POST", pathWithQuery: path, rawBody: body });
    expect((await readTournamentRequest(request(body, header), secret)).ok).toBe(accepted);
  }
  const oversized = request(); oversized.headers.set("content-length", "65537");
  expect(await readTournamentRequest(oversized, secret)).toEqual({ ok: false });
  expect(oversized.bodyUsed).toBe(false);
  const invalid = request(rawBody, "not-a-signature");
  expect(await readTournamentRequest(invalid, secret)).toEqual({ ok: false });
  expect(invalid.bodyUsed).toBe(false);
  expect(await readTournamentRequest(request(), "short")).toEqual({ ok: false });
});

it("issues a 60 second assertion with a random 16 byte nonce and the assertion-specific signature", () => {
  const user = { id: 1, username: "ada", displayName: "Ada", discordUserId: null, discordUsername: null, memberId: "12345" };
  const assertion = signTournamentAssertion({ secret, return: "/events/one?desk=1", user });
  const [payload, signature] = assertion.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
  expect(claims).toEqual({ v: 1, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), iat: timestamp, exp: timestamp + 60, return: "/events/one?desk=1", user });
  expect(Buffer.from(claims.nonce, "base64url")).toHaveLength(16);
  expect(signature).toBe(createHmac("sha256", secret).update(`dd-tournament-assertion.v1.${payload}`).digest("hex"));
  expect(signTournamentAssertion({ secret, return: "/", user })).not.toBe(signTournamentAssertion({ secret, return: "/", user }));
  expect(() => signTournamentAssertion({ secret: "short", return: "/", user })).toThrow();
  expect(() => signTournamentAssertion({ secret, return: "//outside.test", user })).toThrow();
});
