// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelCardInfo } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { SOLID_CARDS as CARDS } from "@/components/duel/solid/fixtures/cards";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableController } from "@/components/duel/table/types";
import { PREVIEW_HIDE_MS } from "@/components/duel/table/grid-preview";
import { TagShell } from "@/components/duel/tag/tag-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});

function media(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type StateId = keyof typeof TAG_FIXTURES.states;

/** The Domain format: the Rooftop shows your Deck Master and your partner's. Seats 0 and 2 are one team, 1 and 3 the other. */
function withMasters(controller: TableController): TableController {
  const master = (info: DuelCardInfo, returns: number, nextCost: number) => ({ card: { ...info }, inZone: true, returns, nextCost });
  const masters = new Map<number, ReturnType<typeof master>>([
    [0, master(CARDS.darkMagician, 0, 0)],
    [2, master(CARDS.blueEyes, 1, 500)],
  ]);
  const seats = controller.engine.seats.map((view) => (masters.has(view.seat) ? { ...view, deckMaster: masters.get(view.seat) } : view));
  return {
    ...controller,
    engine: { ...controller.engine, seats },
    room: { ...controller.room, session: { ...controller.room.session, mode: "domain" } },
  } as TableController;
}

function Shell({ id = "main", domain = false, fx = false, tweak }: { id?: StateId; domain?: boolean; fx?: boolean; tweak?: (controller: TableController) => TableController }) {
  const base = useFixtureController(TAG_FIXTURES.states[id], { reducedMotion: true });
  const shown = domain ? withMasters(base) : base;
  return <TagShell controller={tweak ? tweak(shown) : shown} teamNames={[...TAG_TEAM_NAMES] as [string, string]} fxActive={fx} />;
}

const flyout = () => screen.getByTestId("hud-flyout");
const isOpen = () => flyout().getAttribute("data-open") === "true";

describe("the floating HUD of the Tag Rooftop", () => {
  it("swaps the header, the side columns and the camera column for the pills and the dock", () => {
    media(false);
    const { container } = render(<Shell />);
    expect(container.querySelector("[data-hud='true']")).not.toBeNull();
    expect(screen.getByTestId("hud-top").tagName).toBe("HEADER");
    expect(screen.getByTestId("hud-top").hasAttribute("data-tag-header")).toBe(true);
    expect(screen.getByTestId("hud-bottom")).toBeTruthy();
    expect(container.querySelector("[aria-label='Camera'][class*='right']")).toBeNull();
    for (const id of ["log", "settings", "camera"]) expect(screen.getByTestId(`hud-dock-${id}`)).toBeTruthy();
    expect(screen.queryByTestId("hud-dock-chain")).toBeNull();
    expect(screen.queryByTestId("hud-dock-history")).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("keeps the turn, the team and the turn order in the top pill", () => {
    media(false);
    render(<Shell />);
    const top = within(screen.getByTestId("hud-top"));
    expect(top.getByText(/Turn 5/)).toBeTruthy();
    expect(top.getByTestId("who-pill")).toBeTruthy();
    expect(top.getByRole("list", { name: "Turn order" })).toBeTruthy();
    expect(top.getByRole("button", { name: /Sound effects/ })).toBeTruthy();
  });

  it("opens a pane from its icon and closes it with the same icon, Esc or a click outside", () => {
    media(false);
    render(<Shell />);
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(flyout().getAttribute("data-pane")).toBe("settings");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(flyout().getAttribute("data-pane")).toBe("log");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it("holds the camera dock in the fourth flyout, with the seat buttons", () => {
    media(false);
    const { container } = render(<Shell />);
    fireEvent.click(screen.getByTestId("hud-dock-camera"));
    expect(flyout().getAttribute("data-pane")).toBe("camera");
    expect(within(flyout()).getByRole("tabpanel").querySelector("[data-camera-dock]")).not.toBeNull();
    expect(container.querySelectorAll("[data-camera-dock]")).toHaveLength(1);
    expect(within(flyout()).getByRole("tabpanel").querySelector("[data-seat-btn='2']")).not.toBeNull();
  });

  it("keeps the camera keys working while the camera flyout is shut", () => {
    media(false);
    const { container } = render(<Shell />);
    const seat = () => container.querySelector("[data-seat-btn='2']")?.getAttribute("aria-pressed");
    expect(seat()).toBe("false");
    fireEvent.keyDown(window, { key: "3" });
    expect(seat()).toBe("true");
  });

  it("shows the chain tower under the dock while a chain is live", () => {
    media(false);
    render(<Shell id="chain-2" />);
    expect(screen.getByTestId("chain-tower").getAttribute("data-links")).toBe("2");
    expect(screen.queryByTestId("hud-dock-chain")).toBeNull();
  });

  it("opens every link's details from the chain strip, as the tower has no Chain button", () => {
    media(false);
    render(<Shell id="chain-2" fx />);
    expect(within(screen.getByTestId("chain-tower")).queryByRole("button", { name: /Chain/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Chain details" })).toBeNull();
    fireEvent.click(document.querySelector("[data-chain-strip]") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "Chain details" });
    expect(sheet.querySelectorAll("[data-chain-row]")).toHaveLength(2);
  });

  it("has no chain tower without a chain", () => {
    media(false);
    render(<Shell />);
    expect(screen.queryByTestId("chain-tower")).toBeNull();
  });

  it("keeps the prompt tray in the floating card: a prompt another seat owns shows there", () => {
    media(false);
    const { container } = render(<Shell id="main" tweak={(controller) => ({ ...controller, viewerSeat: 1 })} />);
    const tray = container.querySelector("[data-prompt-surface][class*='hudTray']") as HTMLElement;
    expect(tray).not.toBeNull();
    expect(tray.textContent).toMatch(/choosing|waiting/i);
  });

  it("puts the phase buttons on the helipad and keeps the turn controls in the bottom pill", () => {
    media(false);
    const onAnswer = vi.fn();
    const { container } = render(<Shell tweak={(controller) => ({ ...controller, onAnswer })} />);
    const slot = container.querySelector("[data-phase-hub-slot]") as HTMLElement;
    expect(slot).not.toBeNull();
    const battle = within(slot).getByRole("button", { name: "Go to the Battle Phase" });
    act(() => void fireEvent.click(battle));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "to_bp" });
    const bottom = screen.getByTestId("hud-bottom");
    expect(within(bottom).queryByRole("button", { name: "Go to the Battle Phase" })).toBeNull();
    expect(bottom.querySelector("nav[data-phases='hub']")).not.toBeNull();
  });

  it("hides the phase hub while a centered prompt covers the helipad", () => {
    media(false);
    const { container } = render(<Shell id="target-pick" />);
    expect(container.querySelector("[data-phase-hub-slot]")).toBeNull();
  });

  it("keeps the old layout on a narrow screen: no dock, no pills", () => {
    media(true);
    const { container } = render(<Shell />);
    expect(container.querySelector("[data-hud]")).toBeNull();
    expect(screen.queryByTestId("hud-dock")).toBeNull();
    expect(screen.queryByTestId("hud-top")).toBeNull();
    expect(container.querySelector("[aria-label='Mobile duel panels']")).not.toBeNull();
  });
});

describe("the Deck Master plates of the Tag Rooftop", () => {
  it("shows no plate outside the Domain format", () => {
    media(false);
    render(<Shell />);
    expect(screen.queryByTestId("hud-master")).toBeNull();
    expect(screen.queryByTestId("hud-other")).toBeNull();
  });

  it("shows your master on the left and your partner's on the right, with their real cards", () => {
    media(false);
    render(<Shell domain />);
    expect(screen.getByTestId("hud-master-token").getAttribute("aria-label")).toContain("Dark Magician");
    expect(screen.getByTestId("hud-other-token").getAttribute("aria-label")).toContain("Blue-Eyes");
    expect(screen.getByTestId("hud-other").getAttribute("data-slot")).toBe("other");
    expect(screen.queryAllByTestId("hud-other-action")).toHaveLength(0);
  });

  it("opens the details in a flyout and closes them with the token or Esc", () => {
    media(false);
    render(<Shell domain />);
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(screen.getByTestId("hud-master-flyout")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();
    fireEvent.click(screen.getByTestId("hud-other-token"));
    expect(screen.getByTestId("hud-other-returns").textContent).toBe("1");
    expect(screen.getByTestId("hud-other-cost").textContent).toBe("500 LP");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("hud-other-flyout")).toBeNull();
  });

  it("offers Summon or Set on your plate only when the engine lists it", () => {
    media(false);
    render(<Shell domain />);
    expect(screen.queryAllByTestId("hud-master-action")).toHaveLength(0);
    expect(screen.getByTestId("hud-master-inspect")).toBeTruthy();
  });
});

describe("the hover preview of the Tag Rooftop", () => {
  it("slides in for a hovered card and hides after a short delay, without opening a flyout", () => {
    vi.useFakeTimers();
    media(false);
    const { container } = render(<Shell />);
    expect(screen.queryByTestId("hover-preview")).toBeNull();
    const card = container.querySelector("[data-hand-seat='0'] [data-zones]") as HTMLElement;
    fireEvent.mouseEnter(card);
    const preview = screen.getByTestId("hover-preview");
    expect(preview.getAttribute("data-open")).toBe("true");
    expect(isOpen()).toBe(false);
    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });

  it("never opens the Card flyout on its own: not by a hover, not by a focus", () => {
    media(false);
    const { container } = render(<Shell />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones]") as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.focus(card);
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.mouseEnter(card);
    expect(flyout().getAttribute("data-pane")).toBe("log");
  });

  it("stays out of the way while a flyout is open", () => {
    media(false);
    const { container } = render(<Shell />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.mouseEnter(container.querySelector("[data-hand-seat='0'] [data-zones]") as HTMLElement);
    expect(screen.queryByTestId("hover-preview")).toBeNull();
  });
});

describe("the pinned card peek of the Tag Rooftop", () => {
  it("a click on a face-up monster pins the peek, with no Card flyout and no second panel", () => {
    vi.useFakeTimers();
    media(false);
    const { container } = render(<Shell />);
    const zone = container.querySelector("[data-kind='mz'][data-occupied='true']") as HTMLElement;
    const card = zone.querySelector("button") as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card);
    expect(container.querySelector("[data-camera-mode]")?.getAttribute("data-camera-mode")).toBe("focus");
    expect(container.querySelector("[data-camera-seat]")?.getAttribute("data-camera-seat")).toBe("0");
    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 4); });
    expect(screen.getAllByTestId("hover-preview")).toHaveLength(1);
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("true");
    expect(isOpen()).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });
});

describe("the pinned card peek of the Tag Rooftop with a prompt", () => {
  it("Esc closes the pin and keeps the prompt open; the next Esc declines it", () => {
    vi.useFakeTimers();
    media(false);
    const onAnswer = vi.fn();
    const answering = (controller: TableController): TableController => {
      const prompt = controller.prompt ? { ...controller.prompt, cancelable: true } : null;
      return { ...controller, onAnswer, prompt, engine: { ...controller.engine, prompt } };
    };
    const { container } = render(<Shell id="chain-2" tweak={answering} />);
    const zone = container.querySelector("[data-kind='mz'][data-occupied='true']") as HTMLElement;
    fireEvent.click(zone.querySelector("button") as HTMLElement);
    expect(screen.getByTestId("hover-preview").getAttribute("data-pinned")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("the hover preview of the Tag Rooftop while a card menu is open", () => {
  it("keeps the card of the menu in the panel once the pointer has left it", () => {
    media(false);
    const { container } = render(<Shell />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones]") as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.mouseLeave(card);
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("hover-preview").textContent).toContain("Dark Hole");
    expect(isOpen()).toBe(false);
  });
});

describe("the Tag HUD with a prompt", () => {
  /** The prompt can be declined (Pass), and every answer goes to `onAnswer`. */
  const answering = (onAnswer: (answer: DuelAnswer) => void) => (controller: TableController): TableController => {
    const prompt = controller.prompt ? { ...controller.prompt, cancelable: true } : null;
    return { ...controller, onAnswer, prompt, engine: { ...controller.engine, prompt } };
  };

  it("Esc closes an open flyout and does not answer the prompt", () => {
    media(false);
    const onAnswer = vi.fn();
    render(<Shell id="chain-2" tweak={answering(onAnswer)} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("an open flyout does not hold the other prompt keys: N still says no", () => {
    media(false);
    const onAnswer = vi.fn();
    render(<Shell id="chain-2" tweak={answering(onAnswer)} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.keyDown(window, { key: "n" });
    expect(isOpen()).toBe(true);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("the Tag clocks at the top left", () => {
  it("shows all four clocks in the header with the answering seat marked, and none in the bottom pill", () => {
    media(false);
    const withClock = (activeSeat: number | null) => (controller: TableController): TableController => ({
      ...controller,
      room: { ...controller.room, clock: { turn: 1, remainingMs: [180_000, 170_000, 160_000, 150_000], activeSeat, startedAt: activeSeat == null ? null : 0, serverNow: 0 } },
    });
    const { unmount } = render(<Shell tweak={withClock(1)} />);
    const timer = within(screen.getByTestId("hud-top")).getByRole("timer");
    expect(timer.querySelectorAll('[data-testid="clock-cell"]')).toHaveLength(4);
    expect(timer.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(within(screen.getByTestId("hud-bottom")).queryByRole("timer")).toBeNull();
    unmount();
    render(<Shell tweak={withClock(null)} />);
    const idle = within(screen.getByTestId("hud-top")).getByRole("timer");
    expect(idle.querySelectorAll('[data-active="true"]')).toHaveLength(0);
  });
});
