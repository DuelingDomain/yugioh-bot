// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
beforeAll(() => {
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Shell({ room, busy = false }: { room: DuelRoom; busy?: boolean }) {
  const controller = useFixtureController({ id: "main", label: "Live", room }, { reducedMotion: true });
  return <TableShell controller={controller} busy={busy} fxActive={false} />;
}

describe("table compatibility with live multiplayer selectors", () => {
  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("keeps the seat strip and seat state attributes for $format", (set) => {
    render(<Shell room={set.states.main.room} />);
    expect(within(screen.getByTestId("seat-strip")).getAllByRole("listitem")).toHaveLength(set.states.main.room.engine!.seats.length);
    const turn = set.states.main.room.engine!.turnSeat;
    expect(screen.getByTestId(`seat-strip-${turn}`)).toHaveAttribute("data-turn", "true");
    expect(screen.getAllByRole("list", { name: "Turn order" })).toHaveLength(1);
  });

  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("answers offered seat picks on $format", (set) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    render(<Shell room={set.states["choose-opponent"].room} />);
    expect(screen.queryByTestId("seat-strip-pick-0")).toBeNull();
    const pick = screen.getByTestId("seat-strip-pick-2");
    fireEvent.click(pick);
    expect(info.mock.calls.filter((call) => call[0] === "[table-preview] answer")).toHaveLength(1);
  });

  it("withholds seat-pick buttons while busy", () => {
    render(<Shell room={FFA3_FIXTURES.states["choose-opponent"].room} busy />);
    expect(screen.queryByTestId("seat-strip-pick-2")).toBeNull();
  });

  it("shows Leaving before the seat is out, and keeps the self-eliminated status after loss", () => {
    const room = FFA3_FIXTURES.states.main.room;
    const engine = { ...room.engine!, seats: room.engine!.seats.map((seat) => ({ ...seat, pendingElimination: seat.seat === 2 })) };
    const view = render(<Shell room={{ ...room, engine }} />);
    expect(screen.getByTestId("seat-strip-leaving-2")).toBeVisible();
    expect(screen.getByTestId("seat-strip-2")).toHaveAttribute("data-eliminated", "false");
    view.rerender(<Shell room={{ ...FFA3_FIXTURES.states.elimination.room, mySeat: 2 }} />);
    expect(screen.getByTestId("seat-strip-2")).toHaveAttribute("data-eliminated", "true");
    expect(screen.getByTestId("self-eliminated")).toBeVisible();
    expect(screen.getByTestId("self-eliminated")).toHaveTextContent("keep watching");
  });
});
