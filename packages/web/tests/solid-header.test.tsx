// @vitest-environment jsdom
// SolidHeader: the whose-turn pill follows the tone, and Tilt/Flat is one toggle button.
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SolidHeader, type SolidHeaderProps } from "@/components/duel/solid/solid-header";

afterEach(cleanup);

function header(over: Partial<SolidHeaderProps> = {}) {
  const props: SolidHeaderProps = {
    identity: <a href="/duels">Dueling Domain</a>, format: "Domain · Normal", turn: 3, phaseName: "Main Phase 1", step: null,
    turnText: "Your turn", tone: "you", spectator: false, live: <span role="status">Live duel</span>, tools: null,
    view: "tilt", onTilt: vi.fn(), onGear: vi.fn(), ...over,
  };
  render(<SolidHeader {...props} />);
  return props;
}

describe("SolidHeader", () => {
  it("shows the wordmark, the turn and the pill for the viewer", () => {
    header();
    expect(screen.getByText("Dueling Domain")).toBeTruthy();
    expect(screen.getByText("Turn 3")).toBeTruthy();
    expect(document.querySelector("[data-owner='you']")?.textContent).toContain("Your turn");
  });
  it("marks the opponent's and a spectator's pill", () => {
    header({ tone: "opp", turnText: "Bot's turn" });
    expect(document.querySelector("[data-owner='opp']")?.textContent).toContain("Their turn");
    cleanup();
    header({ tone: "watch", spectator: true, turnText: "Bot's turn" });
    expect(document.querySelector("[data-owner='watch'][data-spectator='true']")).toBeTruthy();
  });
  it("toggles Tilt and Flat and opens the settings", () => {
    const props = header();
    fireEvent.click(screen.getByRole("button", { name: /Board view: Tilt/ }));
    expect(props.onTilt).toHaveBeenCalledWith("flat");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(props.onGear).toHaveBeenCalled();
    cleanup();
    const flat = header({ view: "flat" });
    fireEvent.click(screen.getByRole("button", { name: /Board view: Flat/ }));
    expect(flat.onTilt).toHaveBeenCalledWith("tilt");
  });
});
