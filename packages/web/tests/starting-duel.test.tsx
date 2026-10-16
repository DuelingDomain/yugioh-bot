// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { StartingDuel, startingVariant } from "@/components/duel/starting-duel";
import { makeSeriesRoom } from "./helpers/duel-series";

afterEach(cleanup);

function room(patch: Record<string, unknown> = {}, status: DuelRoom["session"]["status"] = "lobby"): DuelRoom {
  const base = makeSeriesRoom({ status, series: null });
  return { ...base, session: { ...base.session, format: "ffa4" }, ...patch } as DuelRoom;
}
const OPENING = { phase: "start", round: 1, rounds: [] } as unknown as DuelRoom["opening"];
const ENGINE = { revision: 0 } as unknown as DuelRoom["engine"];

describe("startingVariant", () => {
  it("keeps the normal lobby and opening while the host is not starting", () => {
    expect(startingVariant(room())).toBeNull();
    expect(startingVariant(room({ opening: OPENING }))).toBeNull();
  });

  it("puts a banner over the dice or RPS result when the host starts the engine", () => {
    expect(startingVariant(room({ opening: OPENING, starting: true }))).toBe("banner");
  });

  it("uses a card over the lobby for a start with no opening (Tag, 1v1 without RPS)", () => {
    expect(startingVariant(room({ starting: true }))).toBe("card");
  });

  it("goes back to the lobby when a failed start clears the flag", () => {
    const failed = room({ opening: OPENING });
    expect(startingVariant({ ...failed, starting: undefined })).toBeNull();
  });

  it("covers an active room until its first engine view arrives, then shows the field", () => {
    expect(startingVariant(room({}, "active"))).toBe("card");
    expect(startingVariant(room({ engine: ENGINE }, "active"))).toBeNull();
    expect(startingVariant(room({ error: "Could not build the view" }, "active"))).toBeNull();
  });

  it("ignores finished duels", () => {
    expect(startingVariant(room({}, "completed"))).toBeNull();
    expect(startingVariant(room({ starting: true }, "completed"))).toBeNull();
  });
});

describe("StartingDuel", () => {
  it("shows a status banner without moving the screen under it", () => {
    render(<StartingDuel room={room()} variant="banner" />);
    const root = screen.getByTestId("starting-duel");
    expect(root.dataset.variant).toBe("banner");
    expect(screen.getByRole("status").textContent).toContain("Starting duel");
    expect(root.dataset.reduced).toBeUndefined();
  });

  it("lists the players and the format on the card", () => {
    render(<StartingDuel room={room()} variant="card" />);
    expect(screen.getByRole("heading", { name: "Starting duel" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Players" }).textContent).toBe("SulmanImran");
    expect(screen.getByRole("status").textContent).toContain("Setting up the table");
  });

  it("marks the viewer's reduced Motion setting", () => {
    render(<StartingDuel room={room()} variant="banner" reducedMotion />);
    expect(screen.getByTestId("starting-duel").dataset.reduced).toBe("true");
  });
});
