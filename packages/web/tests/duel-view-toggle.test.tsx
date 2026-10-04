// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuelViewToggle } from "@/components/settings/duel-view-toggle";
import { BOARD_VIEW_KEY, readBoardView, writeBoardView } from "@/components/duel/board-view";

beforeEach(() => {
  window.localStorage.clear();
  writeBoardView({ mode: "classic", tilt: "tilt" });
  window.localStorage.clear();
});
afterEach(cleanup);

describe("DuelViewToggle", () => {
  it("has its own heading apart from the server controls", () => {
    render(<DuelViewToggle />);
    expect(screen.getByRole("heading", { level: 2, name: "This device" })).toBeTruthy();
    expect(screen.getByText(/Show 1v1 duels on the tilted Solid Vision table/)).toBeTruthy();
  });

  it("is off by default", () => {
    render(<DuelViewToggle />);
    const toggle = screen.getByRole("switch", { name: "3D mode" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("turns 3D mode on and off and saves it on this device", () => {
    render(<DuelViewToggle />);
    const toggle = screen.getByRole("switch", { name: "3D mode" }) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(readBoardView().mode).toBe("3d");
    expect(JSON.parse(window.localStorage.getItem(BOARD_VIEW_KEY) ?? "{}")).toMatchObject({ v: 1, mode: "3d" });
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(readBoardView().mode).toBe("classic");
  });

  it("keeps the tilt choice when the mode changes", () => {
    writeBoardView({ mode: "classic", tilt: "flat" });
    render(<DuelViewToggle />);
    fireEvent.click(screen.getByRole("switch", { name: "3D mode" }));
    expect(readBoardView()).toMatchObject({ mode: "3d", tilt: "flat" });
  });

  it("shows a setting that was saved before", () => {
    writeBoardView({ mode: "3d", tilt: "tilt" });
    render(<DuelViewToggle />);
    expect((screen.getByRole("switch", { name: "3D mode" }) as HTMLInputElement).checked).toBe(true);
  });
});
