// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelResultScreen } from "@/components/duel/duel-result";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { placeLabel, placings } from "@/components/duel/table/seat-state";

afterEach(cleanup);

const room = FFA3_FIXTURES.states.result.room;

describe("DuelResultScreen placings", () => {
  it("lists every duelist in the order of the placings, each with its place", () => {
    const rows = placings(room.engine!, [2, 1]).map((row) => ({ seat: row.seat, place: row.place, label: placeLabel(row.place) }));
    render(<DuelResultScreen room={room} slug="x" reducedMotion soundEnabled={false} onClose={vi.fn()} placings={rows} />);
    const board = screen.getByRole("list", { name: "Final standings" });
    const items = [...board.querySelectorAll("li")];
    expect(items.map((item) => item.getAttribute("data-seat"))).toEqual(["0", "1", "2"]);
    expect(items.map((item) => item.querySelector("[data-place]")?.textContent)).toEqual(["1st", "2nd", "3rd"]);
    expect(items[0]).toHaveTextContent("Winner");
  });

  it("keeps the Life Points list without placings", () => {
    render(<DuelResultScreen room={room} slug="x" reducedMotion soundEnabled={false} onClose={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Final Life Points" })).toBeInTheDocument();
    expect(document.querySelector("[data-place]")).toBeNull();
  });
});
