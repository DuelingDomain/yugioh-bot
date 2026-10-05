// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MoveFx } from "@/components/duel/move-fx";
import { captureZoneSnapshots, clearZoneSnapshots, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const HAND = 0x02;
const SZONE = 0x08;
const GRAVE = 0x10;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;
const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule("spell-rest");
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]")?.getAttribute("data-zones") ?? "";
    return { left: zone.includes(":2:") ? 600 : zone.includes(":16:") ? 900 : 100, top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  board?.remove();
  clearZoneSnapshots();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

/**
 * The batch the server sends for a Normal Spell activated from the hand with no response, as the real engine
 * produced it (packages/duel-server live probe, Raigeki 12580477 and Pot of Greed 55144522, standard, domain,
 * legacy, Tag and FFA4): the card moves to its Spell/Trap Zone FACE-UP (faceDown false, position 0x5), the chain
 * resolves, and the card moves to the Graveyard in the same batch. The board already shows the end of the batch,
 * so the Spell/Trap Zone is empty while all of it plays.
 */
const batch = (seat: number): DuelEvent[] => [
  { id: 1, kind: "move", text: "moved", seat, card: CARDS.raigeki, from: z(seat, HAND, 0), zone: z(seat, SZONE, 0), reason: "activate", faceDown: false },
  { id: 2, kind: "activate", text: "activate", seat, card: CARDS.raigeki, zone: z(seat, SZONE, 0), chainIndex: 1 },
  { id: 3, kind: "chain-resolving", text: "resolving", seat, card: CARDS.raigeki, chainIndex: 1 },
  { id: 4, kind: "move", text: "moved", seat, card: CARDS.raigeki, from: z(seat, SZONE, 0), zone: z(seat, GRAVE, 0), reason: "send" },
  { id: 5, kind: "chain-end", text: "end" },
];

function Zones({ seat }: { seat: number }) {
  const side = seat === 0 ? "you" : "opp";
  return <div>
    <div data-zones={`${seat}:2:0`} data-side={side} />
    <div data-zones={`${seat}:8:0`} data-side={side} />
    <div data-zones={`${seat}:16:0`} data-side={side} />
  </div>;
}

describe("a Spell activated from the hand rests face-up in its zone until it leaves", () => {
  // The viewer who activates sees the board from the bottom; the other viewer and a spectator see seat 0 on top.
  it.each([["the activating player", 0], ["the opponent", 1]])("shows its face, never its sleeve, on the board of %s", (_name, seat) => {
    vi.useFakeTimers();
    board = document.createElement("div");
    document.body.append(board);
    const { rerender } = render(<><Zones seat={seat} /><MoveFx events={[]} duelKey="spell-rest" reducedMotion={false} /></>, { container: board });
    captureZoneSnapshots(board);
    rerender(<><Zones seat={seat} /><MoveFx events={batch(seat)} duelKey="spell-rest" reducedMotion={false} /></>);
    act(() => vi.advanceTimersByTime(4000));
    // The flight from the hand starts at once (delay 0; the opponent's hand card is a sleeve that turns over as it
    // lands, which is right). The departure to the Graveyard waits for the chain: it must not turn from a sleeve.
    const sleeves = animate.mock.calls.filter(([frames, options]) => Number((options as KeyframeAnimationOptions).delay) > 0
      && (frames as Keyframe[]).some((frame) => frame.transform === "rotateY(180deg)"));
    expect(sleeves).toEqual([]);
  });
});

describe("a Spell/Trap Set from the hand", () => {
  // The owner knows the card (the move carries it); the opponent and a spectator get the move with no card.
  const setBatch = (seat: number, known: boolean): DuelEvent[] => [
    { id: 1, kind: "move", text: "moved", seat, ...(known ? { card: CARDS.mst } : {}), from: z(seat, HAND, 0), zone: z(seat, SZONE, 0), reason: "set", faceDown: true },
    { id: 2, kind: "set", text: "set", seat, zone: z(seat, SZONE, 0) },
  ];
  const turnsOf = () => animate.mock.calls.map(([frames]) => frames as Keyframe[])
    .filter((frames) => String(frames[0]?.transform ?? "").startsWith("rotateY("));

  function play(seat: number, known: boolean) {
    vi.useFakeTimers();
    board = document.createElement("div");
    document.body.append(board);
    const { rerender } = render(<><Zones seat={seat} /><MoveFx events={[]} duelKey="spell-rest" reducedMotion={false} /></>, { container: board });
    captureZoneSnapshots(board);
    rerender(<><Zones seat={seat} /><MoveFx events={setBatch(seat, known)} duelKey="spell-rest" reducedMotion={false} /></>);
    act(() => vi.advanceTimersByTime(4000));
  }

  it("lands on its sleeve for its owner", () => {
    play(0, true);
    // Its owner's copy carries the face (it turns away from it), so the check on the opponent's board below is not empty.
    expect(board.querySelector(`img[src*="/cards/${CARDS.mst.code}/"]`)).not.toBeNull();
    const [turn] = turnsOf();
    expect(turn[turn.length - 1].transform).toBe("rotateY(180deg)");
  });

  it("stays a sleeve the whole way for the opponent, who never gets its face", () => {
    play(1, false);
    expect(board.querySelector(`img[src*="/cards/${CARDS.mst.code}/"]`)).toBeNull();
    expect(turnsOf().flat().some((frame) => frame.transform === "rotateY(0deg)")).toBe(false);
  });
});
