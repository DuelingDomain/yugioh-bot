// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://marketing.example/"}
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, expect, it } from "vitest";

// Inline scripts run in the environment window, while Vitest exposes a global facade.
const browser = (globalThis as typeof globalThis & { jsdom: { window: Window & { posthog: typeof import("posthog-js").default } } }).jsdom.window;
const snippetPath = resolve(__dirname, "../../../site/public/analytics.js");

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  browser.fetch = async () => new Response("{}", { status: 200 });
});

async function runSnippet(key: string) {
  const script = document.createElement("script");
  script.dataset.key = key;
  script.textContent = await readFile(snippetPath, "utf8");
  document.head.appendChild(script);
}

it("does not load the landing-page SDK without a configured key", async () => {
  await runSnippet("");
  expect(document.querySelector('script[src]')).toBeNull();
  expect("posthog" in browser).toBe(false);
});

it("loads the standard landing snippet through the proxy and emits only safe cookieless pageviews", async () => {
  document.title = "Private text";
  window.history.replaceState(null, "", "/?email=member%40example.test#private-text");
  await runSnippet("test-project");
  expect(document.querySelector('script[src]')?.getAttribute("src")).toBe("/ingest/static/array.js");
  const sdkScript = document.createElement("script");
  sdkScript.textContent = await readFile(resolve(__dirname, "../../../node_modules/posthog-js/dist/array.js"), "utf8");
  document.head.appendChild(sdkScript);
  await Promise.resolve();
  const event = browser.posthog.capture("$pageview");
  expect(event?.properties).toMatchObject({ $current_url: "https://marketing.example/", $pathname: "/", distinct_id: "$posthog_cookieless", $cookieless_mode: true, $process_person_profile: false });
  expect(JSON.stringify(event)).not.toMatch(/Private text|private-text|member|email|referrer/);
  expect(browser.posthog.capture("$autocapture", { text: "private-text" })).toBeUndefined();
  expect(document.cookie).toBe("");
  expect(localStorage.length).toBe(0);
  expect(browser.posthog.sessionRecordingStarted()).toBe(false);
  window.history.pushState(null, "", "/privacy");
  expect(browser.posthog.capture("$pageview")).toBeUndefined();
  await Promise.resolve();
});
