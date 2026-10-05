// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_DMZONE } from "@/components/duel/constants";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { PREVIEW_HIDE_MS } from "@/components/duel/table/grid-preview";
import { TableShell } from "@/components/duel/table/table-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
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

function Shell({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}
const stateOf = (id: keyof typeof FFA4_FIXTURES.states) => FFA4_FIXTURES.states[id];

/** The "main" state with Aster's Deck Master in its zone and two legal summons on it. */
function masterState(): TableFixtureState {
  const state = structuredClone(stateOf("main"));
  const engine = state.room.engine!;
  const aster = engine.seats.find((seat) => seat.seat === 0)!;
  aster.deckMaster = { ...aster.deckMaster!, inZone: true };
  engine.prompt = {
    ...engine.prompt!,
    options: [
      ...engine.prompt!.options,
      { id: "dm-summon", label: "Normal Summon Sage with Eyes of Blue", controller: 0, location: LOCATION_DMZONE, sequence: 0 },
      { id: "dm-set", label: "Set monster Sage with Eyes of Blue", controller: 0, location: LOCATION_DMZONE, sequence: 0 },
    ],
  };
  return state;
}

const flyout = () => screen.getByTestId("hud-flyout");
const isOpen = () => flyout().getAttribute("data-open") === "true";

describe("the floating HUD of the 4-way grid", () => {
  it("shows the dock instead of the side columns, and nothing open at rest", () => {
    const { container } = render(<Shell state={stateOf("main")} />);
    expect(container.querySelector("[data-hud='true']")).not.toBeNull();
    expect(screen.getByTestId("hud-top")).toBeTruthy();
    expect(screen.getByTestId("hud-bottom")).toBeTruthy();
    for (const id of ["log", "settings", "history", "chain"]) expect(screen.getByTestId(`hud-dock-${id}`)).toBeTruthy();
    expect(isOpen()).toBe(false);
  });

  it("opens a pane from its dock icon and closes it with the same icon", () => {
    render(<Shell state={stateOf("main")} />);
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-pane")).toBe("settings");
    expect(screen.getByTestId("hud-dock-settings").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("hud-dock-history"));
    expect(flyout().getAttribute("data-pane")).toBe("history");
    fireEvent.click(screen.getByTestId("hud-dock-history"));
    expect(isOpen()).toBe(false);
  });

  it("closes with Esc, with the close button and with a click outside, but not with a click inside", () => {
    render(<Shell state={stateOf("main")} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(within(flyout()).getByTestId("hud-tab-history"));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.click(screen.getByTestId("hud-close"));
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it("keeps the chain tower in view during a chain, with the flyout open or closed", () => {
    render(<Shell state={stateOf("chain-2")} />);
    const tower = screen.getByTestId("chain-tower");
    expect(tower.getAttribute("data-links")).toBe("2");
    // Newest link on top: link 2 is the card that resolves first.
    expect(within(tower).getAllByTestId("chain-row").map((row) => row.getAttribute("data-link"))).toEqual(["2", "1"]);
    expect(within(tower).getByText("Mystical Space Typhoon")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-chain")).toBe("true");
    expect(screen.getByTestId("chain-tower")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-dock-chain"));
    expect(within(flyout()).getAllByTestId("chain-row")).toHaveLength(2);
    expect(screen.getByTestId("chain-tower")).toBeTruthy();
  });

  it("has no chain tower when no chain is open", () => {
    render(<Shell state={stateOf("main")} />);
    expect(screen.queryByTestId("chain-tower")).toBeNull();
  });
});

describe("the Deck Master token", () => {
  it("shows the real card and offers Inspect, but no summon that is not legal", () => {
    render(<Shell state={stateOf("main")} />);
    const token = screen.getByTestId("hud-master-token");
    expect(token.getAttribute("aria-label")).toContain("Black Luster Soldier");
    expect(screen.queryAllByTestId("hud-master-action")).toHaveLength(0);
    expect(screen.getByTestId("hud-master-inspect")).toBeTruthy();
  });

  it("lists Summon and Set when they are legal, and sends the chosen one", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<Shell state={masterState()} />);
    const actions = screen.getAllByTestId("hud-master-action");
    expect(actions.map((button) => button.textContent)).toEqual(["Summon", "Set"]);
    fireEvent.click(actions[1]);
    expect(info).toHaveBeenCalledWith("[table-preview] answer", expect.objectContaining({ answer: { choice: "dm-set" } }));
  });

  it("shows short labels on the buttons and keeps the full option text as the accessible name", () => {
    render(<Shell state={masterState()} />);
    const [summon, set] = screen.getAllByTestId("hud-master-action");
    expect(summon.textContent).toBe("Summon");
    expect(summon.getAttribute("aria-label")).toBe("Normal Summon Sage with Eyes of Blue");
    expect(summon.getAttribute("title")).toBe("Normal Summon Sage with Eyes of Blue");
    expect(set.textContent).toBe("Set");
    expect(set.getAttribute("aria-label")).toBe("Set monster Sage with Eyes of Blue");
    expect(screen.getByRole("button", { name: "Normal Summon Sage with Eyes of Blue" })).toBe(summon);
    expect(screen.getByRole("button", { name: "Set monster Sage with Eyes of Blue" })).toBe(set);
    expect(screen.getByTestId("hud-master-inspect").getAttribute("aria-label")).toBe("Inspect");
  });

  it("opens the details flyout from the token or from Inspect, and closes it", () => {
    render(<Shell state={stateOf("main")} />);
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();
    fireEvent.click(screen.getByTestId("hud-master-token"));
    const details = screen.getByTestId("hud-master-flyout");
    expect(within(details).getByTestId("hud-master-returns").textContent).toBe("1");
    expect(within(details).getByTestId("hud-master-cost").textContent).toBe("1000 LP");
    expect(within(details).getByTestId("hud-master-status").textContent).toBe("Elsewhere");
    // The dock flyout stays closed: the details open beside the token, in the free margin.
    expect(isOpen()).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();

    fireEvent.click(screen.getByTestId("hud-master-inspect"));
    expect(screen.getByTestId("hud-master-flyout")).toBeTruthy();
    // Card view opens the full card in the dock flyout.
    fireEvent.click(screen.getByTestId("hud-master-card"));
    expect(flyout().getAttribute("data-pane")).toBe("card");
    expect(within(flyout()).getAllByText(/Black Luster Soldier/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("hud-master-token"));
    fireEvent.click(screen.getByTestId("hud-master-close"));
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();
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
    expect(within(preview()).getByText("1400 / 1200")).toBeTruthy();
    expect(within(preview()).getByText("Aster")).toBeTruthy();
    // No Card flyout opens on a hover.
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
