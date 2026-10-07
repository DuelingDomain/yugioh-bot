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
      engine: DuelEngineView;
    }) => {
      const card = props.engine.seats[1].monsters.find((slot) => slot != null) ?? null;
      return (
        <div data-testid="field">
          <button type="button" data-testid="field-card"
            onMouseEnter={(event) => props.onHoverCard?.(card, event.currentTarget)}
            onMouseLeave={() => props.onHoverCard?.(null, null)}>card</button>
          {/* A second card, for the hover that switches the preview. */}
          <button type="button" data-testid="field-other"
            onClick={(event) => {
              const other = props.engine.seats[1].monsters[3];
              if (other) props.onActivate([`${other.controller}:${other.location}:${other.sequence}`], other, event.currentTarget);
            }}
            onMouseEnter={(event) => props.onHoverCard?.(props.engine.seats[1].monsters[3], event.currentTarget)}
            onMouseLeave={() => props.onHoverCard?.(null, null)}>other</button>
          {/* The monster is the legal pick of a select prompt. */}
          <button type="button" data-testid="field-pick"
            onClick={(event) => card && props.onActivate([`${card.controller}:${card.location}:${card.sequence}`], card, event.currentTarget)}>pick</button>
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

function makeRoom(opts: { domain?: boolean; chain?: boolean; prompt?: DuelPrompt; clock?: DuelClock; spectator?: boolean; second?: boolean } = {}): DuelRoom {
  let board = newBoard();
  const edits = [edit.monster(1, 2, CARDS.battleOx)];
  if (opts.second) edits.push(edit.monster(1, 3, CARDS.beaver));
  if (opts.domain) {
    edits.push(edit.deckMaster(0, CARDS.darkMagician, { inZone: true, returns: 0, nextCost: 0 }));
    edits.push(edit.deckMaster(1, CARDS.blueEyes, { inZone: true, returns: 1, nextCost: 500 }));
  }
  board = applyEdits(board, edits);
  if (opts.chain) board = { ...board, chain: [link(1, 1, CARDS.bookOfMoon)] } as typeof board;
  const engine = {
    revision: 2, turn: 1, turnSeat: 0, phase: "main1", seats: board.seats, prioritySeat: null, prompt: opts.prompt ?? null,
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
    expect(within(peek()).getByRole("button", { name: "Close card preview" })).toBeTruthy();
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
    // The press lands on a board zone; the stub has no zone wrapper, so the press goes through the zone marker only in the real field.
    const zone = document.createElement("div");
    zone.setAttribute("data-zones", "1:4:3");
    zone.appendChild(other.cloneNode());
    fireEvent.pointerDown(document.body.appendChild(zone).firstChild!);
    act(() => { vi.advanceTimersByTime(PREVIEW_HIDE_MS * 2); });
    expect(peek().getAttribute("data-open")).toBe("true");
    zone.remove();
    fireEvent.click(other);
    expect(peeks()).toHaveLength(1);
    expect(peek()).toHaveTextContent("Beaver Warrior");
    expect(peek().getAttribute("data-pinned")).toBe("true");
    expect(isOpen()).toBe(false);
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
    expect(css).toMatch(/--hud-right-need: calc\(520px \+ 105\.6dvh - 100vw\);/);
    expect(css).toMatch(/--hud-right-max: min\(calc\(var\(--hud-corner-w\) \+ 28px\), calc\(100vw - var\(--hud-left\) - 660px\)\);/);
    expect(css).toMatch(/padding: var\(--hud-top\) clamp\(14px, var\(--hud-right-need\), var\(--hud-right-max\)\)/);
  });
});
