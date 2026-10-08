// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TABLE_CARDS } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureSet } from "@/components/duel/table/fixtures/common";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { DuelLogLine } from "@/components/duel/log-line";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function TableMain({ set }: { set: TableFixtureSet }) {
  const controller = useFixtureController(set.states.main, { reducedMotion: true });
  return <TableShell controller={controller} />;
}
function TagMain() {
  const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: true });
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} fxActive={false} />;
}

const flyout = () => screen.getByTestId("hud-flyout");

const MODES: Array<{ name: string; ui: () => React.ReactElement; rivals: string[]; hidden: string; camera: boolean }> = [
  { name: "3-way free-for-all", ui: () => <TableMain set={FFA3_FIXTURES} />, rivals: ["Ryo Sato", "Mika Hana"], hidden: TABLE_CARDS.mirrorForce.name, camera: true },
  { name: "4-way free-for-all", ui: () => <TableMain set={FFA4_FIXTURES} />, rivals: ["Rook", "Juniper", "Mirelle"], hidden: TABLE_CARDS.mirrorForce.name, camera: false },
  { name: "2v2 Tag", ui: () => <TagMain />, rivals: ["Mirelle Quay", "Juniper Rook"], hidden: TABLE_CARDS.torrential.name, camera: true },
];

describe.each(MODES)("the duel log on the $name table", ({ ui, rivals, hidden, camera }) => {
  it("has a Log icon in the dock, next to Settings and Camera, that opens the history", () => {
    render(ui());
    for (const id of ["log", "settings", ...(camera ? ["camera"] : [])]) expect(screen.getByTestId(`hud-dock-${id}`), id).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(flyout().getAttribute("data-pane")).toBe("log");
    const tabs = within(flyout()).getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(expect.arrayContaining(["Log", "Settings", ...(camera ? ["Camera"] : [])]));
    expect(within(flyout()).getByRole("region", { name: "Duel history events" })).toBeTruthy();
  });

  it("names the player on each entry, rivals included, and marks you as YOU", () => {
    render(ui());
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    const history = within(flyout()).getByRole("region", { name: "Duel history events" });
    expect(within(history).getAllByText(/^you$/i).length).toBeGreaterThan(0);
    const text = history.textContent?.toLowerCase() ?? "";
    for (const name of rivals) expect(text, name).toContain(name.toLowerCase().split(" ")[0]);
  });

  it("writes the seat colour marker and the player name in the Text log", () => {
    const { container } = render(ui());
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.click(within(flyout()).getByText("Text log"));
    const seats = [...container.querySelectorAll("details b[data-seat]")];
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.some((node) => node.getAttribute("data-seat") !== "0")).toBe(true);
    // The engine's "Player N" never shows: the names replace it.
    const details = container.querySelector("details")!;
    expect(details.textContent).not.toMatch(/\bPlayer [1-4]\b/);
    // Rivals show by name; with Tag the partner shows too.
    const shown = seats.map((node) => node.textContent ?? "");
    for (const name of rivals) expect(shown, name).toContain(name);
  });

  it("keeps a face-down card hidden in both logs", () => {
    const { container } = render(ui());
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.click(within(flyout()).getByText("Text log"));
    expect(container.textContent).not.toContain(hidden);
  });

  it("opens a card clicked in the log in the Card tab, and the log keeps its rows", () => {
    render(ui());
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    const thumb = within(flyout()).getAllByRole("button").find((node) => /^Inspect (?!card$)/.test(node.getAttribute("aria-label") ?? ""))!;
    expect(thumb).toBeTruthy();
    const name = (thumb.getAttribute("aria-label") ?? "").replace(/^Inspect /, "");
    fireEvent.click(thumb);
    expect(within(flyout()).getByRole("tab", { name: "Card" }).getAttribute("aria-selected")).toBe("true");
    expect(within(flyout()).getByRole("tabpanel", { name: "Card" }).textContent).toContain(name);
    fireEvent.click(within(flyout()).getByRole("tab", { name: "Log" }));
    expect(within(flyout()).getByRole("region", { name: "Duel history events" })).toBeTruthy();
  });
});

describe("DuelLogLine with seat colours", () => {
  const names = (seat: number) => ["Ren", "Ryo", "Mika", "Eli"][seat] ?? `Player ${seat + 1}`;
  const tones = new Map([[1, { main: "#33aaff", ink: "#001122" }], [2, { main: "#66dd66", ink: "#002200" }]]);

  it("replaces each Player N with a coloured name, also for two players in one line", () => {
    const { container } = render(<DuelLogLine text="Player 2 attacks Player 3" kind="battle" playerName={names} seatTones={tones} />);
    const marks = [...container.querySelectorAll("b[data-seat]")];
    expect(marks.map((node) => [node.getAttribute("data-seat"), node.textContent])).toEqual([["1", "Ryo"], ["2", "Mika"]]);
    expect((marks[0] as HTMLElement).style.getPropertyValue("--seat-main")).toBe("#33aaff");
  });

  it("keeps the old text without seat colours, as in 1v1", () => {
    const { container } = render(<DuelLogLine text="Player 2 attacks Player 3" kind="battle" playerName={names} />);
    expect(container.querySelector("b[data-seat]")).toBeNull();
    expect(container.textContent).toContain("Ryo");
    expect(container.textContent).toContain("Mika");
  });
});
