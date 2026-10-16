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

/** The 3-way plaza, the 4-way grid and the Tag Rooftop keep their side content in closed edge drawers (a tab each). */
const drawer = (name: string) => document.querySelector<HTMLElement>(`[data-edge-drawer="${name}"]`)!;
const tabOf = (name: string) => drawer(name).querySelector<HTMLButtonElement>("button[aria-expanded]")!;
const tagTab = (id: string) => screen.getByTestId(`hud-drawer-${id}`).querySelector("button[aria-controls]") as HTMLElement;
const openDrawer = () => document.querySelector("[data-edge-drawer][data-state='open']") as HTMLElement;
type Kind = "grid" | "tag";
/** Opens the history and returns the element that holds it. */
function openLog(kind: Kind) {
  if (kind === "tag") fireEvent.click(tagTab("log"));
  else fireEvent.click(tabOf("Log"));
  return kind === "tag" ? openDrawer() : drawer("Log");
}

const MODES: Array<{ name: string; ui: () => React.ReactElement; rivals: string[]; hidden: string; camera: boolean; kind: Kind; cardDrawer: string }> = [
  { name: "3-way free-for-all", ui: () => <TableMain set={FFA3_FIXTURES} />, rivals: ["Ryo Sato", "Mika Hana"], hidden: TABLE_CARDS.mirrorForce.name, camera: true, kind: "grid", cardDrawer: "Card" },
  { name: "4-way free-for-all", ui: () => <TableMain set={FFA4_FIXTURES} />, rivals: ["Rook", "Juniper", "Mirelle"], hidden: TABLE_CARDS.mirrorForce.name, camera: false, kind: "grid", cardDrawer: "Inspect" },
  { name: "2v2 Tag", ui: () => <TagMain />, rivals: ["Mirelle Quay", "Juniper Rook"], hidden: TABLE_CARDS.torrential.name, camera: true, kind: "tag", cardDrawer: "Card" },
];

describe.each(MODES)("the duel log on the $name table", ({ ui, rivals, hidden, camera, kind, cardDrawer }) => {
  it("has a Log control next to Settings (and Camera), that opens the history", () => {
    render(ui());
    if (kind === "grid") {
      for (const name of ["Log", "Settings", camera ? "Camera" : "Inspect"]) expect(tabOf(name), name).toBeTruthy();
    } else {
      for (const id of ["log", "settings", ...(camera ? ["camera"] : [])]) expect(screen.getByTestId(`hud-drawer-${id}`), id).toBeTruthy();
    }
    const panel = openLog(kind);
    expect(panel.getAttribute("data-edge-drawer")).toBe("Log");
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(within(panel).getByRole("region", { name: "Duel history events" })).toBeTruthy();
  });

  it("names the player on each entry, rivals included, and marks you as YOU", () => {
    render(ui());
    const history = within(openLog(kind)).getByRole("region", { name: "Duel history events" });
    expect(within(history).getAllByText(/^you$/i).length).toBeGreaterThan(0);
    const text = history.textContent?.toLowerCase() ?? "";
    for (const name of rivals) expect(text, name).toContain(name.toLowerCase().split(" ")[0]);
  });

  it("writes the seat colour marker and the player name in the Text log", () => {
    const { container } = render(ui());
    fireEvent.click(within(openLog(kind)).getByText("Text log"));
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
    fireEvent.click(within(openLog(kind)).getByText("Text log"));
    expect(container.textContent).not.toContain(hidden);
  });

  it("opens a card clicked in the log in the Card view, and the log keeps its rows", () => {
    render(ui());
    const panel = openLog(kind);
    const thumb = within(panel).getAllByRole("button").find((node) => /^Inspect (?!card$)/.test(node.getAttribute("aria-label") ?? ""))!;
    expect(thumb).toBeTruthy();
    const name = (thumb.getAttribute("aria-label") ?? "").replace(/^Inspect /, "");
    fireEvent.click(thumb);
    if (kind === "grid") {
      // The card opens in its own drawer, which takes the place of the Log drawer.
      expect(drawer(cardDrawer).getAttribute("data-state")).toBe("open");
      expect(drawer(cardDrawer).textContent).toContain(name);
      fireEvent.click(tabOf("Log"));
      expect(within(drawer("Log")).getByRole("region", { name: "Duel history events" })).toBeTruthy();
      return;
    }
    // Tag: the Card drawer takes over from the Log drawer, and the Log drawer keeps its rows once reopened.
    expect(openDrawer().getAttribute("data-edge-drawer")).toBe("Card");
    expect(openDrawer().textContent).toContain(name);
    fireEvent.click(tagTab("log"));
    expect(within(openDrawer()).getByRole("region", { name: "Duel history events" })).toBeTruthy();
  });
});

describe("DuelLogLine with seat colours", () => {
  const names = (seat: number) => ["Ren", "Ryo", "Mika", "Eli"][seat] ?? `Player ${seat + 1}`;
  const tones = new Map([[1, { main: "#33aaff", ink: "#001122" }], [2, { main: "#66dd66", ink: "#002200" }]]);

  it("replaces each Player N with a coloured name, also for two players in one line", () => {
    const { container } = render(<DuelLogLine text="Player 2 attacks Player 3" playerName={names} seatTones={tones} />);
    const marks = [...container.querySelectorAll("b[data-seat]")];
    expect(marks.map((node) => [node.getAttribute("data-seat"), node.textContent])).toEqual([["1", "Ryo"], ["2", "Mika"]]);
    expect((marks[0] as HTMLElement).style.getPropertyValue("--seat-main")).toBe("#33aaff");
  });

  it("keeps the old text without seat colours, as in 1v1", () => {
    const { container } = render(<DuelLogLine text="Player 2 attacks Player 3" playerName={names} />);
    expect(container.querySelector("b[data-seat]")).toBeNull();
    expect(container.textContent).toContain("Ryo");
    expect(container.textContent).toContain("Mika");
  });

  it("does not match Player 10 or a Player number above 4", () => {
    const { container } = render(<DuelLogLine text="Player 10 and Player 5 wait" playerName={names} seatTones={tones} />);
    expect(container.querySelector("b[data-seat]")).toBeNull();
    expect(container.textContent).toContain("Player 10");
    expect(container.textContent).toContain("Player 5");
  });

  it("writes the plain name for a seat without a colour, and colours the others", () => {
    const { container } = render(<DuelLogLine text="Player 1 attacks Player 2" playerName={names} seatTones={tones} />);
    expect([...container.querySelectorAll("b[data-seat]")].map((node) => node.textContent)).toEqual(["Ryo"]);
    expect(container.textContent).toContain("Ren attacks Ryo");
  });
});
