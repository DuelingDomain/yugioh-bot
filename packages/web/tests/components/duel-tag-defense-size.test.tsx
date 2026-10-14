// @vitest-environment jsdom
import React, { useReducer } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SeatField } from "@/components/duel/field";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, ROOF_FIELD, roofReducer, roofSlots, ROOF_WORLD } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { SEAT_BOX_FULL_DEF, tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";

afterEach(cleanup);

const css = readFileSync(join(__dirname, "../../src/components/duel/field.module.css"), "utf8");

function Stage() {
  const controller = useFixtureController(TAG_FIXTURES.extra!.defense, { reducedMotion: true });
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
  return (
    <div style={{ width: 1000, height: 800 }}>
      <TagStage controller={controller} layout={layout} camera={camera} dispatchCamera={dispatch} renderSeatField={(props) => <SeatField {...props} />} teamNames={TAG_TEAM_NAMES} />
    </div>
  );
}

// A Defense card is the same card as an Attack card, turned a quarter. jsdom applies no CSS and measures no layout, so these tests read
// the stylesheet and the stage's own geometry: the turned card keeps its size (no scale) and the zone column is as wide as the card is tall.
describe("Tag fields draw a Defense card at the size of an Attack card", () => {
  it("renders Defense monsters, face-up and face-down, on all four fields", () => {
    const { container } = render(<Stage />);
    for (const seat of [0, 1, 2, 3]) {
      const field = container.querySelector(`[data-field-hold="${seat}"]`)!;
      expect(field.querySelectorAll('[data-defense="true"]').length, `seat ${seat}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("marks every field and shared band as a wide field, as wide as the 3-way one", () => {
    const { container } = render(<Stage />);
    const holds = [...container.querySelectorAll<HTMLElement>("[data-field-hold], [data-shared-band]")];
    expect(holds).toHaveLength(6);
    for (const hold of holds) {
      expect(hold.dataset.defFull).toBe("true");
      expect(hold.style.width).toBe(`${SEAT_BOX_FULL_DEF}px`);
    }
    expect(ROOF_FIELD.width).toBe(SEAT_BOX_FULL_DEF);
  });

  it("leaves the wide field no scale on a turned card (the rotated card is the Attack card's size)", () => {
    expect(css).toMatch(/:global\(\[data-def-full\]\) \.seatField \{\s*--dfit: 1;/);
    // The only rule that shrinks a turned card reads --dfit, so --dfit: 1 keeps the full size.
    expect(css).toMatch(/\.seatField \.cardFace\[data-defense="true"\],\s*\.seatField \.artWrap\[data-defense="true"\] > \.cardBack \{\s*transform: rotate\(90deg\) scale\(var\(--dfit\)\);/);
    expect(css).toMatch(/:global\(\[data-def-full\]\) \.seatField \.zone\[data-defense="true"\] \.glow \{\s*inset: calc\(\(var\(--z\) - var\(--cw\)\) \/ 2 - 1px\)/);
  });

  it("gives each zone column at least a landscape card's width, so the turned card stays in its column", () => {
    const z = 112; // --sf-z default
    const cw = z * 0.686;
    const g = z * 0.075;
    const widen = Number(/\[data-def-full\]\) \.seatField \.sfGrid \{\s*width: calc\(var\(--z\) \* \(5\.58 \+ ([\d.]+)\)\);/.exec(css)?.[1]);
    const fieldWidth = Number(/\[data-def-full\]\) \.seatField \{\s*--dfit: 1;\s*width: calc\(var\(--z\) \* \(5\.83 \+ ([\d.]+)\)\);/.exec(css)?.[1]);
    expect(widen).toBeCloseTo(1.571, 3);
    expect(fieldWidth).toBeCloseTo(1.571, 3);
    // Nine-column grid: pile, gap, five zones, gap, pile, with the row gap between columns (field.module.css .sfGrid).
    const grid = z * (5.58 + widen);
    const zones = grid - 2 * cw - 2 * (z * 0.0893) - 4 * g;
    const pitch = zones / 5;
    expect(pitch).toBeGreaterThanOrEqual(z);
    expect(z * (5.83 + fieldWidth)).toBeCloseTo(ROOF_FIELD.width, 0);
  });

  it("keeps the fields of a strip, and the two strips, clear of each other and inside the world", () => {
    const slots = roofSlots(0);
    const a = slots[0];
    const b = slots[2];
    expect(b.x - a.x).toBeGreaterThanOrEqual(ROOF_FIELD.width);
    expect(slots[1].x).toBe(a.x);
    // The strips are ROOF_FIELD.offsetY on each side of the helipad, as before; the field is only wider.
    expect(Math.abs(a.y) - ROOF_FIELD.height / 2).toBe(ROOF_FIELD.offsetY);
    // The overview fits both fields of a strip with air.
    expect(ROOF_WORLD.width).toBeGreaterThan(b.x + ROOF_FIELD.width / 2 - (a.x - ROOF_FIELD.width / 2));
  });
});
