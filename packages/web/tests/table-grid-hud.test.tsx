// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import type { DuelAnswer } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE } from "@/components/duel/constants";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { masterForm } from "@/components/duel/table/grid-master";
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

function Shell({ state, onAnswer }: { state: TableFixtureState; onAnswer?: (answer: DuelAnswer) => void }) {
  const base = useFixtureController(state, { reducedMotion: true });
  const controller = onAnswer ? { ...base, onAnswer } : base;
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
    // No full-width bottom bar: the turn controls sit in the corner cluster.
    expect(screen.queryByTestId("hud-bottom")).toBeNull();
    expect(screen.getByTestId("hud-corner")).toBeTruthy();
    for (const id of ["log", "settings"]) expect(screen.getByTestId(`hud-dock-${id}`)).toBeTruthy();
    // The chain shows by itself (tower, strip and its sheet), so the dock has no Chain icon and the flyout no Chain tab.
    expect(screen.queryByTestId("hud-dock-chain")).toBeNull();
    // The old History pane only repeated the Log pane, so the dock has no History icon.
    expect(screen.queryByTestId("hud-dock-history")).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("opens a pane from its dock icon and closes it with the same icon", () => {
    render(<Shell state={stateOf("main")} />);
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-pane")).toBe("settings");
    expect(screen.getByTestId("hud-dock-settings").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(flyout().getAttribute("data-pane")).toBe("log");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(false);
  });

  it("closes with Esc, with the close button and with a click outside, but not with a click inside", () => {
    render(<Shell state={stateOf("main")} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(within(flyout()).getByTestId("hud-tab-settings"));
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
    expect(within(flyout()).queryByTestId("hud-tab-chain")).toBeNull();
    expect(within(flyout()).queryByTestId("chain-row")).toBeNull();
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

  it("shows a short word for an attack and keeps the full text as the name", () => {
    const state = masterState();
    const prompt = state.room.engine!.prompt!;
    prompt.options = [
      ...prompt.options.filter((option) => !option.id.startsWith("dm-")),
      { id: "dm-attack", label: "Attack with Sage with Eyes of Blue", controller: 0, location: LOCATION_DMZONE, sequence: 0 },
      { id: "dm-direct", label: "Attack directly with Sage with Eyes of Blue", controller: 0, location: LOCATION_DMZONE, sequence: 0 },
    ];
    render(<Shell state={state} />);
    const [attack, direct] = screen.getAllByTestId("hud-master-action");
    expect(attack.textContent).toBe("Attack");
    expect(attack.getAttribute("aria-label")).toBe("Attack with Sage with Eyes of Blue");
    expect(direct.textContent).toBe("Direct attack");
    expect(direct.getAttribute("title")).toBe("Attack directly with Sage with Eyes of Blue");
  });

  it("starts as the compact plate with the small card", () => {
    render(<Shell state={stateOf("main")} />);
    expect(screen.getByTestId("hud-master").dataset.form).toBe("compact");
    const art = screen.getByTestId("hud-master-token").querySelector("span[aria-hidden]") as HTMLElement;
    expect(art.style.backgroundImage).toMatch(/size=small/);
  });

  it("is tall only on a large screen with room for a card of 195px or more, never between the two forms", () => {
    expect(masterForm(800, 400)).toEqual({ tall: false });
    expect(masterForm(768, 400)).toEqual({ tall: false });
    expect(masterForm(900, 194)).toEqual({ tall: false });
    expect(masterForm(900, 195)).toEqual({ tall: true, art: 195 });
    expect(masterForm(900, 530)).toEqual({ tall: true, art: 222 });
    expect(masterForm(1080, 97)).toEqual({ tall: false });
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
    expect(isOpen()).toBe(true);
    expect(container.querySelectorAll("[data-testid='hover-preview'][data-pinned='true']")).toHaveLength(0);
  });

  it("takes the fresh copy of the pinned card at a new revision, and lets the pin go when the card is gone", () => {
    vi.useFakeTimers();
    const first = stateOf("main");
    const view = render(<Shell state={first} />);
    fireEvent.click(myCard(view.container));
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("1400 / 1200");
    const changed = structuredClone(first);
    const seat = changed.room.engine!.seats.find((entry) => entry.seat === 0)!;
    seat.hand.find((card) => card?.name === "Celtic Guardian")!.attack = 2400;
    view.rerender(<Shell state={changed} />);
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("2400 / 1200");
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
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("an open flyout does not hold the other prompt keys: N still says no", () => {
    const onAnswer = vi.fn();
    render(<Shell state={stateOf("chain-2")} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.keyDown(window, { key: "n" });
    expect(isOpen()).toBe(true);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("leaves Esc to a modal dialog, and the flyout stays", () => {
    render(<Shell state={stateOf("main")} />);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
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
