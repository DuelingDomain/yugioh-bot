import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it } from "vitest";

let browser: JSDOM["window"] & { posthog?: typeof import("posthog-js").default };
const snippetPath = resolve(__dirname, "../../../site/public/analytics.js");

beforeEach(() => {
  browser = new JSDOM("", { url: "https://marketing.example/", runScripts: "dangerously" }).window;
  browser.fetch = async () => new Response("{}", { status: 200 });
});
afterEach(async () => {
  try {
    if (browser.posthog?.__loaded) await browser.posthog.shutdown();
  } finally {
    browser.close();
  }
});

async function runSnippet(key: string) {
  const { document } = browser;
  const script = document.createElement("script");
  script.dataset.key = key;
  script.textContent = await readFile(snippetPath, "utf8");
  document.head.appendChild(script);
}

it("does not load the landing-page SDK without a configured key", async () => {
  await runSnippet("");
  expect(browser.document.querySelector('script[src]')).toBeNull();
  expect("posthog" in browser).toBe(false);
});

it("loads the standard landing snippet through the proxy and emits only safe cookieless pageviews", async () => {
  const { document, history, navigator, localStorage } = browser;
  document.title = "Private text";
  history.replaceState(null, "", "/?email=member%40example.test#private-text");
  await runSnippet("test-project");
  expect(document.querySelector('script[src]')?.getAttribute("src")).toBe("/ingest/static/array.js");
  const sdkScript = document.createElement("script");
  sdkScript.textContent = await readFile(resolve(__dirname, "../../../node_modules/posthog-js/dist/array.js"), "utf8");
  document.head.appendChild(sdkScript);
  await Promise.resolve();
  const posthog = browser.posthog!;
  const event = posthog.capture("$pageview");
  expect(event?.properties).toMatchObject({ $current_url: "https://marketing.example/", $pathname: "/", distinct_id: "$posthog_cookieless", $cookieless_mode: true, $raw_user_agent: navigator.userAgent, $process_person_profile: false });
  expect(JSON.stringify(event)).not.toMatch(/Private text|private-text|member|email|referrer/);
  expect(posthog.capture("$autocapture", { text: "private-text" })).toBeUndefined();
  expect(document.cookie).toBe("");
  expect(localStorage.length).toBe(0);
  expect(posthog.sessionRecordingStarted()).toBe(false);
  history.pushState(null, "", "/privacy");
  expect(posthog.capture("$pageview")).toBeUndefined();
  await Promise.resolve();
});
