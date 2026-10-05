// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelRoom } from "@yugidraft/shared/duels";
import { applyEdits, edit, link, newBoard } from "@/components/duel/fx-lab/board";
import { SOLID_CARDS as CARDS } from "@/components/duel/solid/fixtures/cards";
import { PREVIEW_HIDE_MS } from "@/components/duel/table/grid-preview";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const swr = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("swr", () => ({ default: () => ({ data: swr.data, error: undefined, isLoading: false, mutate: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
// The field is a stub with one hover target, so a test can hover a card the way the board does.
vi.mock("@/components/duel/field", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/field")>();
  return {
    ...actual,
    DuelField: (props: { onHoverCard?: (card: DuelCard | null, anchor: HTMLElement | null) => void; engine: DuelEngineView }) => {
      const card = props.engine.seats[1].monsters.find((slot) => slot != null) ?? null;
      return (
        <div data-testid="field">
          <button type="button" data-testid="field-card"
            onMouseEnter={(event) => props.onHoverCard?.(card, event.currentTarget)}
            onMouseLeave={() => props.onHoverCard?.(null, null)}>card</button>
        </div>
      );
    },
  };
});
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));

import { DuelRoomView } from "@/components/duel/room";

function makeRoom(opts: { domain?: boolean; chain?: boolean } = {}): DuelRoom {
  let board = newBoard();
  const edits = [edit.monster(1, 2, CARDS.battleOx)];
  if (opts.domain) {
    edits.push(edit.deckMaster(0, CARDS.darkMagician, { inZone: true, returns: 0, nextCost: 0 }));
    edits.push(edit.deckMaster(1, CARDS.blueEyes, { inZone: true, returns: 1, nextCost: 500 }));
  }
  board = applyEdits(board, edits);
  if (opts.chain) board = { ...board, chain: [link(1, 1, CARDS.bookOfMoon)] } as typeof board;
  const engine = {
    revision: 2, turn: 1, turnSeat: 0, phase: "main1", seats: board.seats, prioritySeat: null, prompt: null,
    chain: board.chain, events: [], log: [], result: null,
  } as unknown as DuelEngineView;
  return {
    session: {
      id: 1, slug: "abc", name: "Table", guildId: "g", organizerPlayerId: 1, mode: opts.domain ? "domain" : "normal", masterRule: 5,
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
    role: "player", mySeat: 0, myDeck: null, clock: null, metadataOnly: false, engine,
  } as unknown as DuelRoom;
}

function mount(opts: Parameters<typeof makeRoom>[0] = {}) {
  swr.data = makeRoom(opts);
  return render(<DuelRoomView slug="abc" windowed />);
}

const flyout = () => screen.getByTestId("hud-flyout");
const isOpen = () => flyout().getAttribute("data-open") === "true";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the floating HUD of the 1v1 room", () => {
  it("swaps the bars and the side columns for the pills and the dock", () => {
    const { container } = mount();
    expect(container.querySelector("[data-hud='true']")).not.toBeNull();
    expect(screen.getByTestId("hud-top").tagName).toBe("HEADER");
    expect(screen.getByTestId("hud-bottom")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Duel panels" })).toBeNull();
    for (const id of ["log", "settings", "chain"]) expect(screen.getByTestId(`hud-dock-${id}`)).toBeTruthy();
    expect(screen.queryByTestId("hud-dock-history")).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("keeps Report bug, surrender and the sound toggle in the top pill", () => {
    mount();
    const top = within(screen.getByTestId("hud-top"));
    expect(top.getByRole("button", { name: "Report bug" })).toBeTruthy();
    expect(top.getByRole("button", { name: /Sound effects/ })).toBeTruthy();
    expect(top.getByRole("link", { name: "Duelists Kingdom" })).toBeTruthy();
  });

  it("opens a pane from its icon and closes it with the same icon", () => {
    mount();
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-pane")).toBe("settings");
    expect(screen.getByTestId("hud-dock-settings").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(flyout().getAttribute("data-pane")).toBe("log");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(false);
  });

  it("closes with Esc, the close button and a click outside, but not with a click inside", () => {
    mount();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(within(flyout()).getByTestId("hud-tab-settings"));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.click(screen.getByTestId("hud-close"));
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.pointerDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it("shows the chain tower while a chain is live, with the flyout open or shut", () => {
    mount({ chain: true });
    expect(screen.getByTestId("chain-tower").getAttribute("data-links")).toBe("1");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(screen.getByTestId("chain-tower")).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-dock-chain"));
    expect(within(flyout()).getAllByTestId("chain-row")).toHaveLength(1);
  });

  it("has no chain tower when no chain is open", () => {
    mount();
    expect(screen.queryByTestId("chain-tower")).toBeNull();
  });
});

describe("the Deck Master plates of the 1v1 room", () => {
  it("shows no plate outside the Domain format", () => {
    mount();
    expect(screen.queryByTestId("hud-master")).toBeNull();
    expect(screen.queryByTestId("hud-other")).toBeNull();
  });

  it("shows your master on the left and the rival's on the right, each with its real card", () => {
    mount({ domain: true });
    expect(screen.getByTestId("hud-master-token").getAttribute("aria-label")).toContain("Dark Magician");
    expect(screen.getByTestId("hud-other-token").getAttribute("aria-label")).toContain("Blue-Eyes");
    expect(screen.getByTestId("hud-other").getAttribute("data-slot")).toBe("other");
    // The rival's plate never offers an action.
    expect(screen.queryAllByTestId("hud-other-action")).toHaveLength(0);
  });

  it("opens the details in a flyout and closes them with the token, Esc or a click outside", () => {
    mount({ domain: true });
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(screen.getByTestId("hud-master-flyout")).toBeTruthy();
    expect(screen.getByTestId("hud-master-returns").textContent).toBe("0");
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();

    fireEvent.click(screen.getByTestId("hud-other-token"));
    expect(screen.getByTestId("hud-other-flyout")).toBeTruthy();
    expect(screen.getByTestId("hud-other-returns").textContent).toBe("1");
    expect(screen.getByTestId("hud-other-cost").textContent).toBe("500 LP");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("hud-other-flyout")).toBeNull();

    fireEvent.click(screen.getByTestId("hud-master-inspect"));
    expect(screen.getByTestId("hud-master-flyout")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();
  });
});

describe("the hover preview of the 1v1 room", () => {
  it("slides in for a hovered card, hides after a short delay, and never opens the Card flyout", () => {
    vi.useFakeTimers();
    mount();
    expect(screen.queryByTestId("hover-preview")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("field-card"));
    const preview = screen.getByTestId("hover-preview");
    expect(preview.getAttribute("data-open")).toBe("true");
    expect(preview).toHaveTextContent("Battle Ox");
    expect(preview).toHaveTextContent("Practice Bot");
    expect(isOpen()).toBe(false);
    fireEvent.mouseLeave(screen.getByTestId("field-card"));
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });

  it("stays out of the way while a flyout is open", () => {
    mount();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.mouseEnter(screen.getByTestId("field-card"));
    expect(screen.queryByTestId("hover-preview")).toBeNull();
  });
});
