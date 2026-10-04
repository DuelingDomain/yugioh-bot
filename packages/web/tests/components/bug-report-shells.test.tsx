// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
import { newBoard } from "@/components/duel/fx-lab/board";

const { state, mutate } = vi.hoisted(() => ({
  state: { room: null as DuelRoom | null },
  mutate: vi.fn(async () => {}),
}));
vi.mock("swr", () => ({ default: () => ({ data: state.room, error: null, isLoading: false, mutate }) }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/decks/api", () => ({ listSavedDecks: vi.fn(async () => []) }));

import { DuelRoomView } from "@/components/duel/room";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";

const fetchMock = vi.fn();
const connection = { connected: true, syncing: false, recovering: false, presence: null, resync: vi.fn() };

class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} unobserve() {} }
beforeAll(() => {
  HTMLElement.prototype.getAnimations = () => [];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith("/precheck") ? new Response(JSON.stringify({ knownLimits: [], duplicates: [] })) : new Response(JSON.stringify({ id: 12, issue: { number: 345, url: "https://github.com/imran443/yugioh-bot/issues/345" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const HOTKEYS = ["h", "H", "s", "S", "m", "M", " ", "1", "2", "3", "4", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", "f", "+", "-"];

/** Keys pressed in the open dialog, in its field and on its buttons, must not reach any duel hotkey (they would call preventDefault). */
function expectNoDuelHotkeys() {
  const targets = [screen.getByLabelText(/What went wrong\?/), screen.getByRole("button", { name: "Cancel" })];
  for (const target of targets) {
    for (const key of HOTKEYS) {
      // Enter in the field may only submit the form; the form needs both fields, so nothing is sent here.
      const notPrevented = fireEvent.keyDown(target, { key });
      if (target instanceof HTMLTextAreaElement || key !== "Enter") expect(notPrevented, `${key} on ${target.tagName}`).toBe(true);
    }
  }
  expect(screen.getByRole("dialog", { name: "Report a bug" })).toBeTruthy();
}

/** Opens the dialog from the room menu, fills it, sends it and checks the result and the Escape key. */
async function reportFromMenu(expected: { format: string; seat: number | null; slug: string }, entry = screen.getByRole("button", { name: "Report bug" })) {
  fireEvent.click(entry);
  const dialog = screen.getByRole("dialog", { name: "Report a bug" });
  expect(dialog).toBeTruthy();
  const wrong = screen.getByLabelText(/What went wrong\?/) as HTMLTextAreaElement;
  expect(wrong.required).toBe(true);
  expect(document.activeElement).toBe(wrong);
  const send = screen.getByRole("button", { name: "Send report" });
  fireEvent.change(wrong, { target: { value: "The chain froze after my Quick-Play." } });
  fireEvent.change(screen.getByLabelText(/What did you expect\?/), { target: { value: "The chain resolves." } });
  await act(async () => { fireEvent.click(send); });
  await waitFor(() => expect(screen.getByTestId("bug-report-done")).toBeTruthy());
  expect(screen.getByRole("link", { name: "#345" })).toHaveAttribute("href", "https://github.com/imran443/yugioh-bot/issues/345");

  // The room's developer report button may also ask the server; only the bug report call counts here.
  const calls = fetchMock.mock.calls.filter((call) => call[0] === "/api/bug-reports");
  expect(calls).toHaveLength(1);
  const [, init] = calls[0]!;
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ description: "The chain froze after my Quick-Play.", expected: "The chain resolves.", duelSlug: expected.slug });
  // The duel facts and the log are read by the server from the duel host; the browser sends browser data only.
  for (const key of Object.keys(body.context)) expect(["animationSpeed", "userAgent", "viewport", "timestamp"]).toContain(key);
  expect(Object.keys(body).sort()).toEqual(["context", "description", "duelSlug", "expected", "path"]);
  expect(JSON.stringify(body)).not.toMatch(/hand|Dark Magician|You added/i);

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Report a bug" })).toBeNull());
  return body;
}

describe("Report bug in the table shell", () => {
  function Shell() {
    const fixture = FFA3_FIXTURES.states.main;
    const room = { ...fixture.room, engine: { ...fixture.room.engine!, log: [
      { id: 1, text: "Ren Arata Normal Summons Blue-Eyes White Dragon" },
      { id: 2, text: "You added Dark Magician to your hand" },
      { id: 3, text: "Dark Magician to your hand" },
      { id: 4, text: "Ren Arata draws a card" },
    ] } };
    const controller = useFixtureController({ ...fixture, room }, { reducedMotion: true });
    return <TableShell fxActive={false} controller={controller} connection={connection} />;
  }

  it("opens from the Settings menu, sends browser context only, shows the issue and closes on Escape", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const opener = screen.getByRole("button", { name: "Report bug" });
    opener.focus();
    const body = await reportFromMenu({ format: "ffa3", seat: FFA3_FIXTURES.states.main.room.mySeat, slug: FFA3_FIXTURES.states.main.room.session.slug });
    expect(body.context.log).toBeUndefined();
    expect(body.context.turn).toBeUndefined();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("ignores duel hotkeys typed inside the dialog", () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expectNoDuelHotkeys();
  });

  it("shows Saved when GitHub is not set up and a clear text after a rate limit", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "Odd turn order after the third turn" } });
    fireEvent.change(screen.getByLabelText(/What did you expect\?/), { target: { value: "The turn order stays the same" } });

    // Answer only the report call; the pre-check keeps its normal empty answer.
    const answers = [
      new Response(JSON.stringify({ error: "Too many bug reports" }), { status: 429, headers: { "Retry-After": "120" } }),
      new Response(JSON.stringify({ id: 13, issue: null }), { status: 200 }),
    ];
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/precheck") ? new Response(JSON.stringify({ knownLimits: [], duplicates: [] })) : answers.shift()!);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    expect((await screen.findByRole("alert")).textContent).toContain("Try again in about 2 minutes");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    expect((await screen.findByTestId("bug-report-done")).textContent).toContain("Saved — the team will see it.");
  });
});

describe("Report bug in the Rooftop shell", () => {
  it("ignores duel hotkeys typed inside the dialog", () => {
    function Shell() {
      const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: true });
      return <TagShell fxActive={false} controller={controller} connection={connection} />;
    }
    render(<Shell />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Settings" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    expectNoDuelHotkeys();
  });

  it("opens from the Settings menu with the tag format", async () => {
    function Shell() {
      const fixture = TAG_FIXTURES.states.main;
      const controller = useFixtureController(fixture, { reducedMotion: true });
      return <TagShell fxActive={false} controller={controller} connection={connection} />;
    }
    render(<Shell />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Settings" })[0]!);
    await reportFromMenu({ format: "tag", seat: TAG_FIXTURES.states.main.room.mySeat, slug: TAG_FIXTURES.states.main.room.session.slug });
  });
});

describe("Report bug in the 1v1 room", () => {
  beforeEach(() => {
    state.room = makeSeriesRoom({ series: null, status: "active", mySeat: 0 });
    state.room.session.settings = defaultDuelSettings("normal");
    state.room.engine = { revision: 1, turn: 2, turnSeat: 1, phase: "main1", seats: newBoard().seats,
      prioritySeat: null, prompt: null, chain: [], events: [], result: null,
      log: [{ id: 1, text: "Sulman draws a card" }, { id: 2, text: "You added Dark Magician to your hand" }] } as NonNullable<DuelRoom["engine"]>;
  });

  it("opens from the Settings menu, sends browser context only and closes on Escape", async () => {
    render(<DuelRoomView slug="game-1" windowed />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const menuEntry = screen.getAllByRole("button", { name: "Report bug" }).find((button) => !button.hasAttribute("data-bug-header-button"))!;
    const body = await reportFromMenu({ format: "1v1", seat: 0, slug: "game-1" }, menuEntry);
    expect(body.context).toMatchObject({ animationSpeed: 1 });
    expect(JSON.stringify(body.context)).not.toMatch(/Sulman|Dark Magician/);
  });

  it("ignores duel hotkeys typed inside the dialog", () => {
    render(<DuelRoomView slug="game-1" windowed />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Report bug" }).find((button) => !button.hasAttribute("data-bug-header-button"))!);
    expectNoDuelHotkeys();
  });

  it("has a quiet Report bug chip in the header, next to the other header buttons, that sends browser context only", async () => {
    render(<DuelRoomView slug="game-1" windowed />);
    const header = document.querySelector("header")!;
    const button = within(header).getByRole("button", { name: "Report bug" });
    expect(button.className).toMatch(/header/);
    expect(button.className).not.toContain("bg-accent-cta");
    expect(button.hasAttribute("data-bug-header-button")).toBe(true);
    const body = await reportFromMenu({ format: "1v1", seat: 0, slug: "game-1" }, button);
    expect(body.context).toMatchObject({ animationSpeed: 1 });
    expect(JSON.stringify(body.context)).not.toMatch(/Sulman|Dark Magician/);
    // The floating button is not in the app shell here, and a header button is the only one on screen.
    expect(document.querySelector("[data-bug-fab]")).toBeNull();
  });
});
