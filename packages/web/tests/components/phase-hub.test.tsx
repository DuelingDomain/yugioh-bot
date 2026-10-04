// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PhaseHub, type PhaseHubProps } from "@/components/duel/phase-hub";
import { phaseStations, STATIONS } from "@/components/duel/phase-hub-model";
import { StationTrack } from "@/components/duel/station-track";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const OPTIONS = [
  { id: "to_bp", label: "Go to Battle Phase" },
  { id: "to_ep", label: "End turn" },
];
const ALL_MOVES = [
  { id: "to_bp", label: "Go to Battle Phase" },
  { id: "to_m2", label: "Go to Main Phase 2" },
  { id: "to_ep", label: "End turn" },
];

function hubProps(over: Partial<PhaseHubProps> = {}): PhaseHubProps {
  return {
    variant: "band",
    phase: "main1",
    turn: 4,
    turnSeat: 0,
    mySeat: 0,
    playerName: (seat) => (seat === 0 ? "Ren Arata" : "Ryo Sato"),
    actionOptions: OPTIONS,
    canAct: true,
    onChoose: vi.fn(),
    reducedMotion: true,
    ...over,
  };
}

const trackProps = {
  phase: "main1",
  turn: 4,
  turnSeat: 0,
  mySeat: 0,
  playerName: (seat: number) => (seat === 0 ? "Ren Arata" : "Ryo Sato"),
  actionOptions: OPTIONS,
  canAct: true,
  noLegalMoves: false,
  onChoose: vi.fn(),
  reducedMotion: true,
};

describe("phaseStations", () => {
  it("lists the six stations in order with done, current and ahead", () => {
    const view = phaseStations({ phase: "main2", actionOptions: [], canAct: false });
    expect(view.stations.map((entry) => entry.station.code)).toEqual(["DP", "SP", "M1", "BP", "M2", "EP"]);
    expect(view.stations.map((entry) => entry.state)).toEqual(["done", "done", "done", "done", "current", "ahead"]);
    expect(view.current).toBe(4);
  });

  it("puts Damage and Damage calculation on the Battle station", () => {
    expect(phaseStations({ phase: "damage", actionOptions: [], canAct: false }).current).toBe(3);
    expect(phaseStations({ phase: "damage_cal", actionOptions: [], canAct: false }).current).toBe(3);
  });

  it("offers a phase move only to a seat that may answer, and only the ones the prompt lists", () => {
    const live = phaseStations({ phase: "main1", actionOptions: OPTIONS, canAct: true });
    expect(live.stations.map((entry) => entry.option?.id)).toEqual([undefined, undefined, undefined, "to_bp", undefined, "to_ep"]);
    const idle = phaseStations({ phase: "main1", actionOptions: OPTIONS, canAct: false });
    expect(idle.stations.every((entry) => entry.option === undefined)).toBe(true);
    expect(idle.offered.size).toBe(0);
  });

  it("only Battle, Main 2 and End carry a move", () => {
    expect(STATIONS.filter((station) => station.action).map((station) => [station.code, station.action])).toEqual([
      ["BP", "to_bp"], ["M2", "to_m2"], ["EP", "to_ep"],
    ]);
  });
});

describe("PhaseHub on your turn", () => {
  it("makes exactly the offered phases buttons, labelled with the engine's own option text", () => {
    render(<PhaseHub {...hubProps({ actionOptions: ALL_MOVES })} />);
    const nav = screen.getByRole("navigation", { name: "Duel phases" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Go to Battle Phase", "Go to Main Phase 2", "End turn",
    ]);
    expect(buttons.map((button) => button.textContent)).toEqual(["BP", "M2", "EP"]);
  });

  it("sends the same option id the bar's plate sends, through the same handler", () => {
    for (const option of ALL_MOVES) {
      const hubChoose = vi.fn();
      const { unmount } = render(<PhaseHub {...hubProps({ actionOptions: ALL_MOVES, onChoose: hubChoose })} />);
      fireEvent.click(screen.getByRole("button", { name: option.label }));
      expect(hubChoose).toHaveBeenCalledExactlyOnceWith(option.id);
      unmount();

      const barChoose = vi.fn();
      render(<StationTrack {...trackProps} actionOptions={ALL_MOVES} onChoose={barChoose} />);
      const plate = screen.getAllByRole("button", { name: option.label })[0];
      fireEvent.click(plate);
      expect(barChoose).toHaveBeenCalledExactlyOnceWith(option.id);
      cleanup();
    }
  });

  it("gives every chip a two-letter code and a full-name tooltip", () => {
    const { container } = render(<PhaseHub {...hubProps()} />);
    const chips = [...container.querySelectorAll<HTMLElement>("[data-phase]")].filter((node) => node.tagName !== "NAV");
    expect(chips.map((chip) => chip.textContent?.replace(/\s+/g, "").slice(0, 2))).toEqual(["DP", "SP", "M1", "BP", "M2", "EP"]);
    expect(chips[2].getAttribute("title")).toMatch(/^Main 1\./);
    expect(chips[3].getAttribute("title")).toMatch(/^Battle\./);
  });

  it("lights the current phase, marks the done ones and spells the lit phase out", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "main2" })} />);
    const states = [...container.querySelectorAll<HTMLElement>("[data-state]")].map((node) => node.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "done", "done", "current", "ahead"]);
    expect(container.querySelectorAll("[aria-current='step']")).toHaveLength(1);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
    expect(container.textContent).toContain("Main 2");
  });

  it("names the Battle Phase step on the lit phase", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "battle", battleStep: "damage" })} />);
    expect(container.textContent).toContain("Battle · Damage");
  });

  it("does not repeat the name when the battle step is called Battle", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "battle", battleStep: "battle" })} />);
    expect(container.textContent).not.toContain("Battle · Battle");
    expect(container.textContent).toContain("Battle step");
  });
});

describe("PhaseHub on another turn", () => {
  it("is read-only even when options are passed in", () => {
    render(<PhaseHub {...hubProps({ turnSeat: 1, canAct: false, actionOptions: ALL_MOVES })} />);
    const nav = screen.getByRole("navigation", { name: "Duel phases" });
    expect(within(nav).queryAllByRole("button")).toHaveLength(0);
  });

  it("is read-only when the local seat cannot answer (a chain, a trigger, a busy answer)", () => {
    render(<PhaseHub {...hubProps({ canAct: false })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("is read-only for a spectator", () => {
    render(<PhaseHub {...hubProps({ mySeat: null, canAct: false, actionOptions: [] })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("PhaseHub turn owner", () => {
  it("says You on your own turn and the duelist's name on theirs", () => {
    const mine = render(<PhaseHub {...hubProps()} />);
    expect(mine.container.textContent).toContain("You");
    expect(mine.container.textContent).toContain("Turn 4");
    expect(screen.getByRole("status").textContent).toBe("Turn 4, your turn, Main 1");
    cleanup();

    const theirs = render(<PhaseHub {...hubProps({ turnSeat: 1, canAct: false })} />);
    expect(theirs.container.textContent).toContain("Ryo Sato");
    expect(theirs.container.textContent).not.toContain("You");
    expect(screen.getByRole("status").textContent).toBe("Turn 4, Ryo Sato's turn, Main 1");
    expect(theirs.container.querySelector("nav")!.getAttribute("data-tone")).toBe("theirs");
  });

  it("carries the seat colour of the turn seat on a table", () => {
    const { container } = render(
      <PhaseHub {...hubProps({ variant: "table", turnSeat: 1, canAct: false, tone: { main: "#5cb8f5", ink: "#a9dcfb" } })} />,
    );
    expect(container.querySelector<HTMLElement>("nav")!.style.getPropertyValue("--seat")).toBe("#5cb8f5");
  });

  it("draws three pairs in the band's free cells on one hairline, with the owner above the left pair", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "main1" })} />);
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("data-variant")).toBe("band");
    const cells = [...nav.querySelectorAll<HTMLElement>("[data-cell]")];
    expect(cells.map((cell) => cell.getAttribute("data-cell"))).toEqual(["0", "1", "2"]);
    // Draw and Standby left, Main 1 and Battle in the centre, Main 2 and End right; the document order stays DP to EP.
    expect(cells.map((cell) => [...cell.querySelectorAll("[data-phase]")].map((chip) => chip.getAttribute("data-phase")))).toEqual([
      ["DP", "SP"], ["M1", "BP"], ["M2", "EP"],
    ]);
    // One hairline for the whole strip, decoration only; no pill, no track and no caption line.
    const lines = nav.querySelectorAll("[class*='line']");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("aria-hidden")).toBe("true");
    expect(nav.querySelector("[class*='plate']")).toBeNull();
    expect(nav.querySelector("[class*='track']")).toBeNull();
    expect(nav.querySelector("[class*='caption']")).toBeNull();
    // The owner and the turn sit in the left pair, before its chips, and nowhere else.
    const owner = nav.querySelector<HTMLElement>("[data-part='owner']")!;
    expect(cells[0].contains(owner)).toBe(true);
    expect(owner.compareDocumentPosition(cells[0].querySelector("[data-phase]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.querySelectorAll("[data-part='owner']")).toHaveLength(1);
    expect(owner.textContent).toBe("YouTurn 4");
    expect(owner.querySelector("[class*='turn']")!.textContent).toBe("Turn 4");
    expect(owner.querySelectorAll("[data-phase]")).toHaveLength(0);
  });

  it("keeps the click path and the aria of the pairs exactly as the strip had them", () => {
    const onChoose = vi.fn();
    const { container } = render(<PhaseHub {...hubProps({ actionOptions: ALL_MOVES, onChoose })} />);
    const live = [...container.querySelectorAll<HTMLElement>("button[data-phase]")];
    expect(live.map((chip) => chip.getAttribute("data-phase"))).toEqual(["BP", "M2", "EP"]);
    expect(live.map((chip) => chip.getAttribute("aria-label"))).toEqual(["Go to Battle Phase", "Go to Main Phase 2", "End turn"]);
    fireEvent.click(live[2]);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("to_ep");
    expect(container.querySelectorAll("[aria-current='step']")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Turn 4, your turn, Main 1");
  });

  it("expands the lit chip to the phase's full name and leaves the others as codes", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "battle", battleStep: "damage" })} />);
    const lit = container.querySelector<HTMLElement>("[aria-current='step']")!;
    expect(lit.getAttribute("data-phase")).toBe("BP");
    expect(lit.querySelector("[class*='name']")!.textContent).toBe("Battle · Damage");
    expect(container.querySelectorAll("[class*='name']")).toHaveLength(1);
    expect([...container.querySelectorAll("[data-state='done']")].map((chip) => chip.getAttribute("data-phase"))).toEqual(["DP", "SP", "M1"]);
  });

  it("puts the lit name under its pair too, for a cell too narrow to hold it in the chip", () => {
    const { container } = render(<PhaseHub {...hubProps({ phase: "battle", battleStep: "damage" })} />);
    const under = container.querySelectorAll<HTMLElement>("[class*='under']");
    // One label, in the pair of the lit chip (the centre one), decoration only.
    expect(under).toHaveLength(1);
    expect(under[0].textContent).toBe("Battle · Damage");
    expect(under[0].getAttribute("aria-hidden")).toBe("true");
    const lit = container.querySelector("[aria-current='step']")!;
    expect(under[0].parentElement).toBe(lit.parentElement);
    expect(under[0].closest("[data-cell]")!.getAttribute("data-cell")).toBe("1");
    // It is the last child of its pair, so it can sit under the chips; no label without a lit phase.
    expect(under[0].parentElement!.lastElementChild).toBe(under[0]);
    cleanup();
    const idle = render(<PhaseHub {...hubProps({ phase: null, turnSeat: null })} />);
    expect(idle.container.querySelector("[class*='under']")).toBeNull();
  });

  it("marks the other seat's turn so the lit chip fills ember, and your own so it fills violet", () => {
    const mine = render(<PhaseHub {...hubProps()} />);
    expect(mine.container.querySelector("nav")!.getAttribute("data-tone")).toBe("mine");
    cleanup();
    const theirs = render(<PhaseHub {...hubProps({ turnSeat: 1, canAct: false })} />);
    expect(theirs.container.querySelector("nav")!.getAttribute("data-tone")).toBe("theirs");
    // Their turn: the ember fill is a band rule, quieter than the violet one, and it never reaches the table variant.
    const css = readFileSync(join(__dirname, "../../src/components/duel/phase-hub.module.css"), "utf8");
    const theirsRule = css.match(/\.root\[data-variant="band"\]\[data-tone="theirs"\]\s*\{([^}]*)\}/)![1];
    expect(theirsRule).toMatch(/--lit-bg:[^;]*var\(--ember-rgb\) \/ 0\.34[^;]*var\(--ember-rgb\) \/ 0\.18/);
    expect(theirsRule).toMatch(/--lit-edge:\s*rgb\(var\(--ember-rgb\)/);
    expect(css).toMatch(/\.root\[data-tone="mine"\]\s*\{[^}]*--lit-bg:\s*linear-gradient\(#33268a/);
  });
});

describe("PhaseHub band styles", () => {
  const css = readFileSync(join(__dirname, "../../src/components/duel/phase-hub.module.css"), "utf8");
  const block = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("sizes the chips with the zone, 26px at the least and 38px at the most", () => {
    expect(block('.root[data-variant="band"]')).toMatch(/--hc:\s*clamp\(26px, calc\(var\(--hub-z\) \* 0\.28\), 38px\)/);
  });

  it("keeps the owner label to the cell, truncating the name, with 6px of air before the next zone", () => {
    expect(block(".owner")).toMatch(/max-width:\s*calc\(50cqw \+ 50% - 6px\)/);
    expect(block(".whoName")).toMatch(/text-overflow:\s*ellipsis/);
    expect(block(".whoName")).toMatch(/overflow:\s*hidden/);
    expect(block(".who")).toMatch(/min-width:\s*0/);
  });

  it("writes Turn in sentence case: no capitals, no tracking", () => {
    const turn = block(".turn");
    expect(turn).not.toMatch(/font-variant-caps|text-transform|letter-spacing/);
    expect(css).not.toMatch(/all-small-caps|text-transform:\s*uppercase/);
  });

  it("falls back to the code and the label under the pair below 168px of cell", () => {
    expect(css).toMatch(/@container \(max-width: 167px\)/);
    expect(block(".under")).toMatch(/display:\s*none/);
  });
});

describe("PhaseHub table", () => {
  it("puts the owner and turn in a caption line above the strip at a table", () => {
    const { container } = render(<PhaseHub {...hubProps({ variant: "table", turnSeat: 1, canAct: false })} />);
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("data-variant")).toBe("table");
    const caption = nav.querySelector<HTMLElement>("[class*='caption']")!;
    const plate = nav.querySelector<HTMLElement>("[class*='plate']")!;
    expect(caption.textContent).toContain("Ryo Sato");
    expect(caption.textContent).toContain("Turn 4");
    expect(caption.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plate.querySelectorAll("[data-phase]")).toHaveLength(6);
    // The caption is decoration: the status line says it aloud.
    expect(caption.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws nothing on a phone, where the bar keeps the phases", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<PhaseHub {...hubProps()} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("StationTrack when the phases move to the board", () => {
  it("drops the phase plates and the turn owner label from the bar", () => {
    const { container } = render(<StationTrack {...trackProps} phases="hub" actionOptions={[]} canAct={false} />);
    const nav = screen.getByRole("navigation", { name: "Turn actions" });
    expect(nav.getAttribute("data-phases")).toBe("hub");
    expect(container.querySelectorAll("ol")).toHaveLength(0);
    expect(container.textContent).not.toContain("Ren Arata");
    expect(container.textContent).not.toContain("Turn 4");
  });

  it("keeps the clock, the caption and the End Turn button in the bar", () => {
    const onChoose = vi.fn();
    render(
      <StationTrack {...trackProps} phases="hub" onChoose={onChoose}
        clock={<div role="timer">3:12</div>} actionOptions={ALL_MOVES} />,
    );
    const nav = screen.getByRole("navigation", { name: "Turn actions" });
    expect(within(nav).getByRole("timer").textContent).toBe("3:12");
    fireEvent.click(within(nav).getByRole("button", { name: "End Turn" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("to_ep");
  });

  it("keeps the Responses switch, its label and its R shortcut next to the turn button", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StationTrack {...trackProps} phases="hub" chainMode={{ mode: "auto", onChange }} actionOptions={ALL_MOVES} />,
    );
    const group = screen.getByRole("radiogroup", { name: "Chain responses" });
    expect(group.getAttribute("aria-keyshortcuts")).toBe("R");
    expect(group.textContent).toContain("Responses");
    fireEvent.click(screen.getByRole("radio", { name: "Always" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("always");
    // One group: the switch and the turn button share the actions container.
    const actions = group.closest("[class*='actions']")!;
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getByRole("button", { name: "End Turn" })).toBeTruthy();
    expect(container.querySelector("nav")!.getAttribute("data-chain")).toBe("true");
  });

  it("brings the plates back on a phone, because the hub is not drawn there", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<StationTrack {...trackProps} phases="hub" />);
    const nav = screen.getByRole("navigation", { name: "Duel phases" });
    expect(nav.getAttribute("data-phases")).toBe("bar");
    expect(container.querySelectorAll("ol li")).toHaveLength(6);
    expect(container.textContent).toContain("Ren Arata");
  });

  it("is unchanged by default", () => {
    const { container } = render(<StationTrack {...trackProps} />);
    expect(screen.getByRole("navigation", { name: "Duel phases" }).getAttribute("data-phases")).toBe("bar");
    expect(container.querySelectorAll("ol li")).toHaveLength(6);
  });
});
