// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell, type TableShellProps } from "@/components/duel/table/table-shell";
import { PICK_CONTINUATION } from "@/components/duel/pick-continuation";

beforeAll(() => {
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const media = (narrow: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
function Shell({ normal = false, prompt, ...props }: Partial<TableShellProps> & { normal?: boolean; prompt?: DuelPrompt | null }) {
  const fixture = FFA3_FIXTURES.states.main;
  const room = { ...fixture.room, session: { ...fixture.room.session, mode: normal ? "normal" as const : "domain" as const }, engine: { ...fixture.room.engine!, ...(prompt === undefined ? {} : { prompt }) } };
  const controller = useFixtureController({ ...fixture, room }, { reducedMotion: true });
  return <TableShell fxActive={false} controller={controller} {...props} />;
}

describe("table phone panes", () => {
  it("offers Masters on a Domain table and opens the master's rail in a sheet", () => {
    media(true);
    render(<Shell />);
    const bar = screen.getByLabelText("Mobile duel panels");
    expect(within(bar).getAllByRole("button").map((node) => node.textContent)).toEqual(["Card", "Log", "Settings", "Masters"]);
    fireEvent.click(within(bar).getByRole("button", { name: "Masters" }));
    expect(screen.getByRole("dialog", { name: "Deck Masters" }).querySelector("[data-master-dock]")).not.toBeNull();
  });

  it("leaves Masters out for Standard tables", () => {
    media(true);
    render(<Shell normal />);
    expect(within(screen.getByLabelText("Mobile duel panels")).queryByRole("button", { name: "Masters" })).toBeNull();
  });

  it("suspends camera shortcuts while a phone pane is open", () => {
    media(true);
    const { container } = render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const stage = container.querySelector("[data-table-stage]")!;
    const before = stage.getAttribute("data-camera-mode");
    fireEvent.keyDown(window, { key: "o" });
    expect(stage).toHaveAttribute("data-camera-mode", before);
  });
});

describe("table live connection settings", () => {
  it("shows presence and reconnect state, and requests a resync", async () => {
    media(false);
    const resync = vi.fn().mockResolvedValue(undefined);
    render(<Shell connection={{ connected: false, syncing: false, recovering: true, presence: { onlineSeats: [0], spectatorCount: 2 }, resync }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("Reconnecting live updates; polling for the latest state.")).toBeTruthy();
    expect(screen.getByText("2 watching")).toBeTruthy();
    expect(screen.getByText("Ren Arata · Connected")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Catch up now" })); });
    expect(resync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reconnecting")).toBeTruthy();
  });

  it("disables catch-up while syncing and reports failed resyncs", async () => {
    media(false);
    const resync = vi.fn().mockRejectedValue(new Error("offline"));
    const connection = { connected: false, syncing: true, recovering: false, presence: null, resync };
    const view = render(<Shell connection={connection} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Catch up now" })).toBeDisabled();
    view.rerender(<Shell connection={{ ...connection, syncing: false }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Catch up now" })); });
    expect(screen.getByRole("alert").textContent).toContain("Could not catch up");
  });
});

describe("table pick continuation", () => {
  it("keeps a disabled material-pick bar during the no-prompt gap then releases it", async () => {
    media(false);
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const prompt: DuelPrompt = { id: "materials", seat: 0, kind: "toggle", title: "Select Synchro Material", finishable: true, options: [{ id: "select:0", label: "Material", controller: 0, location: 4, sequence: 0 }] };
    const view = render(<Shell prompt={prompt} />);
    const card = view.container.querySelector("[data-zones='0:4:0']")!;
    fireEvent.click(card.querySelector("button") ?? card);
    expect(info.mock.calls.filter((call) => call[0] === "[table-preview] answer")).toHaveLength(1);
    view.rerender(<Shell prompt={null} />);
    expect(screen.getByRole("group", { name: /Select Synchro Material/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Finish/ })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PICK_CONTINUATION.holdMs + 1); });
    expect(screen.queryByRole("group", { name: /Select Synchro Material/ })).toBeNull();
  });
});
