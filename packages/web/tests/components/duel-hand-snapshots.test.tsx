// @vitest-environment jsdom
import React, { useLayoutEffect, useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handArrivalTarget } from "@/components/duel/event-queue";
import { captureZoneSnapshots, getMovePlan, planMoves, resetMoveSchedule, resolveSource } from "@/components/duel/move-plan";
import { MoveSourceBoundary } from "@/components/duel/fx-boundary";
import { LOCATION_DECK, LOCATION_GRAVE, LOCATION_HAND } from "@/components/duel/constants";
import type { DuelEvent } from "@yugidraft/shared/duels";

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});
const cardInfo = (code: number) => ({ code, name: `Card ${code}`, description: "", type: 17,
  attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior" });
const arrival = (seat: number): DuelEvent => ({ id: 1, kind: "move", text: "A card moved", handId: "departed-1",
  from: { controller: seat, location: LOCATION_DECK, sequence: 0 },
  zone: { controller: seat, location: LOCATION_HAND, sequence: 0 }, reason: "draw" });

beforeEach(() => { resetMoveSchedule("snapshot-test"); });
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("hand geometry snapshots", () => {
  it.each(["you", "opp"] as const)("sizes an empty %s hand from its own CSS card dimensions", (side) => {
    document.body.innerHTML = `<div><div data-hand-seat="0" data-side="you" style="padding-bottom:4px"></div><div data-hand-size-probe="true" data-side="you"></div></div>
      <div><div data-hand-seat="1" data-side="opp" style="padding-top:4px"></div><div data-hand-size-probe="true" data-side="opp"></div></div>`;
    const near = { width: 68.6, height: 100 };
    const far = { width: 48.02, height: 70 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.handSizeProbe) {
        const size = this.dataset.side === "opp" ? far : near;
        return rect(0, 0, size.width, size.height);
      }
      return rect(200, this.dataset.side === "opp" ? 20 : 500, 600, 240);
    });
    const hand = document.querySelector<HTMLElement>(`[data-hand-seat="${side === "you" ? 0 : 1}"]`)!;
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true, subtree: true });
    const target = handArrivalTarget(arrival(side === "you" ? 0 : 1))!;
    const size = side === "you" ? near : far;
    expect(target.rect.width).toBeCloseTo(size.width);
    expect(target.rect.height).toBe(size.height);
    expect(target.rect.left).toBeCloseTo(500 - size.width / 2);
    expect(target.rect.top).toBe(side === "you" ? 500 + 240 - 4 - size.height : 24);
    expect(hand.children).toHaveLength(0);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(document.querySelectorAll("[data-hand-size-probe]")).toHaveLength(2);
  });

  it("subtracts an active FLIP translation when capturing a departure slot", () => {
    document.body.innerHTML = '<div data-hand-seat="7" data-side="you"><div data-hand-card style="translate:30px -10px"><div data-zones="7:2:0" data-side="you"><img /></div></div></div>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(330, 490, 70, 100));
    captureZoneSnapshots();
    expect(resolveSource({ controller: 7, location: LOCATION_HAND, sequence: 0 })?.rect).toEqual({ left: 300, top: 500, width: 70, height: 100 });
  });

  it("captures fresh original positions for multiple departures from a compacting engine slot", () => {
    let layoutLeft = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.zones) {
        const sequence = Number(this.dataset.zones.split(":")[2]);
        return rect(layoutLeft + sequence * 100, 500, 70, 100);
      }
      if (this.dataset.handSizeProbe) return rect(0, 0, 70, 100);
      return rect(0, 450, 800, 200);
    });
    const view = render(<SnapshotBoard ids={["a", "b"]} events={[]} />);
    captureZoneSnapshots(view.container);
    layoutLeft = 500; // The viewport changed since the 160 ms sampler's last tick.
    const events = [departure(1), departure(2)];
    view.rerender(<SnapshotBoard ids={[]} events={events} />);
    expect(getMovePlan(1)?.source?.rect.left).toBe(500);
    expect(getMovePlan(2)?.source?.rect.left).toBe(600);
  });

  it("freezes a departure source before rendering its replacement and later snapshot sampling", () => {
    let layoutLeft = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.zones) return rect(layoutLeft + Number(this.dataset.zones.split(":")[2]) * 100, 500, 70, 100);
      if (this.dataset.handSizeProbe) return rect(0, 0, 70, 100);
      return rect(0, 450, 800, 200);
    });
    const view = render(<SnapshotBoard ids={["a", "b"]} events={[]} />);
    captureZoneSnapshots(view.container);
    layoutLeft = 300;
    view.rerender(<SnapshotBoard ids={["b"]} events={[departure(3)]} />);
    layoutLeft = 800;
    captureZoneSnapshots(view.container);
    expect(resolveSource({ controller: 0, location: LOCATION_HAND, sequence: 0 }, 3)?.rect.left).toBe(300);
    view.unmount();
    expect(resolveSource({ controller: 0, location: LOCATION_HAND, sequence: 0 }, 3)).toBeNull();
  });

  it("finds an owner's old card when an unreported shuffle changes its departure sequence", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rect(100 + Number(this.dataset.zones?.split(":")[2] ?? 0) * 100, 500, 70, 100);
    });
    const view = render(<SnapshotBoard ids={["a", "b"]} codes={[10, 20]} events={[]} />);
    const event = { ...departure(1), card: cardInfo(20) };
    // The engine shuffled [A, B] to [B, A] before removing B from sequence 0.
    view.rerender(<SnapshotBoard ids={["a"]} codes={[10]} events={[event]} />);
    expect(getMovePlan(1)?.source?.rect.left).toBe(200);
  });

  it("consumes distinct owner copies when shuffled duplicate cards depart from the same sequence", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rect(100 + Number(this.dataset.zones?.split(":")[2] ?? 0) * 100, 500, 70, 100);
    });
    const view = render(<SnapshotBoard ids={["a", "b", "c", "d"]} codes={[10, 20, 20, 30]} events={[]} />);
    const events = [20, 20, 10].map((code, index) => ({ ...departure(index + 1), card: cardInfo(code) }));
    view.rerender(<SnapshotBoard ids={["d"]} codes={[30]} events={events} />);
    expect(events.map((event) => getMovePlan(event.id)?.source?.rect.left)).toEqual([200, 300, 100]);
  });

  it.each(["you", "opp"] as const)("keeps nonowner departures on the %s side slot-bound despite previously revealed art", (side) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rect(100 + Number(this.dataset.zones?.split(":")[2] ?? 0) * 100, 500, 70, 100);
    });
    const view = render(<SnapshotBoard ids={["a", "b"]} codes={[10, 20]} side={side} owner={false} events={[]} />);
    const event = { ...departure(1), card: cardInfo(20) };
    view.rerender(<SnapshotBoard ids={["a"]} codes={[10]} side={side} owner={false} events={[event]} />);
    expect(getMovePlan(1)?.source?.rect.left).toBe(100);
  });

  it("does not borrow a replacement when the owner's departed card has no old DOM anchor", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rect(100 + Number(this.dataset.zones?.split(":")[2] ?? 0) * 100, 500, 70, 100);
    });
    const view = render(<SnapshotBoard ids={["a", "b"]} codes={[10, 20]} events={[]} />);
    const events = [30, 20].map((code, index) => ({ ...departure(index + 1), card: cardInfo(code) }));
    view.rerender(<SnapshotBoard ids={["a"]} codes={[10]} events={events} />);
    expect(getMovePlan(1)?.source).toBeNull();
    expect(getMovePlan(2)?.source?.rect.left).toBe(200);
  });

  it("does not bind a just-added duplicate's departure to an older copy", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(100, 500, 70, 100));
    const view = render(<SnapshotBoard ids={["a"]} codes={[10]} events={[]} />);
    const added: DuelEvent = { ...arrival(0), card: cardInfo(10), addedToHand: true };
    const removed = { ...departure(2), card: cardInfo(10) };
    view.rerender(<SnapshotBoard ids={["a"]} codes={[10]} events={[added, removed]} />);
    expect(resolveSource(removed.from!, removed.id)).toBeNull();
  });
});

const departure = (id: number): DuelEvent => ({ id, kind: "move", text: "A card moved",
  from: { controller: 0, location: LOCATION_HAND, sequence: 0 },
  zone: { controller: 0, location: LOCATION_GRAVE, sequence: id - 1 }, reason: "discard" });

function SnapshotBoard({ ids, codes, events, side = "you", owner = side === "you" }: { ids: string[]; codes?: number[]; events: DuelEvent[]; side?: "you" | "opp"; owner?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  return <div ref={root}><MoveSourceBoundary events={events} duelKey="snapshot-test" root={root}>
    <div data-hand-seat="0" data-side={side}>{ids.map((id, sequence) =>
      <div key={id} data-hand-id={`${owner ? "hand" : "sleeve"}-${id}`} data-hand-card><div data-zones={`0:2:${sequence}`} data-side={side}>
        {codes?.[sequence] ? <img src={`/api/cards/${codes[sequence]}/image`} alt="" /> : null}
      </div></div>)}</div>
    <PlanAfterCommit events={events} />
  </MoveSourceBoundary></div>;
}

function PlanAfterCommit({ events }: { events: DuelEvent[] }) {
  useLayoutEffect(() => { planMoves(events, { duelKey: "snapshot-test", now: 0, reduced: false, geometry: () => ({ distance: 100 }) }); }, [events]);
  return null;
}
