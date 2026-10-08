import assert from "node:assert/strict";
import { test } from "node:test";
import { countDiscordHops, formatTimeline, redactUrl, type NavigationEntry } from "../live/timeline.ts";

test("redactUrl drops OAuth secrets, credentials and fragments while keeping safe markers", () => {
  assert.deepEqual(redactUrl("https://user:password@app.duelingdomain.com/sign-in?code=secret-code&state=secret-state&token=secret-token&existing_player=1&error=secret-error#secret-fragment"), {
    host: "app.duelingdomain.com", path: "/sign-in", query: "?existing_player=1&error=%5Bredacted%5D",
  });
  assert.deepEqual(redactUrl("https://discord.com/oauth2/authorize?client_id=123&redirect_uri=https%3A%2F%2Fclerk.app.duelingdomain.com&prompt=none"), {
    host: "discord.com", path: "/oauth2/authorize", query: "",
  });
});

test("redactUrl never echoes malformed URLs or arbitrary allowlisted values", () => {
  for (const url of ["not a URL: secret", "data:text/plain,secret", "javascript:secret", "about:blank"]) {
    assert.deepEqual(redactUrl(url), { host: "unknown", path: "[invalid URL]", query: "" });
  }
  assert.deepEqual(redactUrl("https://app.duelingdomain.com/sign-in?existing_player=secret&error=&error=another-secret"), {
    host: "app.duelingdomain.com", path: "/sign-in", query: "?error=%5Bredacted%5D",
  });
});

test("countDiscordHops counts trips to the Discord authorize page, not page loads inside one trip", () => {
  const entries: NavigationEntry[] = [
    { at: 1000, ...redactUrl("https://discord.com/oauth2/authorize?state=one") },
    { at: 1100, ...redactUrl("https://discord.com/login") },
    { at: 1200, ...redactUrl("https://discord.com/oauth2/authorize?state=one") },
    { at: 1300, ...redactUrl("https://discord.com.evil.test/oauth2/authorize") },
    { at: 1400, ...redactUrl("https://clerk.app.duelingdomain.com/v1/oauth_callback?code=secret") },
    { at: 1500, ...redactUrl("https://app.duelingdomain.com/api/auth/existing-player/start") },
    { at: 1600, ...redactUrl("https://discord.com/oauth2/authorize?state=two") },
    { at: 1700, ...redactUrl("https://app.duelingdomain.com/welcome-back") },
    { at: 1800, ...redactUrl("https://discord.com/login") },
  ];
  assert.equal(countDiscordHops(entries), 2);
  assert.equal(countDiscordHops([]), 0);
});

test("formatTimeline labels hosts, formats elapsed time, and includes total and hop count", () => {
  const entries: NavigationEntry[] = [
    { at: 1000, host: "localhost:3300", path: "/sign-in", query: "" },
    { at: 1410, host: "clerk.app.duelingdomain.com", path: "/v1/client/sign_ins", query: "" },
    { at: 2011, host: "discord.com", path: "/oauth2/authorize", query: "" },
    { at: 3200, host: "localhost:3300", path: "/sign-in", query: "?existing_player=1" },
    { at: 3500, host: "other.example", path: "/continue", query: "" },
  ];
  assert.equal(formatTimeline(entries, 1000, 4500, "http://localhost:3300"), [
    "+0.00s app /sign-in",
    "+0.41s clerk /v1/client/sign_ins",
    "+1.01s discord /oauth2/authorize",
    "+2.20s app /sign-in?existing_player=1",
    "+2.50s other.example /continue",
    "Total: 3.50s",
    "Discord authorize hops: 1",
  ].join("\n"));
});

test("formatTimeline handles an empty failed run", () => {
  assert.equal(formatTimeline([], 1000, 1050), "Total: 0.05s\nDiscord authorize hops: 0");
});
