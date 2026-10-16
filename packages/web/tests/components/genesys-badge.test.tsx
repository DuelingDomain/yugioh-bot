// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GenesysBadge, GenesysMeter } from "../../src/components/decks/genesys-ui";
import type { GenesysSummary } from "../../src/components/decks/genesys";

const MONSTER = 0x1;
const LINK = 0x4000000;

afterEach(cleanup);

describe("GenesysBadge", () => {
  it("shows a bold number with pts", () => {
    render(<GenesysBadge card={{ type: MONSTER, genesysPoints: 12 }} />);
    const badge = screen.getByTitle("12 Genesys points");
    expect(badge).toHaveTextContent("12pts");
    expect(badge).not.toHaveAttribute("data-v");
  });

  it("marks Link and unknown points, and shows nothing for 0 points", () => {
    const { rerender, container } = render(<GenesysBadge card={{ type: LINK, genesysPoints: 0 }} />);
    expect(screen.getByTitle("Not allowed in Genesys")).toHaveAttribute("data-k", "forbidden");
    rerender(<GenesysBadge card={{ type: MONSTER, genesysPoints: null }} />);
    expect(screen.getByTitle("Genesys points unknown")).toHaveTextContent("?pts");
    rerender(<GenesysBadge card={{ type: MONSTER, genesysPoints: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 0 pts for a 0-point card with zero (the Deck Master slot)", () => {
    const { rerender } = render(<GenesysBadge card={{ type: MONSTER, genesysPoints: 0 }} zero />);
    expect(screen.getByTitle("0 Genesys points")).toHaveTextContent("0pts");
    rerender(<GenesysBadge card={{ type: MONSTER, genesysPoints: 5 }} zero />);
    expect(screen.getByTitle("5 Genesys points")).toHaveTextContent("5pts");
    rerender(<GenesysBadge card={{ type: LINK, genesysPoints: 0 }} zero />);
    expect(screen.getByTitle("Not allowed in Genesys")).toHaveAttribute("data-k", "forbidden");
    rerender(<GenesysBadge card={undefined} zero />);
    expect(screen.queryByTitle(/Genesys/)).toBeNull();
  });

  it("takes a row, inline or lifted placement", () => {
    const { rerender } = render(<GenesysBadge card={{ type: MONSTER, genesysPoints: 3 }} variant="row" />);
    expect(screen.getByTitle("3 Genesys points")).toHaveAttribute("data-v", "row");
    rerender(<GenesysBadge card={{ type: MONSTER, genesysPoints: 3 }} lift />);
    expect(screen.getByTitle("3 Genesys points")).toHaveAttribute("data-lift");
  });
});

describe("GenesysMeter", () => {
  const summary = (over: Partial<GenesysSummary>): GenesysSummary => ({
    cap: 100, total: 86, known: 86, over: 0, unknownCount: 0, pendingCount: 0, forbidden: [], unknownCards: [], state: "ok", ...over,
  });

  it("shows the total against the cap with pts", () => {
    render(<GenesysMeter summary={summary({})} />);
    expect(screen.getByRole("group", { name: "Genesys points" })).toHaveTextContent("86/100pts");
  });

  it("follows the total as the deck changes", () => {
    const { rerender } = render(<GenesysMeter summary={summary({})} />);
    rerender(<GenesysMeter summary={summary({ total: 104, known: 104, over: 4, state: "over" })} />);
    const meter = screen.getByRole("group", { name: "Genesys points" });
    expect(meter).toHaveTextContent("104/100pts");
    expect(meter).toHaveAttribute("data-s", "over");
  });
});
