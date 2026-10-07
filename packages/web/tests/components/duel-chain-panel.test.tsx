// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelCardInfo, DuelChainLink, DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";
import { CHAIN_PANEL_TIMING } from "@/components/duel/duel-timing";
import { ChainRoomContext } from "@/components/duel/table/chain-room";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";

const SZONE = 0x08;
const MZONE = 0x04;
const HAND = 0x02;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number, name = `Card ${code}`, description = "", type = 1): DuelCardInfo => ({
  code, name, description, type, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});

let id = 900;
const activate = (chainIndex: number, seat: number, card: DuelCardInfo, zone: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent => ({
  id: id++, kind: "activate", text: "a", seat, card, chainIndex, zone, ...extra,
});
const ev = (kind: DuelEvent["kind"], chainIndex?: number): DuelEvent => ({
  id: id++, kind, text: kind, ...(chainIndex != null ? { chainIndex } : {}),
});

const names = (seat: number) => (seat === 0 ? "You" : "Opponent");
const base = { chain: [] as DuelChainLink[], duelKey: "t", mySeat: 0, playerName: names };

const BOXES: Record<string, [number, number, number, number]> = {
  "0:8:0": [340, 400, 60, 80],
  "1:8:0": [340, 100, 60, 80],
};
function placeZones(...keys: string[]) {
  for (const key of keys) {
    const el = document.createElement("div");
    el.dataset.zones = key;
    document.body.appendChild(el);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = this.dataset.zones ? BOXES[this.dataset.zones.split(" ")[0]] : [0, 0, 900, 600];
    const [left, top, width, height] = box ?? [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  placeZones("0:8:0", "1:8:0");
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-zones]").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const panel = (c: HTMLElement) => c.querySelector("[data-chain-panel]") as HTMLElement | null;
const hero = (c: HTMLElement) => c.querySelector("[data-chain-hero]") as HTMLElement | null;
const strip = (c: HTMLElement) => c.querySelector("[data-chain-strip]") as HTMLButtonElement | null;
const sheet = (c: HTMLElement) => c.querySelector("[data-chain-sheet]") as HTMLElement | null;
const flush = (ms = 0) => act(() => { vi.advanceTimersByTime(ms); });

const TRAP_TEXT = "When an opponent's monster declares an attack: Target that monster; destroy that target.";
const pair = () => [
  activate(1, 0, info(11, "Card 11"), z(0, SZONE, 0)),
  activate(2, 1, info(22, "Card 22", "Negate the activation.", 4), z(1, SZONE, 0)),
];

describe("the strip", () => {
  const stripped = (events: DuelEvent[], extra: Partial<React.ComponentProps<typeof ChainFx>> = {}) => (
    <div data-duel-fx-speed-root>
      <ChainFx {...base} events={events} reducedMotion table="ffa4" {...extra} />
    </div>
  );

  it("uses the stage's reserved room instead of selecting a corner independently", () => {
    const { container } = render(
      <div data-duel-fx-speed-root>
        <div data-table-stage="ffa4" data-chain-room="410,212,300,88">
          <ChainRoomContext.Provider value={() => {}}>
            <ChainFx {...base} events={pair()} reducedMotion table="ffa4" />
          </ChainRoomContext.Provider>
        </div>
      </div>,
    );
    flush(60);
    const front = container.querySelector<HTMLElement>("[data-chain-front]")!;
    expect(front.style.getPropertyValue("--chain-dock-left")).toBe("410px");
    expect(front.style.getPropertyValue("--chain-dock-top")).toBe("212px");
  });

  it("names a visible source in the strip and sheet when the snapshot carries its zone label", () => {
    const seats = structuredClone(FFA4_FIXTURES.states["chain-2"].room.engine!.seats);
    seats[1].spells[1] = { ...info(5318639, "Mystical Space Typhoon"), ...z(1, SZONE, 1), position: 1 };
    const chain = [{ index: 1, seat: 1, code: 5318639, name: "Spell & Trap zone 2", zone: z(1, SZONE, 1) }];
    const { container } = render(stripped([], { chain, seats }));
    flush(60);
    expect(strip(container)?.getAttribute("aria-label")).toContain("Mystical Space Typhoon");
    act(() => { fireEvent.click(strip(container)!); });
    expect(hero(container)?.textContent).toContain("Mystical Space Typhoon");
    expect(hero(container)?.textContent).not.toContain("Spell & Trap zone");
  });

  it("uses the projected resolution card when the activation has left the event window", () => {
    const { container } = render(stripped([
      { ...ev("chain-resolving", 1), seat: 1, card: info(5318639, "Mystical Space Typhoon") },
    ]));
    flush(60);
    expect(strip(container)?.getAttribute("aria-label")).toContain("Mystical Space Typhoon");
  });

  it("does not reveal the name, art or text of a source absent from the viewer's redacted board", () => {
    const seats = structuredClone(FFA4_FIXTURES.states["chain-2"].room.engine!.seats);
    seats[1].spells[1] = { ...z(1, SZONE, 1), position: 8 };
    const chain = [{ index: 1, seat: 1, code: 5318639, name: "Spell & Trap zone 2", text: "Secret text", zone: z(1, SZONE, 1) }];
    const { container } = render(stripped([], { chain, seats }));
    flush(60);
    expect(strip(container)?.getAttribute("aria-label")).toContain("A card");
    act(() => { fireEvent.click(strip(container)!); });
    expect(hero(container)?.textContent).toContain("A card");
    expect(container.innerHTML).not.toMatch(/5318639|Secret text|Mystical Space Typhoon/);
  });

  it("is a real button outside the aria-hidden tree, with a label that names the link and its state", () => {
    const { container } = render(stripped(pair()));
    flush(60);
    const button = strip(container)!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toContain("Chain Link 2 of 2: Card 22");
    expect(button.closest('[aria-hidden="true"]')).toBeNull();
    expect(button.closest("[data-chain-front]")?.getAttribute("aria-hidden")).toBeNull();
  });

  it("opens the sheet on a tap, then closes it on Escape, on the scrim and on the close button", () => {
    const { container } = render(stripped(pair()));
    flush(60);
    expect(sheet(container)).toBeNull();
    act(() => { fireEvent.click(strip(container)!); });
    expect(sheet(container)).not.toBeNull();
    expect(sheet(container)?.getAttribute("role")).toBe("dialog");
    expect(strip(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(strip(container)?.getAttribute("aria-controls")).toBe(sheet(container)?.id);
    // The whole panel is in the sheet: the hero, and the stack of both links.
    expect(sheet(container)?.querySelector("[data-chain-hero]")).not.toBeNull();
    expect(sheet(container)?.querySelectorAll("[data-chain-row]")).toHaveLength(2);

    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(sheet(container)).toBeNull();
    expect(document.activeElement).toBe(strip(container));

    act(() => { fireEvent.click(strip(container)!); });
    act(() => { fireEvent.click(container.querySelector("[data-chain-scrim]") as HTMLElement); });
    expect(sheet(container)).toBeNull();

    act(() => { fireEvent.click(strip(container)!); });
    act(() => { fireEvent.click(sheet(container)!.querySelector('button[aria-label="Close chain details"]') as HTMLElement); });
    expect(sheet(container)).toBeNull();
  });

  it("makes every link of the sheet a button that opens its own detail", () => {
    const events = [
      activate(1, 0, info(11, "Card 11", "Destroy 1 monster your opponent controls.", 4), z(0, SZONE, 0)),
      activate(2, 1, info(22, "Card 22", "Negate the activation.", 4), z(1, SZONE, 0)),
    ];
    const { container } = render(stripped(events));
    flush(60);
    act(() => { fireEvent.click(strip(container)!); });
    const open = sheet(container)!;
    const rowButton = (n: number) => open.querySelector(`button[data-chain-row="${n}"]`) as HTMLButtonElement;
    const details = () => [...open.querySelectorAll("[data-chain-hero]")].map((el) => el.getAttribute("data-chain-hero"));
    // The focus link starts open; the other link is closed, and both are buttons.
    expect(rowButton(1).tagName).toBe("BUTTON");
    expect(rowButton(2).getAttribute("aria-expanded")).toBe("true");
    expect(rowButton(1).getAttribute("aria-expanded")).toBe("false");
    expect(details()).toEqual(["2"]);
    expect(open.querySelector('[data-chain-hero="2"]')?.textContent).toContain("Negate the activation.");
    expect(open.querySelector('[data-chain-hero="1"]')).toBeNull();

    // A tap opens link 1 with its full effect and who played it; the other stays open. A second tap closes it.
    act(() => { fireEvent.click(rowButton(1)); });
    expect(rowButton(1).getAttribute("aria-expanded")).toBe("true");
    expect(details().sort()).toEqual(["1", "2"]);
    const first = open.querySelector('[data-chain-hero="1"]') as HTMLElement;
    expect(first.textContent).toContain("Destroy 1 monster your opponent controls.");
    expect(first.textContent).toContain("You");
    expect(rowButton(1).getAttribute("aria-controls")).toBe(first.parentElement?.id);
    act(() => { fireEvent.click(rowButton(1)); });
    expect(details()).toEqual(["2"]);
    // The focus link closes too: nothing opens or closes by itself.
    act(() => { fireEvent.click(rowButton(2)); });
    expect(details()).toEqual([]);
  });

  it("closes the sheet with the chain, after its recap", () => {
    const first = pair();
    const { container, rerender } = render(stripped(first));
    flush(60);
    act(() => { fireEvent.click(strip(container)!); });
    rerender(stripped(first, { ended: true }));
    flush(100);
    expect(sheet(container)).toBeNull();
    expect(strip(container)).toBeNull();
  });

  it("stays visible and keeps its tap target when a prompt panel sits in its corner", () => {
    const { container } = render(
      <div data-duel-fx-speed-root>
        <div data-board><div data-slot="fx"><ChainFx {...base} events={pair()} reducedMotion table="ffa4" /></div></div>
        <div data-prompt-panel data-box="130,70,160,80">Activate?</div>
      </div>,
    );
    flush(60);
    expect(strip(container)).not.toBeNull();
    expect(strip(container)?.closest('[aria-hidden="true"]')).toBeNull();
    act(() => { fireEvent.click(strip(container)!); });
    expect(sheet(container)).not.toBeNull();
  });
});

describe("one effect", () => {
  it("shows a hero and no header, no pips and no stack", () => {
    const { container } = render(<ChainFx {...base} events={[activate(1, 0, info(11, "Card 11"), z(0, SZONE, 0))]} reducedMotion />);
    flush(60);
    expect(hero(container)).not.toBeNull();
    expect(container.querySelector("[data-chain-panel] header")).toBeNull();
    expect(container.querySelector("[data-chain-row]")).toBeNull();
    expect(hero(container)?.textContent).toContain("Effect");
    expect(hero(container)?.textContent).not.toMatch(/Link \d of/);
  });

  it("keeps the header, the pips and the stack once there are two", () => {
    const { container } = render(<ChainFx {...base} events={pair()} reducedMotion />);
    flush(60);
    expect(container.querySelector("[data-chain-panel] header")?.textContent).toContain("2 links");
    expect(container.querySelectorAll("[data-chain-row]")).toHaveLength(2);
    expect(hero(container)?.textContent).toContain("Link 2 of 2");
  });

  it("makes every row of the column a button that shows its link in the hero", () => {
    const { container } = render(<ChainFx {...base} events={pair()} reducedMotion />);
    flush(60);
    const row = (n: number) => container.querySelector(`[data-chain-panel] button[data-chain-row="${n}"]`) as HTMLButtonElement;
    expect(row(1).tagName).toBe("BUTTON");
    expect(row(1).getAttribute("aria-pressed")).toBe("false");
    act(() => { fireEvent.click(row(1)); });
    expect(row(1).getAttribute("aria-pressed")).toBe("true");
    expect(hero(container)?.textContent).toContain("Link 1 of 2");
    // The same row again goes back to the live link.
    act(() => { fireEvent.click(row(1)); });
    expect(row(1).getAttribute("aria-pressed")).toBe("false");
    expect(hero(container)?.textContent).toContain("Link 2 of 2");
  });
});

describe("the recap after the chain", () => {
  const events = () => [...pair(), ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];

  /** Plays the chain out in small steps until its badges leave, i.e. until the chain has ended. */
  function untilEnded(container: HTMLElement) {
    for (let t = 0; t < 12000; t += 50) {
      flush(50);
      if (container.querySelector("[data-chain-link]") == null && container.querySelector("[data-chain-front]")?.getAttribute("data-recap") === "true") return;
    }
    throw new Error("the chain never ended");
  }

  it.each([
    { reduced: false, ms: CHAIN_PANEL_TIMING.recapMs },
    { reduced: true, ms: CHAIN_PANEL_TIMING.recapReducedMs },
  ])("holds the panel for $ms ms after the chain ends (reduced motion $reduced), then removes it", ({ reduced, ms }) => {
    const first = pair();
    const { container, rerender } = render(<ChainFx {...base} events={first} reducedMotion={reduced} />);
    rerender(<ChainFx {...base} events={events()} reducedMotion={reduced} />);
    untilEnded(container);
    expect(panel(container)).not.toBeNull();
    flush(ms - 150);
    expect(panel(container)).not.toBeNull();
    flush(300);
    expect(panel(container)).toBeNull();
    expect(container.querySelector("[data-chain-front]")?.getAttribute("data-recap")).not.toBe("true");
  });

  it("is shorter on reduced motion than at normal speed", () => {
    expect(CHAIN_PANEL_TIMING.recapReducedMs).toBeLessThan(CHAIN_PANEL_TIMING.recapMs);
    expect(CHAIN_PANEL_TIMING.recapMs).toBe(3200);
    expect(CHAIN_PANEL_TIMING.recapReducedMs).toBe(800);
  });

  it("is dropped at once when the duel ends", () => {
    const first = pair();
    const { container, rerender } = render(<ChainFx {...base} events={first} reducedMotion />);
    rerender(<ChainFx {...base} events={events()} reducedMotion />);
    untilEnded(container);
    expect(panel(container)).not.toBeNull();
    rerender(<ChainFx {...base} events={events()} reducedMotion ended />);
    flush(50);
    expect(panel(container)).toBeNull();
  });

  it("is dropped when the room changes", () => {
    const first = pair();
    const { container, rerender } = render(<ChainFx {...base} events={first} reducedMotion />);
    rerender(<ChainFx {...base} events={events()} reducedMotion />);
    untilEnded(container);
    rerender(<ChainFx {...base} events={[]} duelKey="other" reducedMotion />);
    flush(50);
    expect(panel(container)).toBeNull();
  });

  it("gives way to the next chain, and does not hold a recap for it until it ends", () => {
    const first = pair();
    const played = [...first, ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];
    const { container, rerender } = render(<ChainFx {...base} events={first} reducedMotion />);
    rerender(<ChainFx {...base} events={played} reducedMotion />);
    untilEnded(container);
    rerender(<ChainFx {...base} events={[...played, activate(1, 1, info(33, "Card 33"), z(1, SZONE, 0))]} reducedMotion />);
    flush(2000);
    expect(hero(container)?.textContent).toContain("Card 33");
    expect(container.querySelector("[data-chain-front]")?.getAttribute("data-recap")).not.toBe("true");
  });
});

describe("privacy in the rendered panel", () => {
  const card = (over: Partial<DuelCard>): DuelCard => ({ controller: 1, location: MZONE, sequence: 0, position: 0x1, name: "Gaia The Fierce Knight", ...over });
  const seat = (n: number, over: Partial<DuelSeatView> = {}): DuelSeatView => ({
    seat: n, lp: 8000, hand: [], deckCount: 0, extraCount: 0, extra: [], monsters: [null, null, null, null, null], spells: [null, null, null, null, null], graveyard: [], banished: [], ...over,
  });

  it("names a face-up public target and says only the place for a face-down or hand card", () => {
    const seats = [
      seat(0, { hand: [card({ controller: 0, location: HAND, sequence: 0, name: "Kuriboh", position: 0 })] }),
      seat(1, {
        monsters: [card({}), null, null, null, null],
        spells: [card({ location: SZONE, sequence: 0, position: 0x8, name: "Secret Trap" }), null, null, null, null],
      }),
    ];
    const trap = info(4206964, "Trap Hole", TRAP_TEXT, 4);
    const targets = [z(1, MZONE, 0), z(1, SZONE, 0), z(0, HAND, 0)];
    const { container } = render(<ChainFx {...base} events={[activate(1, 1, trap, z(1, SZONE, 1), { targets })]} reducedMotion seats={seats} />);
    flush(60);
    const text = container.querySelector("[data-chain-hero-targets]")?.textContent ?? "";
    expect(text).toContain("Gaia The Fierce Knight");
    expect(text).not.toContain("Secret Trap");
    expect(text).not.toContain("Kuriboh");
    expect(text).toContain("your hand card 1");
  });

  it("renders an unknown card as A card with no art, text or passcode anywhere in the DOM", () => {
    const secret = info(55144522, "", TRAP_TEXT, 4);
    const { container } = render(
      <ChainFx {...base} events={[activate(1, 1, secret, z(1, SZONE, 0), { description: "Destroy it." })]} reducedMotion />,
    );
    flush(60);
    expect(hero(container)?.textContent).toContain("A card");
    expect(hero(container)?.querySelector("[data-chain-art]")).toBeNull();
    expect(hero(container)?.querySelector("[data-chain-effect]")).toBeNull();
    const html = document.body.innerHTML;
    expect(html).not.toContain("55144522");
    expect(html).not.toContain("Target that monster");
    expect(html).not.toContain("Destroy it");
  });

  it("leaks no passcode from a card the viewer cannot name, through the strip either", () => {
    const secret = info(55144522, "", TRAP_TEXT, 4);
    const { container } = render(
      <div data-duel-fx-speed-root>
        <ChainFx {...base} events={[activate(1, 1, secret, z(1, SZONE, 0))]} reducedMotion table="ffa4" />
      </div>,
    );
    flush(60);
    act(() => { fireEvent.click(strip(container)!); });
    expect(container.innerHTML).not.toContain("55144522");
    expect(strip(container)?.getAttribute("aria-label")).toContain("A card");
  });
});
