// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import type { TableController } from "@/components/duel/table/types";
import { TagShell, type TagShellProps } from "@/components/duel/tag/tag-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", mediaStub(false));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.stubGlobal("matchMedia", mediaStub(false));
});

function mediaStub(narrow: boolean) {
  return (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener: () => {}, removeEventListener: () => {} });
}

type StateId = keyof typeof TAG_FIXTURES.states;
type ShellProps = Partial<TagShellProps> & {
  id?: StateId;
  reducedMotion?: boolean;
  /** Events appended to the engine view after the first render. */
  more?: DuelEvent[];
  tweak?: (controller: TableController) => TableController;
  state?: TableFixtureState;
};

function Shell({ id = "main", reducedMotion = true, more, tweak, state, ...props }: ShellProps) {
  const base = useFixtureController(state ?? TAG_FIXTURES.states[id], { reducedMotion });
  let controller = base;
  if (more) controller = { ...controller, engine: { ...controller.engine, events: [...controller.engine.events, ...more] } };
  if (tweak) controller = tweak(controller);
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} {...props} />;
}

const stagePress = (container: HTMLElement, seat: number) => container.querySelector(`[data-seat-btn='${seat}']`)?.getAttribute("aria-pressed");
const press = (key: string, init: KeyboardEventInit = {}) => act(() => void fireEvent.keyDown(window, { key, ...init }));
const answers = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => call[0] === "[table-preview] answer").map((call) => (call[1] as { answer: unknown }).answer);

describe("TagShell DOM hooks for the room and e2e", () => {
  it("marks the root as the tag table and says if the player may act", () => {
    const mine = render(<Shell />);
    const root = mine.container.querySelector("[data-table-shell]") as HTMLElement;
    expect(root.getAttribute("data-table-shell")).toBe("tag");
    expect(root.getAttribute("data-can-act")).toBe("true");
    expect(mine.container.querySelector("[data-tag-shell]")).toBeNull();
    mine.unmount();
    const watching = render(<Shell id="spectator" />);
    expect(watching.container.querySelector("[data-table-shell]")?.getAttribute("data-can-act")).toBe("false");
  });

  it("puts the stage in the Duel field region with both stage hooks", () => {
    const { container, getByRole } = render(<Shell />);
    const region = getByRole("region", { name: "Duel field" });
    expect(region.querySelector("[data-table-stage='tag'][data-tag-stage]")).not.toBeNull();
    expect(container.querySelectorAll("[aria-label='Duel field']")).toHaveLength(1);
  });

  it("gives each field its seat, side and relation (only the own field reads you)", () => {
    const { container } = render(<Shell />);
    const field = (seat: number) => container.querySelector(`[data-field-hold='${seat}']`) as HTMLElement;
    expect([0, 1, 2, 3].map((seat) => field(seat).querySelector("[data-seat-field]")?.getAttribute("data-seat-field"))).toEqual(["0", "1", "2", "3"]);
    expect([0, 1, 2, 3].map((seat) => field(seat).querySelector("[data-seat-field]")?.getAttribute("data-side"))).toEqual(["you", "opp", "partner", "opp"]);
    expect([0, 1, 2, 3].map((seat) => field(seat).getAttribute("data-relation"))).toEqual(["self", "opponent", "partner", "opponent"]);
  });

  it("gives a spectator no own field", () => {
    const { container } = render(<Shell id="spectator" />);
    expect(container.querySelector("[data-seat-field][data-side='you']")).toBeNull();
    expect([...container.querySelectorAll("[data-field-hold]")].every((node) => node.getAttribute("data-relation") === "other")).toBe(true);
  });

  it("fills the viewport only when the room asks", () => {
    const off = render(<Shell />);
    expect(off.container.querySelector("[data-table-shell]")?.getAttribute("data-viewport")).toBeNull();
    off.unmount();
    const on = render(<Shell fillViewport />);
    expect(on.container.querySelector("[data-table-shell]")?.getAttribute("data-viewport")).toBe("true");
  });
});

describe("TagShell seams for the room", () => {
  it("shows the header tools, the notices and the modals the room passes", () => {
    const { container } = render(
      <Shell headerTools={<button type="button">Surrender</button>} notices={<p data-testid="room-notice">Connection lost</p>} modals={<div data-testid="room-modal" />} />,
    );
    expect(container.querySelector("[data-tag-header]")?.textContent).toContain("Surrender");
    expect(container.querySelector("[data-testid='room-notice']")).not.toBeNull();
    expect(container.querySelector("[data-testid='room-modal']")).not.toBeNull();
  });

  it("shows the settings tools in the Settings tab", () => {
    const { container, getByTestId } = render(<Shell settingsTools={<button type="button">Archive table</button>} />);
    act(() => void fireEvent.click(getByTestId("hud-dock-settings")));
    expect(container.textContent).toContain("Archive table");
  });

  it("offers the phase moves until the room says it is busy", () => {
    const open = render(<Shell />);
    expect(open.container.querySelector("button[aria-label='Go to the Battle Phase']")).not.toBeNull();
    open.unmount();
    const busy = render(<Shell busy />);
    expect(busy.container.querySelector("button[aria-label='Go to the Battle Phase']")).toBeNull();
    expect(busy.container.querySelector("[data-table-shell]")?.getAttribute("data-can-act")).toBe("false");
  });

  it("blocks the field while a centered panel prompt is not revealed yet", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell id="chain-2" tweak={(controller) => ({ ...controller, revealed: false })} />);
    expect(container.querySelector("[data-table-shell]")?.getAttribute("data-can-act")).toBe("false");
    expect(container.querySelector("[data-zones][data-legal='true']")).toBeNull();
    expect(answers(info)).toHaveLength(0);
  });

  it("lets a board pick take the first click before its bar is revealed", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell id="target-pick" tweak={(controller) => ({ ...controller, revealed: false })} />);
    const zone = container.querySelector("[data-zones][data-legal='true']") as HTMLElement;
    act(() => void fireEvent.click(zone.querySelector("button") ?? zone));
    expect(answers(info)).toHaveLength(1);
  });

  it("lets the field answer once the centered prompt is revealed", () => {
    const { container } = render(<Shell id="target-pick" tweak={(controller) => ({ ...controller, revealed: true })} />);
    expect(container.querySelector("[data-table-shell]")?.getAttribute("data-can-act")).toBe("true");
  });

  it("leaves pick timing to the room's continuation when it passes one", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const noteAnswer = vi.fn();
    const { container } = render(<Shell pickContinuation={{ continuing: false, waiting: null, noteAnswer, clearAnswer: vi.fn() }} />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-usable='true']") as HTMLElement;
    act(() => void fireEvent.click(card.querySelector("button") ?? card));
    act(() => void fireEvent.click(document.body.querySelector("[role='menu'] [role='menuitem']") as HTMLElement));
    expect(noteAnswer).not.toHaveBeenCalled();
  });

  it("mounts one header with the turn order in its pill, and one station track in the bottom pill, with no second clock", () => {
    const { container } = render(<Shell />);
    expect(container.querySelectorAll("[data-tag-header]")).toHaveLength(1);
    expect(container.textContent).toContain("Turn 5");
    expect(container.querySelector("[data-tag-header] [data-baton-strip]")).not.toBeNull();
    const track = container.querySelector("[data-tag-track]") as HTMLElement;
    // The phases live on the helipad; the bottom pill keeps the track bar (hint, responses, turn button).
    expect(track.querySelector("nav[data-phases='hub']")).not.toBeNull();
    expect(container.querySelector("[data-phase-hub-slot]")).not.toBeNull();
    expect(container.querySelectorAll("[data-baton-strip]")).toHaveLength(1);
  });

  it("keeps the baton strip in the turn track on a narrow screen", () => {
    vi.stubGlobal("matchMedia", mediaStub(true));
    const { container } = render(<Shell />);
    const track = container.querySelector("[data-tag-track]") as HTMLElement;
    expect(track.querySelector("[data-baton-strip]")).not.toBeNull();
    expect(container.querySelectorAll("[data-baton-strip]")).toHaveLength(1);
  });

  it("uses one preferences object for the header toggle and the Settings tab", () => {
    const { container, getByTestId } = render(<Shell />);
    act(() => void fireEvent.click(getByTestId("hud-dock-settings")));
    const toggle = container.querySelector("[data-sound-toggle]") as HTMLElement;
    const sw = () => container.querySelector("input[role='switch']") as HTMLInputElement;
    const before = sw().checked;
    expect(toggle.getAttribute("aria-pressed")).toBe(String(before));
    act(() => void fireEvent.click(toggle));
    expect(sw().checked).toBe(!before);
    expect(toggle.getAttribute("aria-pressed")).toBe(String(!before));
    act(() => void fireEvent.click(sw()));
    expect(sw().checked).toBe(before);
    expect(toggle.getAttribute("aria-pressed")).toBe(String(before));
  });
});

describe("TagShell camera keys", () => {
  it("sends a digit to the camera when nothing is open", () => {
    const { container } = render(<Shell />);
    expect(stagePress(container, 2)).toBe("false");
    press("3");
    expect(stagePress(container, 2)).toBe("true");
  });

  it("leaves the camera alone while the room owns the keys (inputSuspended)", () => {
    const { container } = render(<Shell inputSuspended />);
    press("3");
    expect(stagePress(container, 2)).toBe("false");
  });

  it("leaves the camera alone while a centered prompt is not revealed", () => {
    const { container } = render(<Shell id="target-pick" tweak={(controller) => ({ ...controller, revealed: false })} />);
    press("3");
    expect(stagePress(container, 2)).toBe("false");
  });

  it("leaves the camera alone while the card menu is open", () => {
    const { container } = render(<Shell />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-usable='true']") as HTMLElement;
    expect(card).not.toBeNull();
    act(() => void fireEvent.click(card.querySelector("button") ?? card));
    expect(document.body.querySelector("[role='menu']")).not.toBeNull();
    press("3");
    expect(stagePress(container, 2)).toBe("false");
  });

  it("takes a key that nobody else took, and ignores one a prompt already took", () => {
    const { container } = render(<Shell />);
    const early = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", early, true);
    try {
      press("4");
    } finally {
      window.removeEventListener("keydown", early, true);
    }
    expect(stagePress(container, 3)).toBe("false");
    press("4");
    expect(stagePress(container, 3)).toBe("true");
  });

  it("leaves the camera alone while the phone sheet is open", () => {
    vi.stubGlobal("matchMedia", mediaStub(true));
    const { container, getByRole } = render(<Shell />);
    act(() => void fireEvent.click(getByRole("button", { name: /^Log/ })));
    press("3");
    expect(stagePress(container, 2)).not.toBe("true");
  });
});

describe("TagShell camera lock", () => {
  const attack = (id: number): DuelEvent => ({ id, kind: "attack", seat: 0, text: "attack", target: { seat: 1 } } as unknown as DuelEvent);

  it("locks the camera for a new attack event and not for the events it opened with", () => {
    const first = render(<Shell reducedMotion={false} />);
    expect(first.container.querySelector("[data-camera-dock]")?.getAttribute("data-locked")).toBe("false");
    first.rerender(<Shell reducedMotion={false} more={[attack(900)]} />);
    expect(first.container.querySelector("[data-camera-dock]")?.getAttribute("data-locked")).toBe("true");
  });

  it("never locks under reduced motion", () => {
    const view = render(<Shell reducedMotion />);
    view.rerender(<Shell reducedMotion more={[attack(900)]} />);
    expect(view.container.querySelector("[data-camera-dock]")?.getAttribute("data-locked")).toBe("false");
  });

  it("does not lock while the room says the connection is down", () => {
    const view = render(<Shell reducedMotion={false} fxActive={false} />);
    view.rerender(<Shell reducedMotion={false} fxActive={false} more={[attack(900)]} />);
    expect(view.container.querySelector("[data-camera-dock]")?.getAttribute("data-locked")).toBe("false");
  });

  it("starts locked when the preview asks for it, without a render loop", () => {
    const { container } = render(<Shell reducedMotion={false} initialLock="battle" />);
    expect(container.querySelector("[data-camera-dock]")?.getAttribute("data-locked")).toBe("true");
  });
});

describe("TagShell clicks", () => {
  it("main: a usable hand card opens its menu, and choosing an action answers {choice}", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-usable='true']") as HTMLElement;
    expect(card).not.toBeNull();
    act(() => void fireEvent.click(card.querySelector("button") ?? card));
    const items = document.body.querySelectorAll("[role='menu'] [role='menuitem']");
    expect(items.length).toBeGreaterThan(0);
    act(() => void fireEvent.click(items[0]));
    const sent = answers(info);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ choice: expect.any(String) });
  });

  it("attack-target: the aimed target shows the confirm, and Attack answers with the selected target", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell id="battle-aim" />);
    const target = container.querySelector("[data-zones][data-legal='true']") as HTMLElement;
    expect(target).not.toBeNull();
    act(() => void fireEvent.click(target.querySelector("button") ?? target));
    const go = document.body.querySelector("[data-attack-confirm] button[data-go]") as HTMLElement;
    expect(go).not.toBeNull();
    act(() => void fireEvent.click(go));
    const sent = answers(info) as Array<{ selected?: unknown }>;
    expect(sent).toHaveLength(1);
    expect(sent[0].selected).toBeDefined();
  });

  it("opening a pile mounts the pile viewer", () => {
    const { container } = render(<Shell />);
    const pile = container.querySelector("button[aria-label*='Graveyard' i], button[aria-label*='pile' i]") as HTMLElement | null;
    expect(pile).not.toBeNull();
    act(() => void fireEvent.click(pile as HTMLElement));
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
  });
});

describe("TagShell phone width", () => {
  it("swaps the side column for the Card / Log bar", () => {
    vi.stubGlobal("matchMedia", mediaStub(true));
    const { container } = render(<Shell />);
    expect(container.querySelector("[data-tag-side='left']")).toBeNull();
    expect(container.querySelector("[aria-label='Mobile duel panels']")).not.toBeNull();
  });
});

describe("TagShell result", () => {
  it("shows the shared result screen with the exit the room passes, never the Rooftop banner", async () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { container } = render(<Shell id="result" actions={{ onExit }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    const screen = document.body.querySelector("[data-testid='duel-result']") as HTMLElement;
    expect(screen).not.toBeNull();
    expect(container.querySelector("[aria-label='Duel result']")).toBeNull();
    const exit = [...container.querySelectorAll("header button")].find((node) => node.textContent?.includes("Exit duel")) as HTMLElement;
    expect(exit).toBeDefined();
    act(() => void fireEvent.click(exit));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("leaves the camera keys alone while the result screen is shown, not only because it is modal", async () => {
    vi.useFakeTimers();
    const { container } = render(<Shell id="result" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    const screen = document.body.querySelector("[data-testid='duel-result']") as HTMLElement;
    expect(screen).not.toBeNull();
    // The key hook also stops on any aria-modal node; take that guard away to test the shell's own flag.
    for (const node of document.querySelectorAll("[aria-modal]")) node.removeAttribute("aria-modal");
    press("3");
    expect(stagePress(container, 2)).toBe("false");
  });

  it("keeps the Rooftop result banner for the preview only", () => {
    const { container } = render(<Shell id="result" preview />);
    expect(container.querySelector("[role='dialog'][aria-label='Duel result']")).not.toBeNull();
    expect(document.body.querySelector("[data-testid='duel-result']")).toBeNull();
  });
});

describe("TagShell preview", () => {
  it("works with no team names and no room seams", () => {
    function Bare() {
      const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: true });
      return <TagShell controller={controller} />;
    }
    const { container } = render(<Bare />);
    expect(container.querySelector("[data-table-shell='tag']")).not.toBeNull();
  });
});
