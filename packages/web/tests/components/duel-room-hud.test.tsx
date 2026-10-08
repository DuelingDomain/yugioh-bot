// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelClock, DuelCommand, DuelEngineView, DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";
import { applyEdits, edit, link, newBoard } from "@/components/duel/fx-lab/board";
import { SOLID_CARDS as CARDS } from "@/components/duel/solid/fixtures/cards";
import { PREVIEW_HIDE_MS } from "@/components/duel/table/grid-preview";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const swr = vi.hoisted(() => ({ data: null as unknown }));
const sendDuelAction = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("swr", () => ({ default: () => ({ data: swr.data, error: undefined, isLoading: false, mutate: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/prompt-reveal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-reveal")>(), usePromptReveal: () => true,
}));
vi.mock("@/components/duel/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/api")>(), sendDuelAction,
}));
// The field is a stub with one hover target and two click targets, so a test can hover and pick a card the way the board does.
vi.mock("@/components/duel/field", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/duel/field")>();
  return {
    ...actual,
    DuelField: (props: {
      onHoverCard?: (card: DuelCard | null, anchor: HTMLElement | null) => void;
      onActivate: (keys: string[], card: DuelCard | null, anchor: HTMLElement) => void;
      onInspect: (target: { type: "pile"; title: string; cards: DuelCard[] }) => void;
      engine: DuelEngineView;
    }) => {
      const card = props.engine.seats[1].monsters.find((slot) => slot != null) ?? null;
      return (
        <div data-testid="field">
          <button type="button" data-testid="field-card"
            onMouseEnter={(event) => props.onHoverCard?.(card, event.currentTarget)}
            onMouseLeave={() => props.onHoverCard?.(null, null)}>card</button>
          {/* A second card, for the hover that switches the preview. */}
          <button type="button" data-testid="field-other" data-zones="1:4:3"
            onClick={(event) => {
              const other = props.engine.seats[1].monsters[3];
              if (other) props.onActivate([`${other.controller}:${other.location}:${other.sequence}`], other, event.currentTarget);
            }}
            onMouseEnter={(event) => props.onHoverCard?.(props.engine.seats[1].monsters[3], event.currentTarget)}
            onMouseLeave={() => props.onHoverCard?.(null, null)}>other</button>
          {/* The monster is the legal pick of a select prompt. */}
          <button type="button" data-testid="field-pick" data-zones="1:4:2"
            onClick={(event) => card && props.onActivate([`${card.controller}:${card.location}:${card.sequence}`], card, event.currentTarget)}>pick</button>
          {/* A board zone with no click handler (an empty zone of the rival), and a pile. */}
          <button type="button" data-testid="field-dead" data-zones="1:4:4">dead</button>
          <button type="button" data-testid="field-pile" onClick={() => props.onInspect({ type: "pile", title: "Graveyard", cards: [] })}>pile</button>
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

function makeRoom(opts: {
  domain?: boolean; chain?: boolean; prompt?: DuelPrompt; clock?: DuelClock; spectator?: boolean; second?: boolean;
  /** The rival's second monster is face-down. */
  hiddenSecond?: boolean;
  /** Battle Ox has a counter and Xyz materials. */
  extras?: boolean;
  /** Battle Ox has this ATK. */
  atk?: number;
  /** No monster on the board. */
  empty?: boolean;
  revision?: number;
} = {}): DuelRoom {
  let board = newBoard();
  const edits = opts.empty ? [] : [edit.monster(1, 2, CARDS.battleOx)];
  if (opts.second) edits.push(edit.monster(1, 3, CARDS.beaver));
  if (opts.hiddenSecond) edits.push(edit.hiddenMonster(1, 3));
  if (opts.domain) {
    edits.push(edit.deckMaster(0, CARDS.darkMagician, { inZone: true, returns: 0, nextCost: 0 }));
    edits.push(edit.deckMaster(1, CARDS.blueEyes, { inZone: true, returns: 1, nextCost: 500 }));
  }
  board = applyEdits(board, edits);
  const ox = board.seats[1].monsters[2];
  if (ox && (opts.extras || opts.atk != null)) {
    board.seats[1].monsters[2] = {
      ...ox,
      ...(opts.atk != null ? { attack: opts.atk } : null),
      ...(opts.extras ? { counters: [{ type: 4, count: 2 }], materials: [{ ...ox, code: 111, name: "Material A" }, { ...ox, code: null, name: undefined }] } : null),
    } as DuelCard;
  }
  if (opts.chain) board = { ...board, chain: [link(1, 1, CARDS.bookOfMoon)] } as typeof board;
  const engine = {
    revision: opts.revision ?? 2, turn: 1, turnSeat: 0, phase: "main1", seats: board.seats, prioritySeat: null, prompt: opts.prompt ?? null,
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
    role: opts.spectator ? "spectator" : "player", mySeat: opts.spectator ? null : 0, myDeck: null, clock: opts.clock ?? null, metadataOnly: false, engine,
  } as unknown as DuelRoom;
}

function mount(opts: Parameters<typeof makeRoom>[0] = {}, props: Partial<React.ComponentProps<typeof DuelRoomView>> = {}) {
  swr.data = makeRoom(opts);
  return render(<DuelRoomView slug="abc" windowed {...props} />);
}

const info = (code: number, name: string) => ({
  code, name, description: `Printed text of ${name}.`, type: 1, attack: 1700, defense: 1000, level: 4, attribute: 1, race: "Warrior",
});
/** An optional chain response: its bar shows first (Yes / No), its cards after Yes. Esc says no. */
const chainPrompt: DuelPrompt = {
  id: "p1", seat: 0, kind: "choice", title: "Select a chain link or pass", cancelable: true,
  context: { type: "chain", forced: false },
  options: [
    { id: "card:0", label: "True Light", card: info(1, "True Light") },
    { id: "card:1", label: "Spirit Dragon", card: info(2, "Blue-Eyes Spirit Dragon") },
  ],
};
/** A one-card pick on the rival's monster (field zone 1:4:2, see the stub field). */
const pickPrompt: DuelPrompt = {
  id: "p2", seat: 0, kind: "cards", title: "Select 1 monster", min: 1, max: 1, cancelable: true,
  options: [{ id: "target", label: "Battle Ox", card: info(3, "Battle Ox"), controller: 1, location: 4, sequence: 2 }],
};
/** Two moves for the card on the rival's monster zone (field zone 1:4:2): its click opens the card action menu. */
const menuPrompt: DuelPrompt = {
  id: "p3", seat: 0, kind: "choice", title: "Select an action", cancelable: false,
  context: { type: "action", phase: "main" },
  options: [
    { id: "activate:0", label: "Activate Battle Ox", card: info(3, "Battle Ox"), controller: 1, location: 4, sequence: 2 },
    { id: "pos:0", label: "Change Battle Ox to Defense", card: info(3, "Battle Ox"), controller: 1, location: 4, sequence: 2 },
  ],
};
const sent = () => sendDuelAction.mock.calls.map((call) => (call as unknown as [string, DuelCommand])[1]);

const flyout = () => screen.getByTestId("hud-flyout");
const isOpen = () => flyout().getAttribute("data-open") === "true";

beforeEach(() => {
  sendDuelAction.mockClear();
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
    expect(container.querySelector("[data-hud='room']")).not.toBeNull();
    expect(screen.getByTestId("hud-top").tagName).toBe("HEADER");
    // No full-width bottom bar: the turn controls sit in one compact corner cluster.
    expect(screen.queryByTestId("hud-bottom")).toBeNull();
    const corner = screen.getByTestId("hud-corner");
    expect(corner.querySelector("nav[data-compact='true']")).not.toBeNull();
    // room.module.css finds the corner by this attribute (its class is hashed in another module) to turn clicks
    // back on for an open prompt dock there.
    expect(corner.hasAttribute("data-hud-corner")).toBe(true);
    expect(screen.queryByRole("complementary", { name: "Duel panels" })).toBeNull();
    for (const id of ["log", "settings"]) expect(screen.getByTestId(`hud-dock-${id}`)).toBeTruthy();
    expect(screen.queryByTestId("hud-dock-chain")).toBeNull();
    expect(screen.queryByTestId("hud-dock-history")).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("keeps Report bug and the sound toggle in the top pill, and Surrender in the Settings pane", () => {
    mount();
    const top = within(screen.getByTestId("hud-top"));
    expect(top.getByRole("button", { name: "Report bug" })).toBeTruthy();
    expect(top.getByRole("button", { name: /Sound effects/ })).toBeTruthy();
    expect(top.getByRole("link", { name: "Dueling Domain" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(within(flyout()).getByRole("button", { name: "Surrender" })).toBeTruthy();
  });

  it("keeps the old bars and columns on a narrow screen, in the 3D mode, and the HUD for a spectator", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const narrow = mount();
    expect(narrow.container.querySelector("[data-hud]")).toBeNull();
    expect(screen.queryByTestId("hud-dock")).toBeNull();
    cleanup();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const solid = mount({}, { viewOverride: "3d" });
    expect(solid.container.querySelector("[data-hud]")).toBeNull();
    expect(screen.queryByTestId("hud-dock")).toBeNull();
    cleanup();
    const watching = mount({ spectator: true, domain: true }, { spectate: true });
    expect(watching.container.querySelector("[data-hud='room']")).not.toBeNull();
    expect(screen.getByTestId("hud-dock")).toBeTruthy();
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
    expect(screen.queryByTestId("hud-dock-chain")).toBeNull();
    expect(within(flyout()).queryByTestId("hud-tab-chain")).toBeNull();
    expect(within(screen.getByTestId("chain-tower")).queryByRole("button", { name: /Chain/ })).toBeNull();
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

describe("the pinned card peek of the 1v1 room", () => {
  const peeks = () => screen.queryAllByTestId("hover-preview");
  const peek = () => screen.getByTestId("hover-preview");
  const pin = () => {
    fireEvent.mouseEnter(screen.getByTestId("field-card"));
    fireEvent.click(screen.getByTestId("field-pick"));
  };

  it("a click pins the peek: the wide panel opens, and the Card flyout and a second preview do not", () => {
    mount({ second: true });
    pin();
    expect(peeks()).toHaveLength(1);
    expect(peek().getAttribute("data-pinned")).toBe("true");
    expect(peek().getAttribute("data-open")).toBe("true");
    expect(peek()).toHaveTextContent("Battle Ox");
    expect(isOpen()).toBe(false);
    expect(screen.queryByRole("tab", { name: "Card", selected: true })).toBeNull();
    expect(within(peek()).getByRole("button", { name: "Close Battle Ox preview" })).toBeTruthy();
  });

  it("stays when the pointer leaves, and a hover on another card does not swap it or add a panel", () => {
    vi.useFakeTimers();
    mount({ second: true });
    pin();
    fireEvent.mouseLeave(screen.getByTestId("field-card"));
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 4); });
    expect(peek().getAttribute("data-open")).toBe("true");
    fireEvent.mouseEnter(screen.getByTestId("field-other"));
    expect(peeks()).toHaveLength(1);
    expect(peek()).toHaveTextContent("Battle Ox");
    expect(peek()).not.toHaveTextContent("Beaver Warrior");
    expect(peek().getAttribute("data-pinned")).toBe("true");
    expect(isOpen()).toBe(false);
  });

  it("closes with the X button", () => {
    vi.useFakeTimers();
    mount();
    pin();
    fireEvent.click(screen.getByTestId("hover-preview-close"));
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("closes with Esc, and that Esc does not answer the prompt; the next Esc does", () => {
    vi.useFakeTimers();
    mount({ prompt: chainPrompt });
    pin();
    expect(peek().getAttribute("data-pinned")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
    expect(sent()).toEqual([]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sent()).toHaveLength(1);
  });

  it("closes with a press outside, but not with a press inside the panel", () => {
    vi.useFakeTimers();
    mount();
    pin();
    fireEvent.pointerDown(within(peek()).getByRole("heading"));
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 2); });
    expect(peek().getAttribute("data-open")).toBe("true");
    fireEvent.pointerDown(document.body);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("a click on another card pins that card, and the press on it does not close the panel first", () => {
    vi.useFakeTimers();
    mount({ second: true });
    pin();
    const other = screen.getByTestId("field-other");
    // The press lands on a board zone (the stub carries the zone marker, as the real field does).
    fireEvent.pointerDown(other);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 2); });
    expect(peek().getAttribute("data-open")).toBe("true");
    fireEvent.click(other);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 2); });
    expect(peeks()).toHaveLength(1);
    expect(peek()).toHaveTextContent("Beaver Warrior");
    expect(peek().getAttribute("data-pinned")).toBe("true");
    expect(peek().getAttribute("data-open")).toBe("true");
    expect(isOpen()).toBe(false);
  });

  it("a press on a zone with no click handler lets the pin go after its click", () => {
    vi.useFakeTimers();
    mount();
    pin();
    const dead = screen.getByTestId("field-dead");
    fireEvent.pointerDown(dead);
    expect(peek().getAttribute("data-open")).toBe("true");
    fireEvent.click(dead);
    // The pin goes in a timer after the click; the panel then hides after its own delay.
    act(() => { vi.advanceTimersByTime(1); });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("a click on a face-down card opens the Card flyout and pins nothing", () => {
    mount({ hiddenSecond: true });
    fireEvent.click(screen.getByTestId("field-other"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-pane")).toBe("card");
    expect(peeks().filter((node) => node.getAttribute("data-pinned") === "true")).toHaveLength(0);
  });

  it("a pile lets the pin go, and it does not come back when the pile closes", () => {
    vi.useFakeTimers();
    mount();
    pin();
    fireEvent.click(screen.getByTestId("field-pile"));
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("shows the same extra lines as the Card flyout: counters and materials", () => {
    mount({ extras: true });
    pin();
    const lines = within(screen.getByTestId("hover-preview-extras")).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["Counter 4: 2", "Materials: Material A, face-down"]);
  });

  it("shows no extras list for a card with no extra lines", () => {
    mount();
    pin();
    expect(screen.queryByTestId("hover-preview-extras")).toBeNull();
  });

  it("is a labelled aside, not a dialog, and the X button is named after the card", () => {
    mount();
    pin();
    expect(screen.getByRole("complementary", { name: "Pinned card" })).toBe(peek());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(peek()).getByRole("button", { name: "Close Battle Ox preview" })).toBeTruthy();
  });

  it("the X button by keyboard returns focus to the card; by mouse it does not (the hover peek would come back)", () => {
    vi.useFakeTimers();
    mount();
    pin();
    const card = screen.getByTestId("field-pick");
    fireEvent.click(screen.getByTestId("hover-preview-close"), { detail: 1 });
    expect(document.activeElement).not.toBe(card);
    pin();
    fireEvent.click(screen.getByTestId("hover-preview-close"), { detail: 0 });
    expect(document.activeElement).toBe(card);
  });

  it("a press on a prompt button lets the pin go, and the button still works", () => {
    vi.useFakeTimers();
    mount({ prompt: chainPrompt });
    pin();
    const yes = screen.getByRole("button", { name: "Yes" });
    fireEvent.pointerDown(yes);
    fireEvent.click(yes);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    // The panel now shows the card of the first response row (focus), not the pin.
    expect(peek().getAttribute("data-pinned")).toBeNull();
    expect(peek()).not.toHaveTextContent("Battle Ox");
    expect(screen.getAllByRole("button", { name: /^\d\. / })).toHaveLength(2);
  });

  it("the card of a hovered prompt row shows over the pin, and the pin returns when the pointer leaves the row", () => {
    mount({ prompt: chainPrompt });
    pin();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const rows = screen.getAllByRole("button", { name: /^\d\. / });
    fireEvent.mouseEnter(rows[1]);
    expect(peeks()).toHaveLength(1);
    expect(peek()).toHaveTextContent("Blue-Eyes Spirit Dragon");
    expect(peek().getAttribute("data-pinned")).toBeNull();
    fireEvent.mouseOut(rows[1], { relatedTarget: document.body });
    expect(peek()).toHaveTextContent("Battle Ox");
    expect(peek().getAttribute("data-pinned")).toBe("true");
  });

  it("a new prompt for this seat lets the pin go: it must not cover the cards that the prompt asks for", () => {
    vi.useFakeTimers();
    const view = mount();
    pin();
    expect(peek().getAttribute("data-pinned")).toBe("true");
    swr.data = makeRoom({ prompt: pickPrompt });
    view.rerender(<DuelRoomView slug="abc" windowed />);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("takes the fresh copy of the card at each revision, and goes when the card is gone", () => {
    vi.useFakeTimers();
    const view = mount();
    pin();
    expect(peek()).toHaveTextContent("1700 / 1000");
    swr.data = makeRoom({ atk: 2400, revision: 3 });
    view.rerender(<DuelRoomView slug="abc" windowed />);
    expect(peek()).toHaveTextContent("2400 / 1000");
    expect(peek().getAttribute("data-pinned")).toBe("true");
    swr.data = makeRoom({ empty: true, revision: 4 });
    view.rerender(<DuelRoomView slug="abc" windowed />);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("goes when the HUD goes (a narrow window), and does not come back when the window is wide again", () => {
    let narrow = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: narrow && query.includes("max-width"), media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    mount();
    pin();
    expect(peek().getAttribute("data-pinned")).toBe("true");
    act(() => { narrow = true; listeners.forEach((fn) => fn()); });
    expect(peeks()).toHaveLength(0);
    act(() => { narrow = false; listeners.forEach((fn) => fn()); });
    expect(peeks().filter((node) => node.getAttribute("data-pinned") === "true")).toHaveLength(0);
  });

  describe("placement", () => {
    type Box = { left: number; right: number; top: number; bottom: number };
    const spies: Array<{ mockRestore: () => void }> = [];
    const LAYER_H = 720;
    const PANEL_H = 300;
    /**
     * jsdom has no layout: the clicked card gets `box`, and the panel gets the size and the place that its CSS gives it at 1280 x 720
     * (`--pv-w` wide, 300 px tall, standing on `--pv-bottom` from the layer bottom, at the left edge 72 or the right edge 16).
     */
    function layout(box: Box, fits: (panel: HTMLElement) => boolean = () => true) {
      const rect = (b: Box) => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => ({}) });
      const isPanel = (node: HTMLElement) => node.getAttribute("data-testid") === "hover-preview";
      const widthOf = (node: HTMLElement) => parseInt(node.style.getPropertyValue("--pv-w") || "284", 10);
      spies.push(
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
          if (this === document.body) return rect({ left: 0, right: 1280, top: 0, bottom: LAYER_H }) as DOMRect;
          return rect(this.getAttribute("data-testid") === "field-pick" ? box : { left: 0, right: 0, top: 0, bottom: 0 }) as DOMRect;
        }),
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return isPanel(this) ? widthOf(this) : 0; }),
        // The effect text is 200 px tall when it fits, and 100 px more when `fits` says the place is too small for it.
        vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.tagName === "P" ? 200 : 0; }),
        vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
          const panel = this.closest<HTMLElement>('[data-testid="hover-preview"]');
          return this.tagName === "P" ? 200 + (panel && !fits(panel) ? 100 : 0) : 0;
        }),
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return isPanel(this) ? PANEL_H : 0; }),
        vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
          return isPanel(this) ? LAYER_H - (parseInt(this.style.getPropertyValue("--pv-bottom"), 10) || 8) - PANEL_H : 0;
        }),
        vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
          if (!isPanel(this)) return 0;
          return this.getAttribute("data-side") === "right" ? 1280 - 16 - widthOf(this) : 72;
        }),
      );
    }
    afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });
    const css = (name: string) => peek().style.getPropertyValue(name);

    /** A part of the page with a fixed box (jsdom has no layout). */
    function part(attrs: Record<string, string>, b: Box) {
      const node = document.createElement("div");
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
      node.getBoundingClientRect = () => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => ({}) }) as DOMRect;
      document.body.appendChild(node);
      return node;
    }
    const TOWER: Box = { left: 14, right: 162, top: 232, bottom: 348 };
    const hover = () => fireEvent.mouseEnter(screen.getByTestId("field-card"));

    it("stays on the left when the clicked card is away from it, standing on the bottom of the free band", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      mount();
      pin();
      expect(peek().getAttribute("data-side")).toBe("left");
      expect(peek().getAttribute("data-anchor")).toBe("bottom");
      expect(css("--pv-w")).toBe("220px");
      // The band runs from 50 (under the header pills) to 8 px above the layer end.
      expect(css("--pv-bottom")).toBe("8px");
      expect(css("--pv-max-h")).toBe("662px");
    });

    it("never goes to the right: a clicked card under the left panel gets the pin above or below it, still in the left column", () => {
      layout({ left: 100, right: 180, top: 400, bottom: 560 });
      // The tower cuts the column into a tall band (360-712) under it and a short one (50-220) above it.
      const tower = part({ "data-testid": "chain-tower" }, TOWER);
      try {
        mount();
        pin();
        expect(peek().getAttribute("data-pinned")).toBe("true");
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-right")).toBe("");
        // The pin of the tall band would cover the card: it takes the short band above the tower, which stays clear of it.
        expect(css("--pv-max-h")).toBe("170px");
        expect(css("--pv-bottom")).toBe("500px");
      } finally { tower.remove(); }
    });

    it("takes a tall band over the clicked card before a 100 px band that clips the panel (the pin then covers the card)", () => {
      layout({ left: 100, right: 180, top: 400, bottom: 560 });
      // The panel needs 300 px: a place under that clips it (jsdom has no layout, so the clip is computed from the band).
      const asideSize = (node: Element) => (node.tagName === "ASIDE" ? node as HTMLElement : null);
      spies.push(
        vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
          const aside = asideSize(this);
          if (aside) return Math.min(300, parseInt(aside.style.getPropertyValue("--pv-max-h") || "300", 10));
          return this.tagName === "P" ? 200 : 0;
        }),
        vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { return asideSize(this) ? 300 : 0; }),
      );
      // The tower leaves a 100 px band above it (50-150, clear of the card) and the tall band 360-712 under it, over the card.
      const tower = part({ "data-testid": "chain-tower" }, { left: 14, right: 162, top: 162, bottom: 348 });
      try {
        mount();
        pin();
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-max-h")).toBe("352px");
        expect(css("--pv-bottom")).toBe("8px");
      } finally { tower.remove(); }
    });

    it("never goes to the right: with a single band, a clicked card under the left panel does not move it", () => {
      layout({ left: 100, right: 180, top: 400, bottom: 560 });
      mount();
      pin();
      expect(peek().getAttribute("data-side")).toBe("left");
      expect(css("--pv-right")).toBe("");
      expect(css("--pv-bottom")).toBe("8px");
    });

    it("shows the art again when the panel moves from a short place to a tall one (a squeeze in a passing place does not hide it for good)", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      // The art is 50 px tall until the panel stands in a band of 300 px or more (jsdom has no layout: this stands for the flex shrink).
      const art = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
        if (this.tagName !== "IMG") return 0;
        const room = parseInt(this.closest<HTMLElement>('[data-testid="hover-preview"]')!.style.getPropertyValue("--pv-max-h") || "0", 10);
        return room >= 300 ? 160 : 50;
      });
      spies.push(art);
      mount();
      hover();
      expect(css("--pv-max-h")).toBe("662px");
      expect(peek().getAttribute("data-squeezed")).toBeNull();
    });

    it("lets a hover stand over a life-point plate, so the art keeps its height; a pin stays clear of the plate", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const zones = part({ "data-zones": "1:4:0" }, { left: 300, right: 1000, top: 100, bottom: 600 });
      const plate = part({ "data-holo": "1" }, { left: 150, right: 320, top: 500, bottom: 600 });
      try {
        mount();
        hover();
        // The plate is no part to keep clear of for a hover: the band runs the whole column (50 to 712).
        expect(css("--pv-max-h")).toBe("662px");
        expect(css("--pv-bottom")).toBe("8px");
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(peek().getAttribute("data-pinned")).toBe("true");
        expect(peek().getAttribute("data-side")).toBe("left");
        // The pin takes clicks, and a plate can be a target: it stands above it (500 - 12 = 488).
        expect(css("--pv-max-h")).toBe("438px");
        expect(css("--pv-bottom")).toBe("232px");
      } finally { zones.remove(); plate.remove(); }
    });

    it("is the same window for the hover and the pin: the same place and size, with no wide layout", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const tower = part({ "data-testid": "chain-tower" }, TOWER);
      try {
        mount();
        hover();
        const place = ["--pv-w", "--pv-bottom", "--pv-max-h"].map(css);
        const side = peek().getAttribute("data-side");
        expect(peek().getAttribute("data-pinned")).toBeNull();
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(peek().getAttribute("data-pinned")).toBe("true");
        expect(["--pv-w", "--pv-bottom", "--pv-max-h"].map(css)).toEqual(place);
        expect(peek().getAttribute("data-side")).toBe(side);
        for (const name of ["data-narrow", "data-stack", "data-art"]) expect(peek().getAttribute(name)).toBeNull();
      } finally { tower.remove(); }
    });

    it("stands below the chain tower, in the free band down to the bottom of the layer (hover and pin)", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const tower = part({ "data-testid": "chain-tower" }, TOWER);
      try {
        mount();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
        // 348 (the tower) + the 12 px gap = 360; the band runs on to 712.
        expect(css("--pv-max-h")).toBe("352px");
        expect(css("--pv-bottom")).toBe("8px");
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(css("--pv-max-h")).toBe("352px");
      } finally { tower.remove(); }
    });

    it("stays on the left, in the tallest band, when the chain tower and the chain panel cut the left column into short bands", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const tower = part({ "data-testid": "chain-tower" }, TOWER);
      const panel = part({ "data-chain-panel": "" }, { left: 164, right: 456, top: 446, bottom: 697 });
      try {
        mount();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
        // The bands: 50-220 above the tower, 360-434 between the two, and 709-712 under the panel. The tallest one wins.
        expect(css("--pv-max-h")).toBe("170px");
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-max-h")).toBe("170px");
      } finally { tower.remove(); panel.remove(); }
    });

    it("stops above the Tag team plate at the bottom left, and above a Deck Master plate", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const plate = part({ "data-team-plate": "" }, { left: 14, right: 200, top: 540, bottom: 700 });
      const master = part({ "data-testid": "hud-master" }, { left: 14, right: 200, top: 100, bottom: 160 });
      try {
        mount();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
        // The band between the master (160 + 12) and the plate (540 - 12): it ends 720 - 528 above the layer bottom.
        expect(css("--pv-bottom")).toBe("192px");
        expect(css("--pv-max-h")).toBe("356px");
      } finally { plate.remove(); master.remove(); }
    });

    it("is never narrower than the column minimum, with the board beside it: the same one on hover and pin", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      // The board starts at x 300: 300 - 12 (gap) - 72 (the left edge) = 216 px of room, under the 220 px minimum.
      const board = part({ "data-zones": "1:4:0" }, { left: 300, right: 940, top: 100, bottom: 500 });
      try {
        mount();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-w")).toBe("220px");
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-w")).toBe("220px");
      } finally { board.remove(); }
    });

    it("stands above a life-point plate in the left column instead of going to the right (an FFA grid)", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const zones = part({ "data-zones": "1:4:0" }, { left: 300, right: 1000, top: 100, bottom: 600 });
      const plate = part({ "data-holo": "1" }, { left: 150, right: 320, top: 500, bottom: 600 });
      try {
        mount();
        pin();
        // The plate (500) less the 12 px gap ends the band; the board is 8 px right of the column, so the panel keeps its minimum width.
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-w")).toBe("220px");
        expect(css("--pv-max-h")).toBe("438px");
        expect(css("--pv-bottom")).toBe("232px");
      } finally { zones.remove(); plate.remove(); }
    });

    /** The pinned card of the stub field has a printed text, so the panel has a text to fit. */
    function mountWithText() {
      const room = makeRoom();
      const seat = room.engine!.seats[1] as unknown as { monsters: Array<{ description?: string } | null> };
      seat.monsters[2] = { ...seat.monsters[2]!, description: "A long printed text." };
      swr.data = room;
      render(<DuelRoomView slug="abc" windowed />);
    }

    it("keeps the left edge for a long text (it scrolls there) instead of jumping to the other side", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 }, (panel) => panel.getAttribute("data-side") === "right");
      const tower = part({ "data-testid": "chain-tower" }, TOWER);
      try {
        mountWithText();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
      } finally { tower.remove(); }
    });

    it("keeps the hover band on a click, even when the taller pin no longer fits it", () => {
      // Two tall bands on the left (50-318 and 392-712): the hover stands in the first. The text of the pin does not fit that one.
      layout({ left: 900, right: 980, top: 300, bottom: 420 }, (panel) => !(panel.getAttribute("data-pinned") === "true" && css("--pv-max-h") === "268px"));
      const bar = part({ "data-testid": "chain-tower" }, { left: 14, right: 162, top: 330, bottom: 380 });
      try {
        mountWithText();
        hover();
        expect(css("--pv-max-h")).toBe("268px");
        fireEvent.click(screen.getByTestId("field-pick"));
        expect(peek().getAttribute("data-pinned")).toBe("true");
        expect(peek().getAttribute("data-side")).toBe("left");
        expect(css("--pv-max-h")).toBe("268px");
        expect(css("--pv-bottom")).toBe("402px");
      } finally { bar.remove(); }
    });


    it("stays on the left when a kept part covers the whole column (the least bad place, never the other side)", () => {
      layout({ left: 900, right: 980, top: 300, bottom: 420 });
      const master = part({ "data-testid": "hud-master" }, { left: 14, right: 400, top: 20, bottom: 712 });
      try {
        mount();
        hover();
        expect(peek().getAttribute("data-side")).toBe("left");
      } finally { master.remove(); }
    });



    it("keeps a floor under the card art in a tall band, so a long text scrolls instead of taking the art to 0", () => {
      const css = readFileSync(join(__dirname, "../../src/components/duel/table/grid-hud.module.css"), "utf8");
      const rule = css.match(/^\.previewArt\s*\{[^}]*\}/m);
      // 0 in a band under about 330 px, up to 180 px from 510 px on (--pv-max-h is the band height that grid-preview.tsx sets).
      expect(rule?.[0]).toMatch(/min-height:\s*clamp\(0px,\s*calc\(var\(--pv-max-h,\s*0px\)\s*-\s*330px\),\s*180px\)/);
    });

    it("takes the pointer in CSS, so a click on a pinned panel never reaches a card under it", () => {
      // jsdom ignores CSS: read the rule. (The Playwright check with a target prompt open lives in the manual run.)
      const css = readFileSync(join(__dirname, "../../src/components/duel/table/grid-hud.module.css"), "utf8");
      const rule = css.match(/\.preview\[data-pinned="true"\]\s*\{[^}]*\}/);
      expect(rule?.[0]).toMatch(/pointer-events:\s*auto/);
    });

    it("places the pinned panel again when a chain opens under it", () => {
      vi.useFakeTimers();
      let tower: HTMLElement | null = null;
      try {
        layout({ left: 900, right: 980, top: 300, bottom: 420 });
        mount();
        pin();
        expect(css("--pv-max-h")).toBe("662px");
        tower = part({ "data-testid": "chain-tower" }, TOWER);
        act(() => { vi.advanceTimersByTime(600); });
        expect(css("--pv-max-h")).toBe("352px");
      } finally { tower?.remove(); vi.useRealTimers(); }
    });

    it("places a hover panel again when a chain opens under it, as it does for a pinned one", () => {
      vi.useFakeTimers();
      let tower: HTMLElement | null = null;
      try {
        layout({ left: 900, right: 980, top: 300, bottom: 420 });
        mount();
        hover();
        expect(css("--pv-max-h")).toBe("662px");
        tower = part({ "data-testid": "chain-tower" }, TOWER);
        act(() => { vi.advanceTimersByTime(600); });
        expect(css("--pv-max-h")).toBe("352px");
      } finally { tower?.remove(); vi.useRealTimers(); }
    });
    it("checks a hover panel slowly while no chain is shown, and a pinned panel at full speed", () => {
      vi.useFakeTimers();
      let dock: HTMLElement | null = null;
      try {
        layout({ left: 900, right: 980, top: 300, bottom: 420 });
        mount();
        hover();
        expect(css("--pv-max-h")).toBe("662px");
        // Not a chain part: the hover check runs on every fourth beat only (150 ms each).
        dock = part({ "data-testid": "hud-other" }, TOWER);
        act(() => { vi.advanceTimersByTime(450); });
        expect(css("--pv-max-h")).toBe("662px");
        act(() => { vi.advanceTimersByTime(150); });
        expect(css("--pv-max-h")).toBe("352px");
        dock.remove();
        fireEvent.click(screen.getByTestId("field-pick"));
        act(() => { vi.advanceTimersByTime(600); });
        expect(css("--pv-max-h")).toBe("662px");
        dock = part({ "data-testid": "hud-other" }, TOWER);
        act(() => { vi.advanceTimersByTime(150); });
        expect(css("--pv-max-h")).toBe("352px");
      } finally { dock?.remove(); vi.useRealTimers(); }
    });

    it("places a hover panel again when the chain panel changes its size, with no wait for the poll", () => {
      vi.useFakeTimers();
      const watchers: Array<(entries: unknown[]) => void> = [];
      const globals = globalThis as { ResizeObserver?: unknown };
      globals.ResizeObserver = (class {
        constructor(cb: (entries: unknown[]) => void) { watchers.push(cb); }
        observe() {}
        disconnect() {}
        unobserve() {}
      });
      const box: Box = { left: 100, right: 320, top: 60, bottom: 200 };
      const panel = part({ "data-chain-panel": "true" }, box);
      try {
        layout({ left: 900, right: 980, top: 300, bottom: 420 });
        mount();
        hover();
        const before = css("--pv-max-h");
        const report = (width: number, height: number) => act(() => { watchers.forEach((cb) => cb([{ target: panel, contentRect: { width, height } }])); });
        // The first report of a node is its start size: nothing moves.
        report(220, 140);
        expect(css("--pv-max-h")).toBe(before);
        box.bottom = 420;
        report(220, 360);
        expect(css("--pv-max-h")).not.toBe(before);
      } finally { panel.remove(); delete globals.ResizeObserver; vi.useRealTimers(); }
    });
  });

  it("a dock icon swaps the pin for the flyout: only one of them shows, and the pin does not come back", () => {
    vi.useFakeTimers();
    mount();
    pin();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(true);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(peek().getAttribute("data-open")).toBe("false");
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    expect(isOpen()).toBe(false);
    expect(peek().getAttribute("data-open")).toBe("false");
  });

  it("a click that picks a target still picks it, and pins nothing", () => {
    mount({ prompt: pickPrompt });
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ promptId: "p2", answer: { selected: ["target"] } });
    expect(peeks().filter((node) => node.getAttribute("data-pinned") === "true")).toHaveLength(0);
    expect(isOpen()).toBe(false);
  });

  it("a click that opens the action menu still opens it, and the peek of the menu card is not pinned", () => {
    mount({ prompt: menuPrompt });
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(peeks()).toHaveLength(1);
    expect(peek().getAttribute("data-pinned")).toBeNull();
    expect(isOpen()).toBe(false);
  });

  it("a pinned card goes when the click on the card opens its action menu", () => {
    mount({ prompt: menuPrompt, second: true });
    fireEvent.click(screen.getByTestId("field-other"));
    expect(peek().getAttribute("data-pinned")).toBe("true");
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(peeks()).toHaveLength(1);
    expect(peek().getAttribute("data-pinned")).toBeNull();
    expect(peek()).toHaveTextContent("Battle Ox");
  });

  it("pins for a spectator too", () => {
    mount({ spectator: true }, { spectate: true });
    pin();
    expect(peek().getAttribute("data-pinned")).toBe("true");
    expect(isOpen()).toBe(false);
  });

  it("is not used on a narrow screen: no peek, the old phone panes stay", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    mount();
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(peeks()).toHaveLength(0);
    expect(screen.queryByTestId("hud-flyout")).toBeNull();
  });
});

describe("the hover preview while a card action menu is open", () => {
  const openMenu = () => {
    mount({ prompt: menuPrompt, second: true });
    fireEvent.mouseEnter(screen.getByTestId("field-card"));
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(screen.getByRole("menu")).toBeTruthy();
  };

  it("keeps the card of the menu in the panel, also after the pointer leaves the card for the menu", () => {
    vi.useFakeTimers();
    openMenu();
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Battle Ox");
    fireEvent.mouseLeave(screen.getByTestId("field-card"));
    fireEvent.mouseEnter(within(screen.getByRole("menu")).getAllByRole("menuitem")[0]);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Battle Ox");
    expect(isOpen()).toBe(false);
  });

  it("shows a tapped card with no hover at all (touch)", () => {
    mount({ prompt: menuPrompt });
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Battle Ox");
  });

  it("switches to another hovered card, and goes back to the menu's card when that hover ends", () => {
    openMenu();
    fireEvent.mouseLeave(screen.getByTestId("field-card"));
    fireEvent.mouseEnter(screen.getByTestId("field-other"));
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Beaver Warrior");
    fireEvent.mouseLeave(screen.getByTestId("field-other"));
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Battle Ox");
  });

  it("keeps the preview closed for a menu on a card with no code", () => {
    const room = makeRoom({ prompt: menuPrompt });
    const seat = room.engine!.seats[1] as unknown as { monsters: ({ code: number | null } | null)[] };
    seat.monsters[2] = { ...seat.monsters[2]!, code: null };
    swr.data = room;
    render(<DuelRoomView slug="abc" windowed />);
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByTestId("hover-preview")).toBeNull();
  });

  it("closes with the menu when nothing is hovered", () => {
    vi.useFakeTimers();
    openMenu();
    fireEvent.mouseLeave(screen.getByTestId("field-card"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS + 20); });
    expect(screen.getByTestId("hover-preview").getAttribute("data-open")).toBe("false");
  });
});

describe("the HUD with a prompt", () => {
  it("Esc closes an open flyout and does not answer the prompt", () => {
    mount({ prompt: chainPrompt });
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(sent()).toEqual([]);
  });

  it("Esc with no flyout open still declines the prompt", () => {
    mount({ prompt: chainPrompt });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sent()).toHaveLength(1);
  });

  it("a hover after a log click does not swap the open flyout for the Card flyout", () => {
    mount();
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.mouseEnter(screen.getByTestId("field-card"));
    expect(isOpen()).toBe(true);
    expect(flyout().getAttribute("data-pane")).toBe("log");
  });

  it("shows the card of a hovered prompt row in the hover preview, not in the Card flyout", () => {
    mount({ prompt: chainPrompt });
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const rows = screen.getAllByRole("button", { name: /^\d\. / });
    fireEvent.mouseEnter(rows[1]);
    expect(screen.getByTestId("hover-preview")).toHaveTextContent("Blue-Eyes Spirit Dragon");
    expect(isOpen()).toBe(false);
  });

  it("a board pick of a select prompt sends the pick and does not open the Card flyout", () => {
    mount({ prompt: pickPrompt });
    fireEvent.click(screen.getByTestId("field-pick"));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ promptId: "p2", answer: { selected: ["target"] } });
    expect(isOpen()).toBe(false);
  });

  it("with the Log open, N still answers and Esc only closes the flyout", () => {
    mount({ prompt: chainPrompt });
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(sent()).toEqual([]);
    fireEvent.click(screen.getByTestId("hud-dock-log"));
    fireEvent.keyDown(window, { key: "n" });
    expect(isOpen()).toBe(true);
    expect(sent()).toHaveLength(1);
  });

  it("Surrender in the Settings flyout closes the flyout and opens the confirm", () => {
    mount();
    fireEvent.click(screen.getByTestId("hud-dock-settings"));
    fireEvent.click(within(flyout()).getByRole("button", { name: "Surrender" }));
    expect(isOpen()).toBe(false);
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull();
  });
});

describe("the 1v1 clocks and the Deck Master plate", () => {
  it("shows both clocks with a short name each", () => {
    const clock: DuelClock = { turn: 1, remainingMs: [300_000, 240_000], activeSeat: null, startedAt: null, serverNow: Date.now() };
    mount({ clock });
    const timer = within(screen.getByRole("timer", { name: "Decision clocks" }));
    expect(timer.getByText("5:00")).toBeTruthy();
    expect(timer.getByText("4:00")).toBeTruthy();
    expect(timer.getAllByText(/\S/, { selector: "small" })).toHaveLength(2);
  });

  it("shows Inspect on both plates of a spectator, with the short title", () => {
    mount({ spectator: true, domain: true }, { spectate: true });
    expect(screen.getByTestId("hud-master-inspect")).toBeTruthy();
    expect(screen.getByTestId("hud-other-inspect")).toBeTruthy();
    expect(screen.getByTestId("hud-master")).toHaveTextContent("Deck Master");
    expect(screen.getByTestId("hud-other")).toHaveTextContent("Deck Master");
  });

  it("titles your own plate Your Master and the rival's plate Deck Master", () => {
    mount({ domain: true });
    expect(screen.getByTestId("hud-master")).toHaveTextContent("Your Master");
    expect(screen.getByTestId("hud-other")).toHaveTextContent("Deck Master");
  });

  it("picks a Deck Master that a prompt asks for from its plate, through the room pick path", () => {
    const master: DuelPrompt = {
      id: "p4", seat: 0, kind: "cards", title: "Select 1 monster", min: 1, max: 1, cancelable: true,
      options: [{ id: "dm", label: "Dark Magician", card: info(9, "Dark Magician"), controller: 0, location: 0x4000, sequence: 0 }],
    };
    mount({ domain: true, prompt: master });
    const token = screen.getByTestId("hud-master-token");
    expect(token.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(token);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ promptId: "p4", answer: { selected: ["dm"] } });
    expect(screen.queryByTestId("hud-master-flyout")).toBeNull();
  });
});

// jsdom applies no CSS, so these read the stylesheet.
describe("the 1v1 HUD corner in the stylesheet", () => {
  const css = readFileSync(join(__dirname, "../../src/components/duel/room.module.css"), "utf8");

  it("turns clicks back on for an open prompt dock in the corner, found by its data attribute", () => {
    // The corner column takes no clicks; a class selector for it would be hashed in room.module.css and never match.
    expect(css).toMatch(/\[data-hud-corner\] > \.promptDock\[data-mode="float"\],\s*[^{]*\[data-hud-corner\] > \.promptDock\[data-mode="flow"\] \{[^}]*pointer-events: auto;/);
    expect(css).not.toMatch(/\.corner \.promptDock/);
  });

  it("keeps the board left of the corner stack on narrow or nearly square screens, but never under 660px", () => {
    expect(css).toMatch(/--hud-right-need: calc\(var\(--hud-left\) \+ 364px \+ 105\.6dvh - 100vw\);/);
    expect(css).toMatch(/--hud-right-max: min\(calc\(var\(--hud-corner-w\) \+ 28px\), calc\(100vw - var\(--hud-left\) - 660px\)\);/);
    expect(css).toMatch(/padding: var\(--hud-top\) clamp\(14px, var\(--hud-right-need\), var\(--hud-right-max\)\)/);
  });
});
