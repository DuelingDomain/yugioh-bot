// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { ChainModeSwitch } from "@/components/duel/chain-mode-switch";
import { StationTrack } from "@/components/duel/station-track";

afterEach(cleanup);

const track = {
  phase: "main1",
  turn: 2,
  turnSeat: 0,
  mySeat: 0,
  playerName: (seat: number) => `Duelist ${seat}`,
  actionOptions: [],
  canAct: false,
  noLegalMoves: false,
  onChoose: vi.fn(),
  reducedMotion: true,
};

describe("ChainModeSwitch", () => {
  it("is a radio group of Auto, Always and Off with exactly one checked", () => {
    render(<ChainModeSwitch mode="always" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Chain responses" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Auto", "Always", "Off"]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    // Roving tab stop: only the checked segment is in the tab order.
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    expect(group.getAttribute("aria-keyshortcuts")).toBe("R");
  });

  it("says plainly that Off also skips your own optional effects", () => {
    render(<ChainModeSwitch mode="auto" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("title"))
      .toBe("Off: pass every optional response, including your own 'you can' effects.");
    expect(screen.getByRole("radio", { name: "Auto" }).getAttribute("title")).toMatch(/only when a card can respond/);
    expect(screen.getByRole("radio", { name: "Always" }).getAttribute("title")).toMatch(/every window/);
  });

  it("sends the clicked mode, and nothing for the one already on", () => {
    const onChange = vi.fn();
    render(<ChainModeSwitch mode="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("off");
  });

  it("moves with the arrow keys and wraps", () => {
    const onChange = vi.fn();
    render(<ChainModeSwitch mode="off" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Off" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("auto");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Off" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("always");
  });

  it("announces the position politely", () => {
    const { rerender } = render(<ChainModeSwitch mode="auto" onChange={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Responses: Auto");
    rerender(<ChainModeSwitch mode="off" onChange={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Responses: Off");
  });
});

describe("StationTrack chain slot", () => {
  it("mounts the switch in the actions slot, before the phase buttons", () => {
    const { container } = render(<StationTrack {...track} chainMode={{ mode: "auto", onChange: vi.fn() }} />);
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("data-chain")).toBe("true");
    const group = screen.getByTestId("chain-mode-switch");
    const wait = screen.getByRole("button", { name: /Waiting/ });
    // The switch comes first in document order, the wait button after it.
    expect(group.compareDocumentPosition(wait) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws nothing for a spectator, a replay or a scenario table (no control)", () => {
    const { container, rerender } = render(<StationTrack {...track} />);
    expect(screen.queryByTestId("chain-mode-switch")).toBeNull();
    expect(container.querySelector("nav")!.hasAttribute("data-chain")).toBe(false);
    rerender(<StationTrack {...track} chainMode={null} />);
    expect(screen.queryByTestId("chain-mode-switch")).toBeNull();
  });

  it("keeps the phase buttons working beside the switch", () => {
    const onChoose = vi.fn();
    render(<StationTrack {...track} canAct onChoose={onChoose}
      actionOptions={[{ id: "to_bp", label: "Go to Battle Phase" }, { id: "to_ep", label: "End turn" }]}
      chainMode={{ mode: "always", onChange: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "End Turn" }));
    expect(onChoose).toHaveBeenCalledWith("to_ep");
  });
});
