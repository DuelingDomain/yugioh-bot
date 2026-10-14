// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CaptureResult, PostHog } from "posthog-js";

const state = vi.hoisted(() => ({ pathname: "/access", imported: false, events: [] as CaptureResult[], sdk: null as PostHog | null }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
// Keep the real SDK: observe its final events, replacing only external network I/O.
vi.mock("posthog-js", async importOriginal => {
  state.imported = true;
  const actual = await importOriginal<typeof import("posthog-js")>();
  state.sdk = actual.default;
  actual.default.on("eventCaptured", event => state.events.push(event));
  return actual;
});
import { PageViews } from "../src/lib/analytics/page-views";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  const offlineFetch = async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", offlineFetch);
  window.fetch = offlineFetch;
  state.pathname = "/access";
  window.history.replaceState(null, "", "/access");
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("loads no analytics module with an empty key or on pages outside the page-view scope", async () => {
  for (const [key, pathname] of [["", "/access"], ["   ", "/dashboard"], ["test-project", "/settings/account"], ["test-project", "/decks/12"], ["test-project", "/duels/new"], ["test-project", "/drafts/new"], ["test-project", "/sign-in"]]) {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key);
    state.pathname = pathname;
    const view = render(<PageViews />);
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
    expect(state.imported).toBe(false);
    view.unmount();
  }
});

it("captures anonymous cookieless key-page views across navigation without titles, slugs, or free text", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-project");
  document.title = "Private tournament title";
  window.history.replaceState(null, "", "/access?email=member%40example.test#private-text");
  const view = render(<StrictMode><PageViews /></StrictMode>);
  await waitFor(() => expect(state.events).toHaveLength(1));
  expect(state.events[0].event).toBe("$pageview");
  expect(state.events[0].properties).toMatchObject({ $pathname: "/access", $current_url: "http://localhost:3000/access", $cookieless_mode: true, distinct_id: "$posthog_cookieless", $process_person_profile: false });
  expect(document.cookie).toBe("");
  expect(localStorage.length).toBe(0);
  expect(state.sdk!.sessionRecordingStarted()).toBe(false);

  for (const [pathname, template] of [["/sign-up/invited-private-token", "/sign-up"], ["/dashboard", "/dashboard"], ["/drafts", "/drafts"], ["/draft/private-title", "/draft/[slug]"], ["/duels/private-title", "/duels/[slug]"], ["/tournaments", "/tournaments"], ["/tournaments/new", "/tournaments/new"], ["/tournament/private-title", "/tournament/[slug]"], ["/tournament/private-title/standings", "/tournament/[slug]/standings"], ["/cubes", "/cubes"], ["/cubes/42", "/cubes/[id]"]]) {
    const previousCount = state.events.length;
    await act(async () => {
      state.pathname = pathname;
      window.history.pushState(null, "", `${pathname}?title=private-text#private-text`);
      view.rerender(<StrictMode><PageViews /></StrictMode>);
    });
    expect(state.events).toHaveLength(previousCount + 1);
    expect(state.events.at(-1)!.properties.$pathname).toBe(template);
    expect(state.events.at(-1)!.properties.$current_url).toBe(`http://localhost:3000${template}`);
  }
  const keyPageCount = state.events.length;
  for (const pathname of ["/settings/account", "/decks/42", "/duels/private-title/replay", "/duels/new", "/drafts/new", "/cubes/42/private-text", "/tournament/private-title/private-text"]) {
    await act(async () => {
      state.pathname = pathname;
      window.history.pushState(null, "", pathname);
      view.rerender(<StrictMode><PageViews /></StrictMode>);
      document.body.click();
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(state.events).toHaveLength(keyPageCount);
  }
  await act(async () => {
    state.pathname = "/dashboard";
    window.history.pushState(null, "", "/dashboard");
    view.rerender(<StrictMode><PageViews /></StrictMode>);
  });
  expect(state.events).toHaveLength(keyPageCount + 1);
  const serialized = JSON.stringify(state.events);
  expect(serialized).not.toMatch(/private-title|private-text|member|Private tournament/);
  expect(state.events.every(event => event.event === "$pageview")).toBe(true);
});
