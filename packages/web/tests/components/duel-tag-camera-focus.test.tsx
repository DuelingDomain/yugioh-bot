// @vitest-environment jsdom
import React, { useReducer } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SeatField } from "@/components/duel/field";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer, type RoofCameraState } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableStateId } from "@/components/duel/table/fixtures/common";

afterEach(cleanup);

const seen: { camera: RoofCameraState | null } = { camera: null };

function Stage({ id, mode }: { id: TableStateId; mode?: "overview" | "focus" }) {
  const state = TAG_FIXTURES.states[id];
  const controller = useFixtureController(state, { reducedMotion: true });
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () =>
    initialRoofCamera({ anchorSeat: layout.anchorSeat, camera: mode === "focus" ? { mode: "focus", focusSeat: 0 } : undefined }),
  );
  seen.camera = camera;
  return (
    <div style={{ width: 1000, height: 800 }}>
      <TagStage
        controller={controller}
        layout={layout}
        camera={camera}
        dispatchCamera={dispatch}
        renderSeatField={(props) => <SeatField {...props} />}
        teamNames={TAG_TEAM_NAMES}
      />
    </div>
  );
}

function mount(id: TableStateId = "main", mode?: "overview" | "focus") {
  return render(<Stage id={id} mode={mode} />).container;
}

const stageOf = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-tag-stage]")!;
const modeOf = (root: HTMLElement) => `${stageOf(root).dataset.cameraMode}:${stageOf(root).dataset.cameraSeat ?? "-"}`;

describe("Tag overview camera: the default", () => {
  it("opens on the overview, with no rail and a focus button on each of the four fields", () => {
    const root = mount();
    expect(modeOf(root)).toBe("overview:-");
    expect(root.querySelector("[data-camera-rail]")).toBeNull();
    expect([...root.querySelectorAll("[data-field-focus]")].map((node) => node.getAttribute("data-field-focus")).sort()).toEqual(["0", "1", "2", "3"]);
  });
});

describe("Tag overview camera: click to focus", () => {
  it("a click on the bare mat of a field focuses that field", () => {
    const root = mount();
    const hold = root.querySelector<HTMLElement>('[data-field-hold="3"]')!;
    const mat = [...hold.querySelectorAll<HTMLElement>("div")].find((node) => !node.closest("button, [role='button'], [data-legal='true']") && node.className.includes("sfMat"));
    expect(mat).toBeTruthy();
    fireEvent.click(mat!);
    expect(modeOf(root)).toBe("focus:3");
  });

  it("a click on the field name label focuses that field", () => {
    const root = mount();
    const label = root.querySelector<HTMLElement>('[data-field-hold="1"] [data-seat-name]');
    expect(label).toBeTruthy();
    fireEvent.click(label!);
    expect(modeOf(root)).toBe("focus:1");
  });

  it("a click on a seat chip of the team plate focuses that seat", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-team-plate="far"] [data-member-seat="3"]')!);
    expect(modeOf(root)).toBe("focus:3");
  });

  it("the focus button of a field focuses it (keyboard and pointer: it is a real button)", () => {
    const root = mount();
    const button = root.querySelector<HTMLButtonElement>('[data-field-focus="2"]')!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toMatch(/focus .*field/i);
    fireEvent.click(button);
    expect(modeOf(root)).toBe("focus:2");
    // The focused field needs no focus button any more.
    expect(root.querySelector('[data-field-focus="2"]')).toBeNull();
    expect(root.querySelector('[data-field-focus="0"]')).not.toBeNull();
  });
});

describe("Tag overview camera: action clicks never move the camera", () => {
  it("a click on a legal zone, a button or a card button on a field does its own job only", () => {
    const root = mount();
    const hold = root.querySelector<HTMLElement>('[data-field-hold="0"]')!;
    const legal = [...hold.querySelectorAll<HTMLElement>('[data-legal="true"]')];
    const buttons = [...hold.querySelectorAll<HTMLElement>("button:not([data-field-focus])")];
    expect(legal.length + buttons.length).toBeGreaterThan(0);
    for (const node of [...legal, ...buttons]) {
      fireEvent.click(node);
      expect(modeOf(root)).toBe("overview:-");
    }
  });

  it("a click on a pickable seat chip answers the pick and does not focus", () => {
    const root = mount("choose-opponent");
    const pickable = root.querySelector<HTMLElement>('[data-member-seat][data-pickable="true"]');
    expect(pickable).toBeTruthy();
    fireEvent.click(pickable!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("a click on a field does not focus while an attack is aimed", () => {
    const root = mount("battle-aim");
    const hold = root.querySelector<HTMLElement>('[data-field-hold="1"]')!;
    fireEvent.click(hold.querySelector<HTMLElement>("[data-seat-name]") ?? hold);
    expect(modeOf(root)).toBe("overview:-");
  });
});

describe("Tag overview camera: back", () => {
  it("shows the rail only in a close-up, with Back to overview and a seat switcher", () => {
    const root = mount("main", "focus");
    const rail = root.querySelector("[data-camera-rail]");
    expect(rail).not.toBeNull();
    expect(rail!.querySelector("[data-camera-back]")?.textContent).toMatch(/back to overview/i);
    const seats = [...rail!.querySelectorAll<HTMLElement>("[data-camera-seat-button]")];
    expect(seats.length).toBe(4);
    expect(seats.filter((node) => node.getAttribute("aria-pressed") === "true").map((node) => node.dataset.cameraSeatButton)).toEqual(["0"]);
  });

  it("the Back button returns to the overview and removes the rail", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="1"]')!);
    expect(modeOf(root)).toBe("focus:1");
    fireEvent.click(root.querySelector<HTMLElement>("[data-camera-back]")!);
    expect(modeOf(root)).toBe("overview:-");
    expect(root.querySelector("[data-camera-rail]")).toBeNull();
    expect(seen.camera?.pose.zoom).toBe(1);
  });

  it("the switcher steps to another field without a trip through the overview", () => {
    const root = mount("main", "focus");
    fireEvent.click(root.querySelector<HTMLElement>('[data-camera-seat-button="3"]')!);
    expect(modeOf(root)).toBe("focus:3");
    expect(root.querySelector('[data-camera-seat-button="3"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
