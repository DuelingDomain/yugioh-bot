// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no layout: the on-screen pose of a zone is the one thing the test sets by hand.
const pose = vi.hoisted(() => ({ value: { w: 120, h: 170, turn: 90 } as { w: number; h: number; turn: number } | null, calls: 0 }));
vi.mock("@/components/duel/attack-fx", async (original) => ({
  ...(await original<typeof import("@/components/duel/attack-fx")>()),
  screenPose: () => {
    pose.calls += 1;
    return pose.value;
  },
}));

import { moveDestinationRotation, SCALED_FIELD, seatFieldTurn } from "@/components/duel/event-queue";
import { measure } from "@/components/duel/position-fx";

type Host = "seat" | "band" | "none";

/** A zone inside a seat field of a grid table or the Tag Rooftop (`data-seat-field`), inside the shared Extra Monster Zone band of the Tag facing seats (`data-shared-band`), or in neither (a 1v1 table). */
function zone(host: Host): HTMLElement {
  const node = document.createElement("div");
  if (host === "none") document.body.appendChild(node);
  else {
    const field = document.createElement("div");
    field.setAttribute(host === "seat" ? "data-seat-field" : "data-shared-band", "1");
    field.appendChild(node);
    document.body.appendChild(field);
  }
  return node;
}

function rect(width: number, height: number): DOMRect {
  return { left: 100, top: 100, right: 100 + width, bottom: 100 + height, width, height, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => {
  pose.value = { w: 120, h: 170, turn: 90 };
  pose.calls = 0;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SCALED_FIELD", () => {
  it("names the seat field and the shared band", () => {
    expect(zone("seat").closest(SCALED_FIELD)).not.toBeNull();
    expect(zone("band").closest(SCALED_FIELD)).not.toBeNull();
    expect(zone("none").closest(SCALED_FIELD)).toBeNull();
  });
});

describe("seatFieldTurn / moveDestinationRotation", () => {
  it.each<Host>(["seat", "band"])("reads the screen turn of a zone in a %s", (host) => {
    expect(seatFieldTurn(zone(host))).toBe(90);
    expect(moveDestinationRotation(zone(host))).toBe(90);
  });

  it("is 0 on a 1v1 table and reads no pose there", () => {
    expect(seatFieldTurn(zone("none"))).toBe(0);
    expect(moveDestinationRotation(zone("none"))).toBe(0);
    expect(pose.calls).toBe(0);
  });
});

describe("position FX measure", () => {
  function geo(host: Host) {
    const overlay = document.createElement("div");
    overlay.getBoundingClientRect = () => rect(1000, 600);
    const node = zone(host);
    node.getBoundingClientRect = () => rect(80, 120);
    return measure(overlay, node);
  }

  it.each<Host>(["seat", "band"])("takes the on-screen edges and turn of a zone in a %s", (host) => {
    const result = geo(host);
    expect(result?.turn).toBe(90);
    expect(result?.h).toBe(170);
  });

  it("keeps the bounding box on a 1v1 table and reads no pose", () => {
    const result = geo("none");
    expect(result?.turn).toBe(0);
    expect(result?.h).toBe(120);
    expect(pose.calls).toBe(0);
  });
});
