import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import type { APIRequestContext } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { stackFixture } from "./stack-fixture.ts";

const secret = "throwaway-auth-secret-for-unit-tests";
const webUrl = "http://localhost:3300";
const player = { userId: 101, discordId: "900000000000000101", name: "E2E Alice" };

// Only the HTTP boundary is replaced: no sockets or browser needed.
function provider(session: unknown, loginStatus = 200, sessionStatus = 200) {
  const calls: Array<{ method: string; url: string; options?: unknown }> = [];
  const response = (status: number, body: unknown) => ({ status: () => status, ok: () => status >= 200 && status < 300, json: async () => body });
  const api = {
    async get(url: string) {
      calls.push({ method: "GET", url });
      return response(sessionStatus, session);
    },
    async post(url: string, options: unknown) {
      calls.push({ method: "POST", url, options });
      return response(loginStatus, {});
    },
  } as unknown as APIRequestContext;
  return { api, calls };
}

test("login posts only the application user ID and secret as JSON, then verifies the session", async () => {
  const login = provider({ user: { id: "101", discordUserId: player.discordId } });
  await authenticatePlayer(login.api, player, secret, webUrl);
  assert.deepEqual(login.calls, [
    { method: "POST", url: "/api/test-auth/session", options: { data: { userId: 101, secret } } },
    { method: "GET", url: "/api/auth/session" },
  ]);
});

test("email-only login accepts a null Discord ID", async () => {
  const login = provider({ user: { id: "105", discordUserId: null } });
  const emailOnlyPlayer = { userId: 105, discordId: null, name: "E2E Eve" };
  await authenticatePlayer(login.api, emailOnlyPlayer, secret, webUrl);
  assert.deepEqual(login.calls[0], { method: "POST", url: "/api/test-auth/session", options: { data: { userId: 105, secret } } });
});

for (const session of [null, {}, { user: { id: "102" } }, { user: { id: 101 } }, { user: { id: "900000000000000101" } }]) {
  test(`login rejects a missing or mismatched application identity: ${JSON.stringify(session)}`, async () => {
    const login = provider(session);
    await assert.rejects(authenticatePlayer(login.api, player, secret, webUrl), /did not create.*session/i);
  });
}

test("login verifies application identity without requiring Discord identity", async () => {
  const login = provider({ user: { id: "101", discordUserId: "900000000000000102" } });
  await authenticatePlayer(login.api, player, secret, webUrl);
});

for (const status of [302, 401, 404, 500]) {
  test(`login requires HTTP 200 from the cookie endpoint: ${status}`, async () => {
    const login = provider({ user: { id: "101" } }, status);
    await assert.rejects(authenticatePlayer(login.api, player, secret, webUrl), new RegExp(`E2E login returned HTTP ${status}`));
    assert.equal(login.calls.length, 1, "failed login must not proceed to session verification");
  });
}

test("login rejects a failed session lookup", async () => {
  const login = provider(null, 200, 503);
  await assert.rejects(authenticatePlayer(login.api, player, secret, webUrl), /Session endpoint returned HTTP 503/);
});

test("login CLI rejects unknown players before opening a browser", () => {
  const result = spawnSync(process.execPath, ["stack/login.mjs", "p6"], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /p1.*p2.*p3.*p4.*p5/);
});

test("login CLI rejects a short secret in a manual login file before opening a browser", () => {
  const fixture = stackFixture();
  mkdirSync(fixture.at("packages/e2e/.stack-2"));
  writeFileSync(fixture.at("packages/e2e/.stack-2/manual.json"), JSON.stringify({ webUrl: "http://localhost:3321", authSecret: "x".repeat(31), supervisorPid: process.pid }));
  try {
    const result = spawnSync(process.execPath, [fixture.at("packages/e2e/stack/login.mjs"), "p1"], {
      cwd: fixture.root, encoding: "utf8", env: fixture.env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No running manual stack found/);
  } finally { fixture.cleanup(); }
});
