// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import type { DuelAnswer } from "@yugidraft/shared/duels";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { PREVIEW_HIDE_MS } from "@/components/duel/table/grid-preview";
import { TableShell } from "@/components/duel/table/table-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: (entries: unknown[]) => void) {}
    observe() { this.cb([]); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Shell({ state, onAnswer }: { state: TableFixtureState; onAnswer?: (answer: DuelAnswer) => void }) {
  const base = useFixtureController(state, { reducedMotion: true });
  const controller = onAnswer ? { ...base, onAnswer } : base;
  return <TableShell controller={controller} />;
}
const stateOf = (id: keyof typeof FFA4_FIXTURES.states) => FFA4_FIXTURES.states[id];

/** The side content is a set of left-edge drawers (bigger-field contract): a tab each, closed at rest, one open at most. */
const drawer = (name: string) => document.querySelector<HTMLElement>(`[data-edge-drawer="${name}"]`)!;
const tab = (name: string) => drawer(name).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const openNames = () => [...document.querySelectorAll<HTMLElement>('[data-edge-drawer][data-state="open"]')].map((node) => node.dataset.edgeDrawer);
const isOpen = () => openNames().length > 0;
const openName = () => openNames()[0] ?? null;
const openTab = (name: string) => fireEvent.click(tab(name));

describe("the floating HUD of the 4-way grid", () => {
  it("shows the edge tabs instead of the dock and the side columns, and nothing open at rest", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    expect(container.querySelector("[data-hud='true']")).not.toBeNull();
    expect(container.querySelector("[data-edge-hud='true']")).not.toBeNull();
    expect(screen.getByTestId("hud-top")).toBeTruthy();
    // No full-width bottom bar: the turn controls sit in the corner cluster.
    expect(screen.queryByTestId("hud-bottom")).toBeNull();
    expect(screen.getByTestId("hud-corner")).toBeTruthy();
    for (const name of ["Log", "Settings", "Inspect"]) expect(tab(name).getAttribute("aria-expanded")).toBe("false");
    // The dock and its flyout are gone, and so is the History pane that only repeated the Log.
    expect(screen.queryByTestId("hud-dock-log")).toBeNull();
    expect(screen.queryByTestId("hud-flyout")).toBeNull();
    // The Chain tab shows only while a chain is live.
    expect(document.querySelector('[data-edge-drawer="Chain"]')).toBeNull();
    expect(document.querySelector('[data-edge-drawer="Deck Master"]')).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("opens a drawer from its tab, swaps to another one, and closes with the same tab", () => {
    render(<Shell state={stateOf("main")} />);
    openTab("Settings");
    expect(openName()).toBe("Settings");
    expect(tab("Settings").getAttribute("aria-expanded")).toBe("true");
    openTab("Log");
    expect(openNames()).toEqual(["Log"]);
    openTab("Log");
    expect(isOpen()).toBe(false);
  });

  it("closes with Esc and with a click outside, but not with a click inside", () => {
    render(<Shell state={stateOf("main")} />);
    openTab("Log");
    fireEvent.pointerDown(within(drawer("Log")).getByRole("dialog", { name: "Log" }));
    expect(isOpen()).toBe(true);
    // A press and click on another tab swaps to it.
    fireEvent.pointerDown(tab("Settings"));
    fireEvent.click(tab("Settings"));
    expect(openNames()).toEqual(["Settings"]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);

    openTab("Log");
    fireEvent.pointerDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it("keeps the chain tower in a Chain drawer during a chain, and glows its tab", () => {
    render(<Shell state={stateOf("chain-2")} />);
    expect(tab("Chain").getAttribute("data-attention")).toBe("true");
    const tower = within(drawer("Chain")).getByTestId("chain-tower");
    expect(tower.getAttribute("data-links")).toBe("2");
    // Newest link on top: link 2 is the card that resolves first.
    expect(within(tower).getAllByTestId("chain-row").map((row) => row.getAttribute("data-link"))).toEqual(["2", "1"]);
    expect(within(tower).getByText("Mystical Space Typhoon")).toBeTruthy();
    expect(isOpen()).toBe(false);
    openTab("Chain");
    expect(openName()).toBe("Chain");
    openTab("Log");
    expect(openNames()).toEqual(["Log"]);
  });

  it("opens every link's details from the chain strip, as the tower has no Chain button", () => {
    render(<Shell state={stateOf("chain-2")} />);
    expect(within(screen.getByTestId("chain-tower")).queryByRole("button", { name: /Chain/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Chain details" })).toBeNull();
    fireEvent.click(document.querySelector("[data-chain-strip]") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "Chain details" });
    expect(sheet.querySelectorAll("[data-chain-row]")).toHaveLength(2);
  });

  it("has no chain tower when no chain is open", () => {
    render(<Shell state={stateOf("main")} />);
    expect(screen.queryByTestId("chain-tower")).toBeNull();
  });
});

describe("the hover card preview", () => {
  const myCard = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label="Celtic Guardian"]')!;
  const preview = () => screen.getByTestId("hover-preview");

  it("shows nothing until a card is hovered", () => {
    render(<Shell state={stateOf("main")} />);
    expect(screen.queryByTestId("hover-preview")).toBeNull();
  });

  it("slides out with the card, then hides after a short delay", () => {
    vi.useFakeTimers();
    const { container } = render(<Shell state={stateOf("main")} />);
    const card = myCard(container);
    expect(card).toBeTruthy();
    fireEvent.mouseEnter(card);
    expect(preview().getAttribute("data-open")).toBe("true");
    expect(within(preview()).getByText("Celtic Guardian")).toBeTruthy();
    expect(within(preview()).getByText("ATK 1400 / DEF 1200")).toBeTruthy();
    expect(within(preview()).getByText("Aster")).toBeTruthy();
    // No Inspect drawer opens on a hover.
    expect(isOpen()).toBe(false);

    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS - 20); });
    expect(preview().getAttribute("data-open")).toBe("true");
    act(() => { vi.advanceTimersByTime(40); });
    expect(preview().getAttribute("data-open")).toBe("false");
  });

  it("does not slide under reduced motion", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    fireEvent.mouseEnter(myCard(container));
    expect(preview().getAttribute("data-motion")).toBe("none");
  });

  it("does not open the Card flyout on a hover", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    fireEvent.mouseEnter(myCard(container));
    expect(isOpen()).toBe(false);
  });
});

describe("the pinned card peek of the 4-way grid", () => {
  const myCard = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label="Celtic Guardian"]')!;

  it("a click on a card pins the peek and opens no Card flyout", () => {
    vi.useFakeTimers();
    const { container } = render(<Shell state={stateOf("main")} />);
    const card = myCard(container);
    fireEvent.mouseEnter(card);
    fireEvent.click(card);
    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 4); });
    const preview = screen.getByTestId("hover-preview");
    expect(screen.getAllByTestId("hover-preview")).toHaveLength(1);
    expect(preview.getAttribute("data-pinned")).toBe("true");
    expect(preview.getAttribute("data-open")).toBe("true");
    expect(within(preview).getByText("Celtic Guardian")).toBeTruthy();
    expect(isOpen()).toBe(false);
    // Esc lets it go; the X button too.
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(preview.getAttribute("data-open")).toBe("false");
    fireEvent.click(card);
    expect(preview.getAttribute("data-open")).toBe("true");
    fireEvent.click(within(preview).getByRole("button", { name: "Close Celtic Guardian preview" }), { detail: 1 });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(preview.getAttribute("data-open")).toBe("false");
  });

  it("Esc closes the pin and does not answer the prompt", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell state={stateOf("chain-2")} onAnswer={onAnswer} />);
    const card = container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label]')!;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    const pinned = screen.queryByTestId("hover-preview")?.getAttribute("data-pinned") === "true";
    expect(pinned).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  /** The "main" state with a Celtic Guardian that has a counter and Xyz materials, and a graveyard of two cards for seat 0. */
  function richState(): TableFixtureState {
    const state = structuredClone(stateOf("main"));
    const seat = state.room.engine!.seats.find((view) => view.seat === 0)!;
    const guardian = seat.hand.find((card) => card?.name === "Celtic Guardian")!;
    Object.assign(guardian, { counters: [{ type: 4, count: 2 }], materials: [{ ...guardian, code: 111, name: "Material A" }] });
    const grave = (sequence: number) => ({ ...seat.hand[0]!, location: 16, sequence, name: `Grave ${sequence}` });
    seat.graveyard = [grave(0), grave(1)];
    return state;
  }

  it("shows the same extra lines as the Card flyout: counters and materials", () => {
    const { container } = render(<Shell state={richState()} />);
    fireEvent.click(myCard(container));
    const lines = within(screen.getByTestId("hover-preview-extras")).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["Counter 4: 2", "Materials: Material A"]);
  });

  it("a pile lets the pin go, and the pin does not come back when the pile closes", () => {
    vi.useFakeTimers();
    const { container } = render(<Shell state={richState()} />);
    fireEvent.click(myCard(container));
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Graveyard \(2\)/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });

  it("a click on a card inside an open pile opens the Card flyout and pins nothing", () => {
    const { container } = render(<Shell state={richState()} />);
    fireEvent.click(screen.getByRole("button", { name: /Graveyard \(2\)/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: /Grave \d/ })[0]);
    expect(openName()).toBe("Inspect");
    expect(container.querySelectorAll("[data-testid='hover-preview'][data-pinned='true']")).toHaveLength(0);
  });

  it("takes the fresh copy of the pinned card at a new revision, and lets the pin go when the card is gone", () => {
    vi.useFakeTimers();
    const first = stateOf("main");
    const view = render(<Shell state={first} />);
    fireEvent.click(myCard(view.container));
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("ATK 1400 / DEF 1200");
    const changed = structuredClone(first);
    const seat = changed.room.engine!.seats.find((entry) => entry.seat === 0)!;
    seat.hand.find((card) => card?.name === "Celtic Guardian")!.attack = 2400;
    view.rerender(<Shell state={changed} />);
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("ATK 2400 / DEF 1200");
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    const gone = structuredClone(first);
    const goneSeat = gone.room.engine!.seats.find((entry) => entry.seat === 0)!;
    goneSeat.hand = goneSeat.hand.filter((card) => card?.name !== "Celtic Guardian");
    view.rerender(<Shell state={gone} />);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });

  it("a new prompt for the viewer's seat lets the pin go", () => {
    vi.useFakeTimers();
    const first = stateOf("main");
    const view = render(<Shell state={first} />);
    fireEvent.click(myCard(view.container));
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    const next = structuredClone(first);
    next.room.engine!.revision += 1;
    next.room.engine!.prompt = { ...next.room.engine!.prompt!, id: "next-prompt" };
    view.rerender(<Shell state={next} />);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });

  it("a press on a prompt button lets the pin go, and the button still answers", () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    const { container } = render(<Shell state={stateOf("chain-2")} onAnswer={onAnswer} />);
    fireEvent.click(container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label]')!);
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    const pass = screen.getByRole("button", { name: /^(Pass|No)\b/ });
    fireEvent.pointerDown(pass);
    fireEvent.click(pass);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("the X button by keyboard returns focus to the card, and is named after it", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    const card = myCard(container);
    fireEvent.click(card);
    expect(screen.getByRole("complementary", { name: "Pinned card" })).toBe(screen.getByTestId("hover-preview"));
    fireEvent.click(screen.getByRole("button", { name: "Close Celtic Guardian preview" }), { detail: 0 });
    expect(document.activeElement).toBe(card);
  });

  it("a click on a card that opens its action menu pins nothing", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    const card = container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label="Raigeki"]')!;
    fireEvent.click(card);
    expect(screen.queryByRole("menu")).not.toBeNull();
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBeNull();
  });
});

describe("the HUD of the 4-way grid with a prompt", () => {
  it("Esc closes an open flyout and does not answer the prompt", () => {
    const onAnswer = vi.fn();
    render(<Shell state={stateOf("chain-2")} onAnswer={onAnswer} />);
    openTab("Log");
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("an open flyout does not hold the other prompt keys: N still says no", () => {
    const onAnswer = vi.fn();
    render(<Shell state={stateOf("chain-2")} onAnswer={onAnswer} />);
    openTab("Log");
    fireEvent.keyDown(window, { key: "n" });
    expect(isOpen()).toBe(true);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("leaves Esc to a modal dialog, and the flyout stays", () => {
    render(<Shell state={stateOf("main")} />);
    openTab("Log");
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(true);
    modal.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
  });
});

describe("the clocks at the top left of the 4-way grid", () => {
  it("shows every seat's clock in the header, marks the answering seat, and keeps the corner free", () => {
    const running = structuredClone(stateOf("main"));
    running.room.clock = { ...running.room.clock!, activeSeat: 1, startedAt: running.room.clock!.serverNow };
    const { unmount } = render(<Shell state={running} />);
    const timer = within(screen.getByTestId("hud-top")).getByRole("timer");
    const cells = timer.querySelectorAll('[data-testid="clock-cell"]');
    expect(cells).toHaveLength(running.room.clock!.remainingMs.length);
    expect(timer.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(cells[1]?.getAttribute("data-active")).toBe("true");
    expect(within(screen.getByTestId("hud-corner")).queryByRole("timer")).toBeNull();
    unmount();
    const idle = structuredClone(stateOf("main"));
    idle.room.clock = { ...idle.room.clock!, activeSeat: null };
    render(<Shell state={idle} />);
    const idleTimer = within(screen.getByTestId("hud-top")).getByRole("timer");
    expect(idleTimer.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  });
});

describe("the hover card preview while its action menu is open", () => {
  it("keeps the card of the menu in the panel once the pointer has left it", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    const card = container.querySelector<HTMLElement>('[data-hand-seat="0"] button[aria-label="Raigeki"]')!;
    fireEvent.mouseEnter(card);
    fireEvent.click(card);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.mouseLeave(card);
    const preview = screen.getByTestId("hover-preview");
    expect(preview.getAttribute("data-open")).toBe("true");
    expect(within(preview).getByText("Raigeki")).toBeTruthy();
    expect(isOpen()).toBe(false);
  });
});
