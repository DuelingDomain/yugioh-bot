// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/api", () => ({ getDuelCards: vi.fn() }));

import { LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_REMOVED, TYPE_EFFECT, TYPE_MONSTER } from "@/components/duel/constants";
import { deriveChainState, type ChainLinkState } from "@/components/duel/chain-state";
import { chainMarkLabel, followChainZones, pileChainMarks, useLiveChainLinks } from "@/components/duel/pile-chain-marks";
import { PileViewer } from "@/components/duel/pile-viewer";

afterEach(cleanup);

const WISHES = 9001;
const MAIDEN = 9002;

function card(sequence: number, code: number, name: string, over: Partial<DuelCard> = {}): DuelCard {
  return {
    controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code, name, description: `Text of ${name}.`,
    type: TYPE_MONSTER | TYPE_EFFECT, attack: 0, defense: 0, level: 1, attribute: 16, race: "Spellcaster", ...over,
  };
}

function link(index: number, over: Partial<ChainLinkState> = {}): ChainLinkState {
  return {
    index, seat: 0, code: MAIDEN, name: "Maiden of White", card: null, text: null, cardType: null,
    zone: { controller: 0, location: LOCATION_GRAVE, sequence: 0 }, targets: [], status: "pending", negated: false, ...over,
  };
}

// Engine order: index 0 is the bottom. Two copies of Maiden of White: the chain link is the BOTTOM one.
const GY = [
  card(0, MAIDEN, "Maiden of White"),
  card(1, 9003, "Magician of Faith"),
  card(2, WISHES, "Wishes for Eyes of Blue"),
  card(3, MAIDEN, "Maiden of White"),
  card(4, 9005, "Roar of the Blue-Eyed Dragons"),
];

const show = (cards: DuelCard[], chainLinks?: readonly ChainLinkState[], over: Partial<React.ComponentProps<typeof PileViewer>> = {}) => (
  <PileViewer title="Your Graveyard" cards={cards} owner="you" open onClose={vi.fn()} onInspectCard={vi.fn()} reducedMotion chainLinks={chainLinks} {...over} />
);

// The badges are decorative (aria-hidden): the card button's own accessible name and the live line carry the meaning.
const badges = () => [...document.querySelectorAll<HTMLElement>("[data-chain-mark='thumb'] [data-chain-link]")];

describe("pile viewer chain marks", () => {
  it("marks no card when there is no chain", () => {
    render(show(GY));
    expect(badges()).toHaveLength(0);
    expect(screen.queryByTestId("pile-chain-line")).toBeNull();
  });

  it("marks the copy the link activated from, not the other card of the same name", () => {
    render(show(GY, [link(1)]));
    expect(badges()).toHaveLength(1);
    const list = screen.getByRole("list");
    const buttons = within(list).getAllByRole("button");
    // Newest first: Roar, Maiden (top copy), Wishes, Magician, Maiden (bottom copy).
    expect(buttons.map((button) => button.getAttribute("data-chain-link"))).toEqual([null, null, null, null, "1"]);
    expect(buttons[4]).toHaveAccessibleName(/^Maiden of White, 5 of 5, Chain link 1 activating/);
    expect(buttons[1]).toHaveAccessibleName(/^Maiden of White, 2 of 5$/);
    // The badge is hidden from the accessibility tree (the button name above says it), and no image role sits inside the button.
    expect(within(buttons[4]).queryByRole("img")).toBeNull();
    expect(badges()[0].closest("[aria-hidden='true']")).not.toBeNull();
    expect(badges()[0]).toHaveTextContent("1");
  });

  it("says Chain N and the phase in the detail of a selected chain card", () => {
    render(show(GY, [link(1, { status: "resolving" })]));
    // Opening starts on the chain card (focus and detail), so the line is already there; the region is polite.
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 1 · resolving");
    expect(screen.getByTestId("pile-chain-line")).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: /^Roar of the Blue-Eyed Dragons/ }));
    // The live region stays mounted, and is empty on a card that is not in the chain.
    expect(screen.getByTestId("pile-chain-line").textContent?.trim()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^Maiden of White, 5 of 5/ }));
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 1 · resolving");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Maiden of White");
  });

  it("shows the chain line on the top card when that is the chain card", () => {
    render(show(GY, [link(2, { code: 9005, zone: { controller: 0, location: LOCATION_GRAVE, sequence: 4 } })]));
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 2 · activating");
  });

  it("marks a banished card the same way", () => {
    const banished = [
      card(0, 7001, "Called by the Grave", { location: LOCATION_REMOVED }),
      card(1, MAIDEN, "Maiden of White", { location: LOCATION_REMOVED }),
      card(2, MAIDEN, "Maiden of White", { location: LOCATION_REMOVED }),
    ];
    render(show(banished, [link(3, { zone: { controller: 0, location: LOCATION_REMOVED, sequence: 1 } })], { title: "Your Banished" }));
    const buttons = within(screen.getByRole("list")).getAllByRole("button");
    // Newest first: sequence 2, 1, 0. Only sequence 1 is the chain card.
    expect(buttons.map((button) => button.getAttribute("data-chain-link"))).toEqual([null, "3", null]);
  });

  it("marks a face-down banished card by its zone, without a public code", () => {
    const banished = [card(0, 0, "", { location: LOCATION_REMOVED, code: undefined as unknown as number, name: undefined as unknown as string })];
    render(show(banished, [link(1, { code: null, zone: { controller: 0, location: LOCATION_REMOVED, sequence: 0 } })], { title: "Your Banished" }));
    expect(badges()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Face-down card, 1 of 1, Chain link 1 activating/ })).toBeTruthy();
  });

  it("marks the own Extra Deck", () => {
    const extra = [card(0, 8001, "Blue-Eyes Spirit Dragon", { location: LOCATION_EXTRA }), card(1, 8002, "Blue-Eyes Alternative", { location: LOCATION_EXTRA })];
    render(show(extra, [link(1, { code: 8002, zone: { controller: 0, location: LOCATION_EXTRA, sequence: 1 } })], { title: "Your Extra Deck" }));
    expect(screen.getByRole("button", { name: /^Blue-Eyes Alternative, 1 of 2, Chain link 1/ })).toBeTruthy();
  });

  it("ignores a link of another player's pile, another location, or a different card at that place", () => {
    const rival = { ...link(1), zone: { controller: 1, location: LOCATION_GRAVE, sequence: 0 } };
    const elsewhere = { ...link(2), zone: { controller: 0, location: LOCATION_REMOVED, sequence: 0 } };
    const stranger = { ...link(3), code: 424242 };
    render(show(GY, [rival, elsewhere, stranger]));
    expect(badges()).toHaveLength(0);
  });

  it("opens an opponent's pile with its marks, in the seat colour", () => {
    const opp = GY.map((entry) => ({ ...entry, controller: 1 }));
    render(show(opp, [link(1, { seat: 1, zone: { controller: 1, location: LOCATION_GRAVE, sequence: 0 } })], { owner: "opp", ownerTag: { name: "Kaiba", tone: { main: "#c33", ink: "#fff" } } }));
    expect(badges()).toHaveLength(1);
    expect(screen.getByTestId("pile-owner")).toHaveTextContent("Kaiba");
  });

  it("shows two links on one card, lowest link first in the detail", () => {
    render(show(GY, [link(1), link(3, { status: "resolving" })]));
    expect(badges().map((badge) => badge.textContent)).toEqual(["3", "1"]);
    expect(screen.getByRole("button", { name: /^Maiden of White, 5 of 5, Chain link 1 activating, Chain link 3 resolving/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Maiden of White, 5 of 5/ }));
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 1 · activating, Chain 3 · resolving");
  });

  it("shows a negated link as negated", () => {
    render(show(GY, [link(1, { negated: true, status: "resolving" })]));
    const badge = badges()[0];
    expect(badge.getAttribute("data-negated")).toBe("true");
    expect(screen.getByRole("button", { name: /Chain link 1 negated/ })).toBeTruthy();
  });

  it("updates while open: added on activation, renumbered, phase changes, removed when the chain ends", () => {
    const { rerender } = render(show(GY, []));
    expect(badges()).toHaveLength(0);
    rerender(show(GY, [link(1)]));
    expect(badges().map((badge) => badge.textContent)).toEqual(["1"]);
    rerender(show(GY, [link(2)]));
    expect(badges().map((badge) => badge.textContent)).toEqual(["2"]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Maiden of White, 5 of 5/ })[0]);
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 2 · activating");
    rerender(show(GY, [link(2, { status: "resolving" })]));
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 2 · resolving");
    rerender(show(GY, [link(2, { status: "resolved" })]));
    expect(badges()).toHaveLength(0);
    expect(screen.queryByTestId("pile-chain-line")).toBeNull();
    rerender(show(GY, []));
    expect(badges()).toHaveLength(0);
  });

  it("follows a card that was added on top of the pile while the viewer is open", () => {
    const { rerender } = render(show(GY, [link(1)]));
    rerender(show([...GY, card(5, 9006, "New card")], [link(1)]));
    const buttons = within(screen.getByRole("list")).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons[5].getAttribute("data-chain-link")).toBe("1");
    expect(buttons[5]).toHaveAccessibleName(/6 of 6, Chain link 1/);
  });
});

describe("pileChainMarks", () => {
  it("keys the marks by the card's place in the pile (engine order)", () => {
    const marks = pileChainMarks([link(1)], GY);
    expect([...marks.keys()]).toEqual([0]);
    expect(chainMarkLabel(marks.get(0)!)).toBe("Chain 1 · activating");
  });

  it("works from the real chain state: activation events and the snapshot", () => {
    const snapshot: DuelChainLink[] = [{ index: 1, seat: 0, code: MAIDEN, name: "Maiden of White", zone: { controller: 0, location: LOCATION_GRAVE, sequence: 0 } }];
    const pending = deriveChainState([], snapshot);
    expect([...pileChainMarks(pending.links, GY).keys()]).toEqual([0]);
    const events = [
      { id: 1, kind: "activate", seat: 0, chainIndex: 1, zone: { controller: 0, location: LOCATION_GRAVE, sequence: 0 } },
      { id: 2, kind: "chain-resolving", seat: 0, chainIndex: 1 },
    ] as unknown as DuelEvent[];
    const resolving = deriveChainState(events, snapshot);
    expect(pileChainMarks(resolving.links, GY).get(0)?.[0].phase).toBe("resolving");
    const ended = deriveChainState([...events, { id: 3, kind: "chain-end" } as unknown as DuelEvent], snapshot);
    expect(pileChainMarks(ended.links, GY).size).toBe(0);
  });
});


const gy = (...entries: Array<[number, string]>) => entries.map(([code, name], sequence) => card(sequence, code, name));
const at = (sequence: number) => ({ controller: 0, location: LOCATION_GRAVE, sequence });
const activate = (id: number, chainIndex: number, sequence: number) =>
  ({ id, kind: "activate", seat: 0, chainIndex, zone: at(sequence) }) as unknown as DuelEvent;
const moved = (id: number, from: ReturnType<typeof at>, zone: ReturnType<typeof at>) =>
  ({ id, kind: "move", seat: 0, from, zone, text: "moved" }) as unknown as DuelEvent;
const snapshotOf = (sequence: number): DuelChainLink[] => [{ index: 1, seat: 0, code: MAIDEN, name: "Maiden of White", zone: at(sequence) }];

describe("pile chain marks follow a renumbered pile", () => {
  // The GY at activation (engine order): Magician, Maiden (the activator), Maiden (a second copy), Wishes.
  const before = gy([9003, "Magician of Faith"], [MAIDEN, "Maiden of White"], [MAIDEN, "Maiden of White"], [WISHES, "Wishes for Eyes of Blue"]);
  // After the Magician is banished as a cost, everything above it slides down by one: Maiden (activator), Maiden (copy), Wishes.
  const after = before.slice(1).map((entry, sequence) => ({ ...entry, sequence }));

  function liveLinks(events: DuelEvent[], snapshot = snapshotOf(1)) {
    return followChainZones(deriveChainState(events, snapshot).links, events);
  }

  it("marks the copy that activated after a lower card left the pile (not the duplicate that slid into its old slot)", () => {
    const events = [activate(1, 1, 1), moved(2, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 0 })];
    const links = liveLinks(events);
    expect(links[0].zone).toEqual(at(0));
    // The exact match on the stale zone would pick the copy that slid into sequence 1: that is the bug this guards.
    expect([...pileChainMarks(deriveChainState(events, snapshotOf(1)).links, after).keys()]).toEqual([1]);
    expect([...pileChainMarks(links, after).keys()]).toEqual([0]);
    render(show(after, links));
    const buttons = within(screen.getByRole("list")).getAllByRole("button");
    // Newest first: Wishes, Maiden (copy), Maiden (activator).
    expect(buttons.map((button) => button.getAttribute("data-chain-link"))).toEqual([null, null, "1"]);
  });

  it("moves the mark up when a card is added below it", () => {
    const events = [activate(1, 1, 1), moved(2, { controller: 0, location: 0x01, sequence: 3 }, at(0))];
    expect(liveLinks(events)[0].zone).toEqual(at(2));
  });

  it("leaves the zone alone for moves above it, in another pile, or before the activation", () => {
    const events = [
      moved(1, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 0 }),
      activate(2, 1, 1),
      moved(3, at(3), { controller: 0, location: LOCATION_REMOVED, sequence: 1 }),
      moved(4, { controller: 1, location: LOCATION_GRAVE, sequence: 0 }, { controller: 1, location: LOCATION_REMOVED, sequence: 0 }),
    ];
    expect(liveLinks(events)[0].zone).toEqual(at(1));
  });

  it("follows the chain card itself into the banished pile (banish self as a cost)", () => {
    const events = [activate(1, 1, 1), moved(2, at(1), { controller: 0, location: LOCATION_REMOVED, sequence: 4 })];
    const links = liveLinks(events);
    expect(links[0].zone).toEqual({ controller: 0, location: LOCATION_REMOVED, sequence: 4 });
    expect(pileChainMarks(links, after).size).toBe(0);
    const banished = [...Array.from({ length: 4 }, (_, sequence) => card(sequence, 7000 + sequence, `Card ${sequence}`, { location: LOCATION_REMOVED })),
      card(4, MAIDEN, "Maiden of White", { location: LOCATION_REMOVED })];
    expect([...pileChainMarks(links, banished).keys()]).toEqual([4]);
  });

  it("applies several moves in event order, and ignores the order the window arrives in", () => {
    const events = [
      moved(3, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 1 }),
      activate(1, 1, 2),
      moved(2, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 0 }),
    ];
    // Activation at 2; the move at 2 (id 2) closes the gap to 1; the move at 3 (id 3) closes it to 0.
    expect(liveLinks(events, snapshotOf(2))[0].zone).toEqual(at(0));
  });

  it("keeps the exact match when the event window no longer holds the activation", () => {
    const events = [moved(5, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 0 })];
    const links = liveLinks(events, snapshotOf(1));
    expect(links[0].zone).toEqual(at(1));
    expect(followChainZones(links, [])).toBe(links);
  });

  it("updates in the open viewer when a lower card leaves mid-chain", () => {
    const first = [activate(1, 1, 1)];
    const { rerender } = render(show(before, liveLinks(first)));
    expect(screen.getByRole("button", { name: /^Maiden of White, 3 of 4, Chain link 1/ })).toBeTruthy();
    const second = [...first, moved(2, at(0), { controller: 0, location: LOCATION_REMOVED, sequence: 0 })];
    rerender(show(after, liveLinks(second)));
    expect(screen.getByRole("button", { name: /^Maiden of White, 3 of 3, Chain link 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Maiden of White, 2 of 3$/ })).toBeTruthy();
  });
});

describe("useLiveChainLinks", () => {
  const events = [activate(1, 1, 0)];
  it("follows the events while the duel runs and clears when the duel has ended", () => {
    const { result, rerender } = renderHook(({ ended }) => useLiveChainLinks(events, snapshotOf(0), ended), { initialProps: { ended: false } });
    expect(result.current.map((entry) => entry.index)).toEqual([1]);
    rerender({ ended: true });
    expect(result.current).toEqual([]);
  });

  it("marks nothing in the viewer once the duel ended", () => {
    const { rerender } = render(show(GY, [link(1)]));
    expect(badges()).toHaveLength(1);
    rerender(show(GY, []));
    expect(badges()).toHaveLength(0);
    expect(screen.queryByTestId("pile-chain-line")).toBeNull();
  });
});

describe("opening on the chain card", () => {
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let boxes: Array<{ match: (el: Element) => boolean; box: DOMRect }>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    boxes = [
      { match: (el) => el.tagName === "UL", box: rect(0, 300) },
      { match: (el) => el.hasAttribute("data-chain-link") && el.hasAttribute("data-pile-card"), box: rect(500, 600) },
    ];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return boxes.find((entry) => entry.match(this))?.box ?? rect(0, 0);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("scrolls the grid itself to the chain card, never the page, and focuses it with its detail", () => {
    render(show(GY, [link(1)]));
    const grid = screen.getByRole("list") as HTMLElement;
    expect(grid.scrollTop).toBe(312);
    expect(scrollIntoView).not.toHaveBeenCalled();
    const chain = screen.getByRole("button", { name: /Chain link 1 activating/ });
    expect(document.activeElement).toBe(chain);
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 1 · activating");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Maiden of White");
  });

  it("does not scroll when the chain card is already in view", () => {
    boxes[1].box = rect(40, 140);
    render(show(GY, [link(1)]));
    expect((screen.getByRole("list") as HTMLElement).scrollTop).toBe(0);
  });

  it("starts on the top card when no card of the pile is in the chain", () => {
    render(show(GY, []));
    expect((screen.getByRole("list") as HTMLElement).scrollTop).toBe(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Roar of the Blue-Eyed Dragons/ }));
  });

  it("never scrolls or moves focus while the player browses and a chain starts or changes", () => {
    const { rerender } = render(show(GY, []));
    const grid = screen.getByRole("list") as HTMLElement;
    const magician = screen.getByRole("button", { name: /^Magician of Faith/ });
    magician.focus();
    grid.scrollTop = 40;
    rerender(show(GY, [link(1)]));
    expect(grid.scrollTop).toBe(40);
    expect(document.activeElement).toBe(magician);
    rerender(show(GY, [link(1, { status: "resolving" })]));
    expect(grid.scrollTop).toBe(40);
    expect(document.activeElement).toBe(magician);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls again on the next opening, not before", () => {
    const { rerender } = render(show(GY, [link(1)], { open: false }));
    expect(screen.queryByRole("list")).toBeNull();
    rerender(show(GY, [link(1)], { open: true }));
    expect((screen.getByRole("list") as HTMLElement).scrollTop).toBe(312);
  });
});
