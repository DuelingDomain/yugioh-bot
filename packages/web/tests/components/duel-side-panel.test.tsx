// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelEvent, DuelRoom } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const swr = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("swr", () => ({
  default: () => ({ data: swr.data, error: undefined, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
// The board and every effect layer are not under test here.
vi.mock("@/components/duel/field", () => ({
  DuelField: () => <div data-testid="field" />,
  DeckMasterRail: () => null,
}));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));

import { DuelRoomView } from "@/components/duel/room";
import { DuelHistoryRail } from "@/components/duel/history-rail";
import { CardTabEmpty, DESKTOP_PANES, desktopPane, mobilePanes, SidePanel, SideTabs, unreadLabel } from "@/components/duel/side-panel";

const KEY = "yugidraft.duelPreferences.v1";

const info = (code: number, name: string) =>
  ({ code, name, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "" });

const summon = (id: number, name = `Card ${id}`): DuelEvent =>
  ({ id, kind: "summon", seat: 0, card: info(id, name), summonKind: "normal", text: "" }) as DuelEvent;

function seatView(seat: number) {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [], spells: [], graveyard: [], banished: [],
  };
}

function engineView(events: DuelEvent[]): DuelEngineView {
  return {
    revision: events.length + 1, turn: 1, turnSeat: 0, phase: "main1",
    seats: [seatView(0), seatView(1)], prompt: null, chain: [], events, log: [], result: null,
  } as unknown as DuelEngineView;
}

function makeRoom(events: DuelEvent[]): DuelRoom {
  return {
    session: {
      id: 1, slug: "abc", name: "Table", guildId: "g", organizerPlayerId: 1, mode: "normal", masterRule: 5,
      status: "active",
      settings: {
        visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 0, startingLP: 8000, startingHand: 5,
        drawPerTurn: 1, timeout: "loss", validateDeck: true, shuffleDeck: true, stopAtEveryWindow: false,
      },
      seats: [
        { seat: 0, playerId: 1, displayName: "Sulman", ready: true, isBot: false },
        { seat: 1, playerId: 2, displayName: "Practice Bot", ready: true, isBot: true },
      ],
      createdAt: "", endedAt: null, archivedAt: null, winnerPlayerId: null, winnerSeat: null, resultReason: null,
    },
    role: "player", mySeat: 0, myDeck: null, clock: null, metadataOnly: false,
    engine: engineView(events),
  } as unknown as DuelRoom;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("side panel helpers", () => {
  it("orders the tabs Card, Log, Settings, with Deck Masters last in the narrow bar only", () => {
    expect(DESKTOP_PANES).toEqual(["card", "log", "settings"]);
    expect(mobilePanes(false)).toEqual(["card", "log", "settings"]);
    expect(mobilePanes(true)).toEqual(["card", "log", "settings", "masters"]);
    expect(desktopPane("masters")).toBe("card");
    expect(desktopPane("settings")).toBe("settings");
  });

  it("caps the badge at 9+", () => {
    expect(unreadLabel(3)).toBe("3");
    expect(unreadLabel(12)).toBe("9+");
  });
});

describe("SideTabs", () => {
  function Harness({ unread = 0 }: { unread?: number }) {
    const [pane, setPane] = React.useState<"card" | "log" | "settings" | "masters">("card");
    return (
      <>
        <SideTabs panes={DESKTOP_PANES} selected={pane} onSelect={setPane} unread={unread} />
        <SidePanel pane="card" selected={pane}>card body</SidePanel>
        <SidePanel pane="log" selected={pane} keepMounted>log body</SidePanel>
        <SidePanel pane="settings" selected={pane}>settings body</SidePanel>
      </>
    );
  }

  it("renders Card, Log, Settings in that order with Card selected", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Card", "Log", "Settings"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(screen.getByRole("tablist", { name: "Duel panels" })).toBeInTheDocument();
    // Only the selected tab is in the tab order.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("links each tab to its panel and keeps the Log panel mounted while hidden", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel", { name: "Card" });
    expect(panel).toHaveTextContent("card body");
    expect(screen.queryByText("settings body")).toBeNull();
    // Hidden panels are out of the accessibility tree but the Log one stays in the DOM.
    expect(screen.getByText("log body").closest("[role=tabpanel]")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("tabpanel", { name: "Settings" })).toHaveTextContent("settings body");
    expect(screen.queryByText("card body")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Log" }));
    expect(screen.getByRole("tabpanel", { name: "Log" })).toHaveTextContent("log body");
  });

  it("moves with the arrow keys, Home and End", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Log" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a count on the Log tab only, and says it to screen readers", () => {
    const { rerender } = render(<Harness unread={0} />);
    expect(screen.queryByTestId("log-unread")).toBeNull();
    rerender(<Harness unread={3} />);
    const badge = screen.getByTestId("log-unread");
    expect(badge).toHaveTextContent("3");
    expect(badge.closest("button")).toHaveTextContent("Log");
    expect(screen.getByRole("tab", { name: "Log, 3 new events" })).toBeInTheDocument();
    expect(screen.getAllByTestId("log-unread")).toHaveLength(1);
    rerender(<Harness unread={1} />);
    expect(screen.getByRole("tab", { name: "Log, 1 new event" })).toBeInTheDocument();
  });

  it("has an empty state for the Card tab", () => {
    render(<CardTabEmpty />);
    expect(screen.getByText("Hover or click a card to see it here")).toBeInTheDocument();
  });
});

describe("DuelHistoryRail unread rows", () => {
  const baseProps = { mySeat: 0, playerName: (seat: number) => (seat === 0 ? "You" : "Rival"), onInspectCard: vi.fn(), reducedMotion: true };
  const lastCount = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

  function rail(events: DuelEvent[], active: boolean, onUnread: (count: number) => void) {
    return <DuelHistoryRail {...baseProps} events={events} engine={engineView(events)} active={active} onUnread={onUnread} />;
  }

  it("does not count rows that were already there when the rail mounted", () => {
    const onUnread = vi.fn();
    render(rail([summon(1), summon(2)], false, onUnread));
    expect(lastCount(onUnread)).toBe(0);
  });

  it("counts rows that arrive while hidden and clears them when shown", () => {
    const onUnread = vi.fn();
    const { rerender } = render(rail([summon(1)], false, onUnread));
    rerender(rail([summon(1), summon(2)], false, onUnread));
    expect(lastCount(onUnread)).toBe(1);
    rerender(rail([summon(1), summon(2), summon(3)], false, onUnread));
    expect(lastCount(onUnread)).toBe(2);
    rerender(rail([summon(1), summon(2), summon(3)], true, onUnread));
    expect(lastCount(onUnread)).toBe(0);
    // In view: new rows are read at once.
    rerender(rail([summon(1), summon(2), summon(3), summon(4)], true, onUnread));
    expect(lastCount(onUnread)).toBe(0);
    // Hidden again: counting starts from the newest row seen.
    rerender(rail([summon(1), summon(2), summon(3), summon(4), summon(5)], false, onUnread));
    expect(lastCount(onUnread)).toBe(1);
  });
});

describe("DuelRoomView panes (wide: the HUD flyout)", () => {
  function setup(events: DuelEvent[] = [summon(1, "Kaiba")]) {
    swr.data = makeRoom(events);
    const view = render(<DuelRoomView slug="abc" windowed />);
    const flyout = () => screen.getByTestId("hud-flyout");
    const again = (next: DuelEvent[]) => {
      swr.data = makeRoom(next);
      view.rerender(<DuelRoomView slug="abc" windowed />);
    };
    return { flyout, again };
  }

  it("has no side column, and the flyout is shut until a dock icon opens it", () => {
    const { flyout } = setup();
    expect(screen.queryByRole("complementary", { name: "Duel panels" })).toBeNull();
    expect(flyout()).toHaveAttribute("data-open", "false");
    expect(within(screen.getByTestId("hud-dock")).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Log", "Settings"]);
    // The history list is mounted but hidden, so it keeps its rows.
    const log = flyout().querySelector("#hud-panel-log");
    expect(log).toHaveAttribute("hidden");
    expect(log).toHaveAttribute("aria-labelledby", "hud-tab-log");
    expect(log).toHaveTextContent("Kaiba");
  });

  it("has no Options gear in the header", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Options" })).toBeNull();
  });

  it("shows the settings in the Settings flyout", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, soundEnabled: true, motion: "system", volume: 0.4 }));
    const { flyout } = setup();
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(flyout()).toHaveAttribute("data-open", "true");
    const panel = within(flyout()).getByRole("tabpanel", { name: "Settings" });
    expect(within(panel).getByRole("heading", { name: "Presentation" })).toBeInTheDocument();
    const sound = within(panel).getByRole("switch", { name: "Sound effects" }) as HTMLInputElement;
    expect(sound.checked).toBe(true);
    expect(within(panel).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "40%");
    expect(within(panel).getByLabelText("Motion")).toBeInTheDocument();
    expect(within(panel).getByRole("group", { name: "Screen shake" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Game settings" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Back to tables" })).toBeInTheDocument();
    // The settings still save as before.
    fireEvent.click(sound);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "{}").soundEnabled).toBe(false);
  });

  it("opens a card clicked in the log in the Card flyout, and the log keeps its rows", () => {
    const { flyout } = setup();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(screen.queryByLabelText("Pinned card")).toBeNull();
    fireEvent.click(within(flyout()).getByRole("button", { name: "Inspect Kaiba" }));
    expect(within(flyout()).getByRole("tab", { name: "Card" })).toHaveAttribute("aria-selected", "true");
    expect(within(flyout()).getByRole("tabpanel", { name: "Card" })).toHaveTextContent("Kaiba");
    fireEvent.click(within(flyout()).getByRole("tab", { name: "Log" }));
    expect(within(flyout()).getByRole("button", { name: "Inspect Kaiba" })).toBeInTheDocument();
  });

  it("badges the Log icon for rows that arrive while it is shut, and clears it on open", () => {
    const { again } = setup([summon(1, "Kaiba")]);
    expect(screen.queryByTestId("hud-badge-log")).toBeNull();
    act(() => again([summon(1, "Kaiba"), summon(2, "Joey")]));
    expect(screen.getByTestId("hud-badge-log")).toHaveTextContent("1");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(screen.queryByTestId("hud-badge-log")).toBeNull();
    // Reading the log: a new row does not badge.
    act(() => again([summon(1, "Kaiba"), summon(2, "Joey"), summon(3, "Mai")]));
    expect(screen.queryByTestId("hud-badge-log")).toBeNull();
    // Leaving the Log pane starts counting again.
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    act(() => again([summon(1, "Kaiba"), summon(2, "Joey"), summon(3, "Mai"), summon(4, "Tea")]));
    expect(screen.getByTestId("hud-badge-log")).toHaveTextContent("1");
  });
});

describe("DuelRoomView left column (narrow: the old tabs)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
  });

  it("keeps the phone layout and has no HUD", () => {
    swr.data = makeRoom([summon(1, "Kaiba")]);
    render(<DuelRoomView slug="abc" windowed />);
    expect(screen.queryByTestId("hud-dock")).toBeNull();
    expect(screen.queryByTestId("hud-top")).toBeNull();
  });
});
