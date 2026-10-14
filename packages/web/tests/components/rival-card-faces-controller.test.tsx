// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

// jsdom has no layout: the live turn of a seat field is the one thing the test sets by hand.
const pose = vi.hoisted(() => ({ turn: 0 as number | null }));
vi.mock("@/components/duel/attack-fx", async (original) => ({
  ...(await original<typeof import("@/components/duel/attack-fx")>()),
  screenPose: () => (pose.turn == null ? null : { w: 60, h: 88, turn: pose.turn }),
}));

import type { MovePlan } from "@/components/duel/move-plan";
import { placeSourceStandIn } from "@/components/duel/source-stand-in";
import { TributeGhost } from "@/components/duel/tribute-fx";

const FIELD_ZONE = { controller: 1, location: 4, sequence: 2 };

/** A zone of a seat field of a multiplayer table (`data-side` "you" is what a turned rival field says with upright off). */
function seatZone(side: "you" | "opp" = "you"): HTMLElement {
  const field = document.createElement("div");
  field.dataset.seatField = "1";
  const node = document.createElement("div");
  node.dataset.zones = "1:4:2";
  node.dataset.side = side;
  node.dataset.defense = "false";
  field.appendChild(node);
  document.body.appendChild(field);
  return node;
}

function plan(extra: Partial<MovePlan> = {}): MovePlan {
  const event = { id: 1, kind: "move", text: "leaves", zone: { controller: 1, location: 16, sequence: 0 }, from: FIELD_ZONE, card: { code: 123, name: "Celtic Guardian" } } as unknown as DuelEvent;
  return {
    event,
    source: { rect: { left: 10, top: 10, width: 60, height: 88 }, side: "you", faceUp: true, defense: false },
    ...extra,
  } as unknown as MovePlan;
}

afterEach(() => {
  pose.turn = 0;
  document.body.innerHTML = "";
});

describe("the stand-in of a card that leaves a rival's field", () => {
  it("lies turned like the field it left, not upright", () => {
    seatZone();
    pose.turn = 180;
    const el = document.createElement("div");
    expect(placeSourceStandIn(el, plan(), { left: 0, top: 0 } as DOMRect, 60, 88)).toBe(true);
    expect(el.style.transform).toContain("rotate(180deg)");
  });

  it("keeps the viewer's own field upright and a 1v1 zone on its side turn", () => {
    seatZone();
    pose.turn = 0;
    const own = document.createElement("div");
    placeSourceStandIn(own, plan(), { left: 0, top: 0 } as DOMRect, 60, 88);
    expect(own.style.transform).toContain("rotate(0deg)");
    document.body.innerHTML = "";
    const lone = document.createElement("div");
    lone.dataset.zones = "1:4:2";
    lone.dataset.side = "opp";
    document.body.appendChild(lone);
    const far = document.createElement("div");
    placeSourceStandIn(far, plan({ source: { rect: { left: 10, top: 10, width: 60, height: 88 }, side: "opp", faceUp: true, defense: false } }), { left: 0, top: 0 } as DOMRect, 60, 88);
    expect(far.style.transform).toContain("rotate(180deg)");
  });
});

describe("the Tribute of a rival's field", () => {
  const frames: Array<{ transform?: string }[]> = [];
  beforeEach(() => {
    frames.length = 0;
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(keyframes: Array<{ transform?: string }>) {
        frames.push(keyframes);
        return { finished: Promise.resolve(), cancel() {}, onfinish: null };
      },
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  function lift(): string {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
    render(<TributeGhost plan={plan({ tribute: { index: 0, count: 1, to: { controller: 1, location: 4, sequence: 3 } } })} overlay={overlay} landed={() => {}} done={() => {}} />);
    return frames[0]?.[0]?.transform ?? "";
  }

  it("burns turned like its field", () => {
    seatZone();
    pose.turn = 180;
    expect(lift()).toContain("rotate(180deg)");
  });

  it("burns upright on the viewer's own field", () => {
    seatZone();
    pose.turn = 0;
    expect(lift()).toContain("rotate(0deg)");
  });
});
