import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { request } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";

async function provider(sessionId: string | null) {
  let credentials: URLSearchParams | null = null;
  const server = createServer(async (req, res) => {
    if (req.url === "/api/auth/csrf") {
      res.setHeader("Set-Cookie", "csrf=test; Path=/");
      res.end(JSON.stringify({ csrfToken: "csrf-token" }));
    } else if (req.url === "/api/auth/callback/e2e") {
      let body = "";
      for await (const chunk of req) body += chunk;
      credentials = new URLSearchParams(body);
      assert.match(req.headers.cookie ?? "", /csrf=test/);
      res.writeHead(302, { Location: "/", "Set-Cookie": "session=signed; Path=/" });
      res.end();
    } else if (req.url === "/api/auth/session") {
      assert.match(req.headers.cookie ?? "", /session=signed/);
      res.end(JSON.stringify(sessionId ? { user: { id: sessionId } } : {}));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const webUrl = `http://127.0.0.1:${address.port}`;
  const api = await request.newContext({ baseURL: webUrl });
  return { api, webUrl, credentials: () => credentials, async close() { await api.dispose(); await new Promise<void>((done) => server.close(() => done())); } };
}

test("manual login sends CSRF and E2E credentials and verifies the player session", async () => {
  const login = await provider("900000000000000101");
  try {
    await authenticatePlayer(login.api, { discordId: "900000000000000101", name: "E2E Alice" }, "throwaway-secret", login.webUrl);
    assert.equal(login.credentials()?.get("csrfToken"), "csrf-token");
    assert.equal(login.credentials()?.get("discordId"), "900000000000000101");
    assert.equal(login.credentials()?.get("name"), "E2E Alice");
    assert.equal(login.credentials()?.get("secret"), "throwaway-secret");
    assert.equal(login.credentials()?.get("callbackUrl"), login.webUrl);
  } finally { await login.close(); }
});

test("manual login rejects a callback that did not create the requested session", async () => {
  const login = await provider(null);
  try {
    await assert.rejects(authenticatePlayer(login.api, { discordId: "900000000000000101", name: "E2E Alice" }, "throwaway-secret", login.webUrl), /did not create.*session/i);
  } finally { await login.close(); }
});

test("login CLI rejects unknown players before opening a browser", () => {
  const result = spawnSync(process.execPath, ["stack/login.mjs", "p5"], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /p1.*p2.*p3.*p4/);
});
