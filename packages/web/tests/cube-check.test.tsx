// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CubeCheck } from "@/components/cubes/cube-check";
import { boosterReadiness } from "@/components/cubes/readiness";
import type { CubePoolsDto } from "@/lib/cube-pools";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

/** `names` different cards, each with `copies` copies. */
function pool(names: number, copies: number, start = 1) {
  return Array.from({ length: names }, (_, i) => ({ catalogCardId: start + i, pool: "main" as const, maxCopies: copies }));
}
const pools = (main: number, extra = 0, copies = 3): CubePoolsDto => ({
  main: pool(main, copies),
  extra: pool(extra, copies, 1000).map((e) => ({ ...e, pool: "extra" as const })),
});

describe("boosterReadiness", () => {
  it("uses 40 cards and packs of 15 when the cube has no saved settings", () => {
    const r = boosterReadiness(30);
    expect(r).toMatchObject({ cardsPerPlayer: 40, packSize: 15, waves: 3, maxPlayers: 2, state: "ready" });
    expect(r.reach).toMatchObject({ have: 90, need: 40, short: 0 });
    expect(r.names2).toMatchObject({ have: 30, need: 30, short: 0 });
  });

  it("limits what one player can reach to 3 copies of a name, and by the waves", () => {
    // 10 names, 5 waves: 10 × min(5, 3) = 30 reachable against 45 needed.
    const r = boosterReadiness(10, { cardsPerPlayer: 45, packSize: 9 });
    expect(r.waves).toBe(5);
    expect(r.reach).toMatchObject({ have: 30, need: 45, short: 15 });
    expect(r.state).toBe("blocked");
    // One wave only: a name gives one card.
    expect(boosterReadiness(10, { cardsPerPlayer: 10, packSize: 10 }).reach.have).toBe(10);
  });

  it("counts seats as names ÷ pack size and blocks under two players", () => {
    expect(boosterReadiness(45).maxPlayers).toBe(3);
    const r = boosterReadiness(29);
    expect(r.names2.short).toBe(1);
    expect(r.state).toBe("blocked");
  });

  it("takes packs per player from the saved config before the derived count", () => {
    expect(boosterReadiness(100, { cardsPerPlayer: 40, packSize: 15, packsPerPlayer: 4 }).waves).toBe(4);
  });
});

describe("CubeCheck", () => {
  it("theme: the existing theme draft check with its 'can't start' line", () => {
    render(<CubeCheck type="theme" pools={pools(2, 0, 1)} />);
    expect(screen.getByRole("heading", { name: "Theme draft check" })).toBeInTheDocument();
    expect(screen.getByText(/40 main copies short/)).toBeInTheDocument();
    expect(screen.getByText(/A theme draft can.t start with it/)).toBeInTheDocument();
  });

  it("theme: ready once main and extra are covered", () => {
    render(<CubeCheck type="theme" pools={pools(14, 6)} />);
    expect(screen.getByText("Ready for a theme draft.")).toBeInTheDocument();
  });

  it("booster: the cube draft check, with the pool size against two players", () => {
    render(<CubeCheck type="booster" pools={pools(10)} />);
    expect(screen.getByRole("heading", { name: "Cube draft check" })).toBeInTheDocument();
    expect(screen.getByText("40 cards each, 3 packs of 15")).toBeInTheDocument();
    expect(screen.getByText("20 more different cards needed.")).toBeInTheDocument();
    expect(screen.getByText(/Two players need 30 different cards at 15 a pack/)).toBeInTheDocument();
    expect(screen.queryByText(/theme/i)).not.toBeInTheDocument();
  });

  it("booster: says how many players a big enough cube seats", () => {
    render(<CubeCheck type="booster" pools={pools(45, 20)} />);
    expect(screen.getByText("Ready for a cube draft.")).toBeInTheDocument();
    expect(screen.getByText(/Seats up to 3 players/)).toBeInTheDocument();
  });

  it("booster: only the Main pool counts, Extra cards do not make a cube draft ready", () => {
    render(<CubeCheck type="booster" pools={pools(25, 10)} />);
    expect(screen.queryByText("Ready for a cube draft.")).not.toBeInTheDocument();
    expect(screen.getByText("5 more different cards needed.")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "25 of 30 different cards for 2 players" })).toBeInTheDocument();
  });

  it("any: Extra cards do not count towards the cube draft line either", () => {
    render(<CubeCheck type="any" pools={pools(25, 10)} />);
    expect(screen.getByText(/needs 5 more different cards/)).toBeInTheDocument();
  });

  it("booster: the reach line when too few different cards for the deck", () => {
    render(<CubeCheck type="booster" pools={pools(30)} settings={{ cardsPerPlayer: 100, packSize: 15, packsPerPlayer: 2 }} />);
    // 30 names × min(2, 3) = 60 reachable; the deck needs min(100, 2 × 15) = 30, so it is fine.
    expect(screen.getByText("Ready for a cube draft.")).toBeInTheDocument();
    render(<CubeCheck type="booster" pools={pools(30)} settings={{ cardsPerPlayer: 100, packSize: 15, packsPerPlayer: 7 }} />);
    // 7 waves: reach 30 × 3 = 90 of min(100, 105) = 100.
    expect(screen.getByText("One player can reach 90 of 100 cards.")).toBeInTheDocument();
  });

  it("any: both checks as short lines and no theme warning", () => {
    render(<CubeCheck type="any" pools={pools(2, 0, 1)} />);
    expect(screen.getByRole("heading", { name: "Cube check" })).toBeInTheDocument();
    expect(screen.getByText(/needs 40 more main copies/)).toBeInTheDocument();
    expect(screen.getByText(/needs 28 more different cards/)).toBeInTheDocument();
    expect(screen.queryByText(/can.t start/)).not.toBeInTheDocument();
    expect(screen.queryByText(/short\./)).not.toBeInTheDocument();
  });

  it("any: ready lines for a cube that suits both", () => {
    render(<CubeCheck type="any" pools={pools(30, 10)} />);
    expect(screen.getByText("Theme draft:").parentElement).toHaveTextContent("Theme draft: ready.");
    expect(screen.getByText("Cube draft:").parentElement).toHaveTextContent("Cube draft: ready for up to 2 players.");
  });
});
