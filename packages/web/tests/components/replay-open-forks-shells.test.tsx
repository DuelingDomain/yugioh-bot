// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelFormat } from "@yugidraft/shared/duels";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { frame, replayV2 } from "./replay-fixtures";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { DuelReplayView } from "@/components/duel/replay";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stamp = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace("T", " ");

let calls: Array<{ url: URL; init?: RequestInit }>;
function stubServer(format: DuelFormat) {
  calls = [];
  const frames = [0, 1, 2, 3].map((step) => frame({ step, format, hands: { 0: [100] }, log: step ? [step] : [] }));
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    calls.push({ url, init });
    if (url.pathname === "/api/admin/duels/forks") {
      return json({ forks: [{ slug: "fork-a", sourceSlug: "game-7", format: "1v1", createdAt: stamp, lastActivityAt: stamp }], limit: 4 });
    }
    if (url.pathname.endsWith("/replay/fork") && init?.method === "POST") {
      return json({ slug: "fork-9", sourceFrameId: "f2", initialSeat: 0, room: {} });
    }
    if (!url.pathname.endsWith("/replay")) return json({ cards: [] });
    return json({ ...replayV2({ format, frames }), capabilities: { canFork: true, privateSeats: [0] } });
  }));
}

class RO {
  constructor(private cb: () => void) {}
  observe() { this.cb(); }
  disconnect() {}
  unobserve() {}
}
beforeAll(() => {
  HTMLElement.prototype.getAnimations = () => [];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", RO);
  resetCoinTossState();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/duels/game-1/replay");
  nav.push.mockClear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

const click = (name: string | RegExp) => act(() => void fireEvent.click(screen.getByRole("button", { name })));
const listCalls = () => calls.filter((call) => call.url.pathname === "/api/admin/duels/forks");
const forkPosts = () => calls.filter((call) => call.url.pathname.endsWith("/replay/fork") && call.init?.method === "POST");

// A seek or a step back remounts the header of the FFA and Tag shells (the shell root is keyed by the reset key).
describe.each(["ffa4", "tag"] as const)("open forks and Jump in in the %s replay shell", (format) => {
  async function open() {
    stubServer(format);
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    await screen.findByRole("button", { name: "Open forks (1)" });
  }

  it("does not ask for the list again, and keeps the entry, when the owner seeks", async () => {
    await open();
    expect(listCalls()).toHaveLength(1);
    click("Next move");
    click("Next move");
    click("Previous move");
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("slider", { name: "Replay position" }), { target: { value: "3" } });
    click("Previous move");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole("button", { name: "Open forks (1)" })).toBeTruthy();
    expect(listCalls()).toHaveLength(1);
  });

  it("keeps Jump in shut while the fork opens, through a step back, and sends one request", async () => {
    await open();
    click("Next move");
    click("Next move");
    click(/Jump in/);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
    const button = () => screen.getByRole("button", { name: /Starting/ }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    // Step forward and back to the same move: the step back remounts the header.
    click("Next move");
    click("Previous move");
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Jump in/ })).toBeNull();
    expect(forkPosts()).toHaveLength(1);
  });
});
