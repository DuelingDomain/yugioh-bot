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
import type { TableFixtureState, TableStateId } from "@/components/duel/table/fixtures/common";

afterEach(cleanup);

const seen: { camera: RoofCameraState | null } = { camera: null };

function Stage({ id, mode, hub, state: given }: { id: TableStateId; mode?: "overview" | "focus"; hub?: React.ReactNode; state?: TableFixtureState }) {
  const state = given ?? TAG_FIXTURES.states[id];
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
        hub={hub}
      />
    </div>
  );
}

function mount(id: TableStateId = "main", mode?: "overview" | "focus") {
  return render(<Stage id={id} mode={mode} />).container;
}

/** The zones of one field, split by what a click on them does. */
function zonesOf(root: HTMLElement, seat: number) {
  const zones = [...root.querySelectorAll<HTMLElement>(`[data-field-hold="${seat}"] [data-zones]`)];
  return {
    idle: zones.filter((zone) => zone.dataset.legal !== "true" && zone.dataset.selected !== "true" && !(zone.dataset.pile === "true" && zone.dataset.occupied === "true")),
    legal: zones.filter((zone) => zone.dataset.legal === "true"),
    piles: zones.filter((zone) => zone.dataset.pile === "true" && zone.dataset.occupied === "true"),
  };
}

function LockedStage() {
  const state = TAG_FIXTURES.states.main;
  const controller = useFixtureController(state, { reducedMotion: true });
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => {
    const base = initialRoofCamera({ anchorSeat: layout.anchorSeat });
    return roofReducer(base, { type: "lock", reason: "chain", nowMs: 0, ms: 60_000 });
  });
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

const stageOf = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-tag-stage]")!;
const modeOf = (root: HTMLElement) => `${stageOf(root).dataset.cameraMode}:${stageOf(root).dataset.cameraSeat ?? "-"}`;

describe("Tag overview camera: the default", () => {
  it("opens on the overview, with no rail and a zoom pill for each of the four fields", () => {
    const root = mount();
    expect(modeOf(root)).toBe("overview:-");
    expect(root.querySelector("[data-camera-rail]")).toBeNull();
    expect([...root.querySelectorAll("[data-field-focus]")].map((node) => node.getAttribute("data-field-focus")).sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("has no zoom button on the fields themselves: the nameplate pills are the only toggles", () => {
    const root = mount();
    expect(root.querySelectorAll("[data-field-hold] [data-field-focus]").length).toBe(0);
    expect(root.querySelectorAll("[data-field-hold] button[aria-label^='Focus']").length).toBe(0);
    for (const seat of [0, 1, 2, 3]) {
      const pill = root.querySelector<HTMLElement>(`[data-field-focus="${seat}"]`)!;
      expect(pill.tagName).toBe("BUTTON");
      expect(pill.closest("[data-roof='baton-pills']")).not.toBeNull();
    }
  });
});

/** A phone: the corner focus buttons are gone, so a tap on a field is how it focuses. */
function narrow(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe("Tag overview camera: a click on a field never focuses it on a wide screen", () => {
  const mat = (root: HTMLElement, seat: number) =>
    [...root.querySelectorAll<HTMLElement>(`[data-field-hold="${seat}"] div`)].find((node) => !node.closest("button, [role='button'], [data-legal='true']") && node.className.includes("sfMat"))!;

  it("a click on the bare mat of a field moves nothing", () => {
    const root = mount();
    expect(mat(root, 3)).toBeTruthy();
    fireEvent.click(mat(root, 3));
    expect(modeOf(root)).toBe("overview:-");
  });

  it("a click on the field name label moves nothing", () => {
    const root = mount();
    const label = root.querySelector<HTMLElement>('[data-field-hold="1"] [data-seat-name]');
    expect(label).toBeTruthy();
    fireEvent.click(label!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("a click on a seat chip of the team plate moves nothing", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-team-plate="far"] [data-member-seat="3"]')!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("a double click on the bare mat or the name label focuses the field; a single click does not", () => {
    const root = mount();
    fireEvent.click(mat(root, 3), { detail: 1 });
    expect(modeOf(root)).toBe("overview:-");
    fireEvent.doubleClick(mat(root, 3));
    expect(modeOf(root)).toBe("focus:3");
  });

  it("a double click on the name label focuses the field", () => {
    const root = mount();
    fireEvent.doubleClick(root.querySelector<HTMLElement>('[data-field-hold="1"] [data-seat-name]')!);
    expect(modeOf(root)).toBe("focus:1");
  });

  it("a double click on a zone or a card never focuses a field", () => {
    const root = mount();
    const { idle, piles } = zonesOf(root, 3);
    for (const zone of [idle[0], piles[0]].filter(Boolean)) {
      fireEvent.doubleClick(zone);
      const button = zone.querySelector("button");
      if (button) fireEvent.doubleClick(button);
    }
    expect(modeOf(root)).toBe("overview:-");
  });

  it("the nameplate pill of a field focuses it, and Back returns to the overview", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="2"]')!);
    expect(modeOf(root)).toBe("focus:2");
    fireEvent.click(root.querySelector<HTMLElement>("[data-camera-back]")!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("on a phone, a tap on the mat or the name label still focuses the field, and the pills toggle there too", () => {
    narrow(true);
    try {
      const root = mount();
      expect(root.querySelectorAll("[data-field-hold] [data-field-focus]").length).toBe(0);
      fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="2"]')!);
      expect(modeOf(root)).toBe("focus:2");
      fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="2"]')!);
      expect(modeOf(root)).toBe("overview:-");
      fireEvent.click(root.querySelector<HTMLElement>('[data-field-hold="1"] [data-seat-name]')!);
      expect(modeOf(root)).toBe("focus:1");
    } finally {
      narrow(false);
    }
  });

  it("a pill is a real button that zooms in on its field, and says so in its label", () => {
    const root = mount();
    const pill = root.querySelector<HTMLButtonElement>('[data-field-focus="2"]')!;
    expect(pill.tagName).toBe("BUTTON");
    expect(pill.getAttribute("type")).toBe("button");
    // One stable name that holds the pill text; the state is only aria-pressed.
    const text = `${pill.querySelector("b")!.textContent} ${pill.querySelector("span")!.textContent}`;
    expect(pill.getAttribute("aria-label")).toBe(`${text}, zoom on field`);
    expect(pill.getAttribute("title")).toMatch(/^Zoom in on .+'s field$/);
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pill);
    expect(modeOf(root)).toBe("focus:2");
    expect(pill.getAttribute("aria-label")).toBe(`${text}, zoom on field`);
    // The same pill stays in place and is now the way back; the others still zoom in.
    expect(root.querySelector('[data-field-focus="2"]')).toBe(pill);
    expect(root.querySelector('[data-field-focus="0"]')!.getAttribute("aria-label")).toMatch(/, zoom on field$/);
  });

  it("the same pill toggles: pressed and Zoom out in the close-up, and a second press zooms out", () => {
    const root = mount();
    const pill = root.querySelector<HTMLButtonElement>('[data-field-focus="1"]')!;
    fireEvent.click(pill);
    expect(modeOf(root)).toBe("focus:1");
    const label = pill.getAttribute("aria-label");
    expect(label).toMatch(/, zoom on field$/);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(pill.getAttribute("data-zoomed")).toBe("true");
    expect(pill.getAttribute("title")).toMatch(/zoom out/i);
    // Only the zoomed pill is pressed.
    expect([...root.querySelectorAll("[data-field-focus]")].filter((node) => node.getAttribute("aria-pressed") === "true")).toEqual([pill]);
    fireEvent.click(pill);
    expect(modeOf(root)).toBe("overview:-");
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    expect(pill.getAttribute("aria-label")).toBe(label);
    expect(pill.hasAttribute("data-zoomed")).toBe(false);
  });

  it("a press on another pill while zoomed switches to that field", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="0"]')!);
    expect(modeOf(root)).toBe("focus:0");
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="3"]')!);
    expect(modeOf(root)).toBe("focus:3");
    expect(root.querySelector('[data-field-focus="3"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-field-focus="0"]')!.getAttribute("aria-pressed")).toBe("false");
  });

  it("an FX lock disables the pills: they would do nothing", () => {
    const root = render(<LockedStage />).container;
    const pills = [...root.querySelectorAll<HTMLButtonElement>("[data-field-focus]")];
    expect(pills.length).toBe(4);
    for (const pill of pills) {
      expect(pill.disabled).toBe(true);
      fireEvent.click(pill);
    }
    expect(modeOf(root)).toBe("overview:-");
  });
});

describe("Tag overview camera: keyboard focus", () => {
  it("after a focus by a pill, the keyboard focus stays on that pill (it is the toggle)", () => {
    const root = mount();
    const button = root.querySelector<HTMLButtonElement>('[data-field-focus="1"]')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
  });

  it("after a focus by a phone tap on the mat, the keyboard focus lands on Back to overview, not on the page body", () => {
    narrow(true);
    try {
      const root = mount();
      fireEvent.click(root.querySelector<HTMLElement>('[data-field-hold="1"] [data-seat-name]')!);
      expect(modeOf(root)).toBe("focus:1");
      expect(document.activeElement).toBe(root.querySelector("[data-camera-back]"));
    } finally {
      narrow(false);
    }
  });

  it("after Back, the keyboard focus returns to the pill of the field that was in close-up", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="3"]')!);
    const back = root.querySelector<HTMLButtonElement>("[data-camera-back]")!;
    back.focus();
    fireEvent.click(back);
    expect(modeOf(root)).toBe("overview:-");
    expect(document.activeElement).toBe(root.querySelector('[data-field-focus="3"]'));
  });

  it("does not take the focus from another control that holds it", () => {
    const root = mount();
    fireEvent.click(root.querySelector<HTMLElement>('[data-field-focus="1"]')!);
    const other = root.querySelector<HTMLButtonElement>('[data-camera-seat-button="2"]')!;
    other.focus();
    fireEvent.click(other);
    expect(document.activeElement).toBe(other);
  });
});

describe("Tag overview camera: the phase hub", () => {
  const hub = <nav data-testid="phases">phases</nav>;
  const slotOf = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-phase-hub-slot]")!;

  it("is hidden in a close-up (the helipad is behind the focused field) and back in the overview", () => {
    const focused = render(<Stage id="main" mode="focus" hub={hub} />);
    expect(slotOf(focused.container).hidden).toBe(true);
    cleanup();
    const overview = render(<Stage id="main" hub={hub} />);
    expect(slotOf(overview.container).hidden).toBe(false);
  });
});

describe("Tag overview camera: a tap on a zone", () => {
  it("a zone that offers no action moves nothing on a wide screen", () => {
    const root = mount();
    const { idle } = zonesOf(root, 2);
    expect(idle.length).toBeGreaterThan(5);
    fireEvent.click(idle[0].querySelector("button")!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("the click is not swallowed: it reaches the page, and on a phone the tap focuses the field", () => {
    const outside = vi.fn();
    const root = render(<Stage id="main" />).container;
    const occupied = [...root.querySelectorAll<HTMLElement>('[data-field-hold="3"] [data-zones][data-occupied="true"]')].find((zone) => zone.dataset.pile !== "true");
    expect(occupied).toBeTruthy();
    root.addEventListener("click", outside);
    fireEvent.click(occupied!.querySelector("button")!);
    expect(modeOf(root)).toBe("overview:-");
    expect(outside).toHaveBeenCalled();
    cleanup();
    narrow(true);
    try {
      const phone = render(<Stage id="main" />).container;
      const zone = [...phone.querySelectorAll<HTMLElement>('[data-field-hold="3"] [data-zones][data-occupied="true"]')].find((node) => node.dataset.pile !== "true")!;
      fireEvent.click(zone.querySelector("button")!);
      expect(modeOf(phone)).toBe("focus:3");
    } finally {
      narrow(false);
    }
  });

  it("a legal zone, or a pile that opens, acts and never moves the camera", () => {
    const root = mount();
    const nodes = [0, 1, 2, 3].flatMap((seat) => {
      const { legal, piles } = zonesOf(root, seat);
      return [...legal, ...piles];
    });
    expect(nodes.length).toBeGreaterThan(0);
    for (const zone of nodes) {
      fireEvent.click(zone.querySelector("button")!);
      expect(modeOf(root)).toBe("overview:-");
    }
  });

  it("a plain button on a field does its own job only", () => {
    const root = mount();
    for (const button of root.querySelectorAll<HTMLElement>("[data-field-hold] button:not([data-zones] button)")) {
      fireEvent.click(button);
      expect(modeOf(root)).toBe("overview:-");
    }
  });

  it("during a pick prompt, a zone that is not a target never moves the camera", () => {
    const root = mount("target-pick");
    let tapped = 0;
    for (const seat of [0, 1, 2, 3]) {
      for (const zone of zonesOf(root, seat).idle.slice(0, 3)) {
        fireEvent.click(zone.querySelector("button")!);
        tapped += 1;
        expect(modeOf(root)).toBe("overview:-");
      }
    }
    expect(tapped).toBeGreaterThan(0);
  });

  it("a zone of the field that is already in close-up acts as usual", () => {
    const root = mount("main", "focus");
    const { idle } = zonesOf(root, 0);
    fireEvent.click(idle[0].querySelector("button")!);
    expect(modeOf(root)).toBe("focus:0");
  });

  it("a zone does not focus while the camera is locked", () => {
    const root = render(<LockedStage />).container;
    const { idle } = zonesOf(root, 2);
    fireEvent.click(idle[0].querySelector("button")!);
    expect(modeOf(root)).toBe("overview:-");
    expect([...root.querySelectorAll<HTMLButtonElement>("[data-field-focus]")].every((pill) => pill.disabled)).toBe(true);
  });
});

describe("Tag overview camera: action clicks never move the camera", () => {
  it("a click on a pickable seat chip answers the pick and does not focus", () => {
    const root = mount("choose-opponent");
    const pickable = root.querySelector<HTMLElement>('[data-member-seat][data-pickable="true"]');
    expect(pickable).toBeTruthy();
    fireEvent.click(pickable!);
    expect(modeOf(root)).toBe("overview:-");
  });

  it("a pill of a seat the prompt lets the viewer choose answers the pick; the prompt wins over the zoom", () => {
    const root = mount("choose-opponent");
    const pickable = root.querySelector<HTMLElement>('[data-member-seat][data-pickable="true"]')!;
    const seat = pickable.dataset.memberSeat!;
    const pill = root.querySelector<HTMLElement>(`[data-field-focus="${seat}"]`)!;
    expect(pill.getAttribute("data-pick")).toBe("true");
    expect(pill.getAttribute("aria-label")).toMatch(/, choose player$/);
    expect(pill.getAttribute("title")).toMatch(/^Choose /);
    expect(pill.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(pill);
    expect(modeOf(root)).toBe("overview:-");
    // A seat that is not a choice still zooms.
    const other = [...root.querySelectorAll<HTMLElement>("[data-field-focus]")].find((node) => !node.hasAttribute("data-pick"))!;
    fireEvent.click(other);
    expect(modeOf(root)).toBe(`focus:${other.dataset.fieldFocus}`);
  });

  it("a click on a field does not focus while an attack is aimed", () => {
    const root = mount("battle-aim");
    const hold = root.querySelector<HTMLElement>('[data-field-hold="1"]')!;
    fireEvent.click(hold.querySelector<HTMLElement>("[data-seat-name]") ?? hold);
    expect(modeOf(root)).toBe("overview:-");
  });
});

describe("Tag close-up camera: a pick or an aim never moves it, a hint marks the pill of a field with targets", () => {
  const hinted = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-field-focus][data-targets]")].map((pill) => Number(pill.dataset.fieldFocus));
  const legalSeats = (root: HTMLElement) => [0, 1, 2, 3].filter((seat) => zonesOf(root, seat).legal.length > 0);

  it("a target pick with legal zones on fields out of view hints those pills and keeps the close-up", () => {
    const root = mount("target-pick", "focus");
    const focus = Number(modeOf(root).split(":")[1]);
    const expected = legalSeats(root).filter((seat) => seat !== focus);
    expect(expected.length).toBeGreaterThan(0);
    expect(hinted(root)).toEqual(expect.arrayContaining(expected));
    expect(hinted(root)).not.toContain(focus);
    expect(modeOf(root)).toBe(`focus:${focus}`);
    const pill = root.querySelector<HTMLElement>(`[data-field-focus="${expected[0]}"]`)!;
    // The name stays the same; the hint is a description and a tooltip.
    expect(pill.getAttribute("aria-label")).toMatch(/, zoom on field$/);
    expect(pill.getAttribute("aria-description")).toBe("has targets");
    expect(pill.getAttribute("title")).toMatch(/has targets/);
    expect(pill.querySelector("[data-targets-hint]")).toBeTruthy();
    // The camera dock marks the same seats, so a field that is off screen still shows where the targets are.
    const dock = [...root.querySelectorAll<HTMLElement>("[data-camera-seat-button][data-targets]")].map((node) => Number(node.dataset.cameraSeatButton));
    expect(dock).toEqual(expect.arrayContaining(expected));
    expect(dock).not.toContain(focus);
    // The hint is only a mark: the press steps to that field, as for any pill.
    fireEvent.click(pill);
    expect(modeOf(root)).toBe(`focus:${expected[0]}`);
    expect(hinted(root)).not.toContain(expected[0]);
  });

  it("only a field zone counts for the hint: a Graveyard, banished, Deck or hand pick does not", () => {
    const base = TAG_FIXTURES.states["target-pick"];
    const prompt = base.room.engine!.prompt!;
    const option = (seat: number, location: number, sequence: number) => ({ id: `p${seat}-${location}-${sequence}`, label: "Card", controller: seat, location, sequence });
    const withOptions = (options: ReturnType<typeof option>[]): TableFixtureState => ({
      ...base,
      room: { ...base.room, engine: { ...base.room.engine!, prompt: { ...prompt, options } } },
    });
    // Piles of seats 1 and 2 and a hand card of seat 3: nothing sits on a field out of view.
    const piles = withOptions([option(1, 0x10, 0), option(2, 0x20, 0), option(3, 0x01, 0), option(3, 0x02, 0), option(1, 0x40, 0)]);
    expect(hinted(render(<Stage id="target-pick" mode="focus" state={piles} />).container)).toEqual([]);
    cleanup();
    // The same pick with one monster of seat 2 and one spell of seat 3 hints exactly those two pills.
    const fields = withOptions([option(1, 0x10, 0), option(2, 0x04, 1), option(3, 0x08, 0)]);
    expect(hinted(render(<Stage id="target-pick" mode="focus" state={fields} />).container).sort()).toEqual([2, 3]);
  });

  it("an attack aim keeps the close-up and a pill still steps to a rival field", () => {
    const root = mount("battle-aim", "focus");
    expect(modeOf(root).startsWith("focus:")).toBe(true);
    const rival = root.querySelector<HTMLButtonElement>('[data-field-focus="1"]')!;
    expect(rival.disabled).toBe(false);
    fireEvent.click(rival);
    expect(modeOf(root)).toBe("focus:1");
  });

  it("no hint in the overview, in a main phase action menu, or for the field in close-up", () => {
    expect(hinted(mount("target-pick"))).toEqual([]);
    cleanup();
    expect(hinted(mount("main", "focus"))).toEqual([]);
  });
});

describe("Tag close-up camera: a click on the field never zooms out", () => {
  it("a click on the mat, the name label or an idle zone of the field in close-up changes nothing", () => {
    const root = mount("main", "focus");
    const before = seen.camera!;
    const hold = root.querySelector<HTMLElement>('[data-field-hold="0"]')!;
    fireEvent.click(hold.querySelector<HTMLElement>("[data-seat-name]")!);
    fireEvent.click(zonesOf(root, 0).idle[0].querySelector("button")!);
    const mat = [...hold.querySelectorAll<HTMLElement>("div")].find((node) => node.className.includes("sfMat"))!;
    fireEvent.click(mat);
    expect(modeOf(root)).toBe("focus:0");
    // No new move either: the camera state is the same object, not a re-focus on the same seat.
    expect(seen.camera).toBe(before);
  });

  it("a click on a neighbour field that shows beside the close-up does not move the camera", () => {
    const root = mount("main", "focus");
    const before = seen.camera;
    const outside = vi.fn();
    root.addEventListener("click", outside);
    for (const seat of [1, 2, 3]) {
      const { idle } = zonesOf(root, seat);
      fireEvent.click(idle[0].querySelector("button")!);
      fireEvent.click(root.querySelector<HTMLElement>(`[data-field-hold="${seat}"] [data-seat-name]`)!);
    }
    fireEvent.click(root.querySelector<HTMLElement>('[data-team-plate="far"] [data-member-seat="3"]')!);
    expect(modeOf(root)).toBe("focus:0");
    expect(seen.camera).toBe(before);
    // The click was not swallowed: it reached the zone and the page (an inspect listens up there).
    expect(outside).toHaveBeenCalled();
  });

  it("a click on a seat chip of the focused field does not zoom out", () => {
    const root = mount("main", "focus");
    fireEvent.click(root.querySelector<HTMLElement>('[data-team-plate="near"] [data-member-seat="0"]')!);
    expect(modeOf(root)).toBe("focus:0");
  });
});

describe("Tag overview camera: back", () => {
  it("shows the rail only in a close-up, with Back to overview and a seat switcher", () => {
    const root = mount("main", "focus");
    const rail = root.querySelector("[data-camera-rail]");
    expect(rail).not.toBeNull();
    expect(rail!.querySelector("[data-camera-back]")?.textContent).toMatch(/back to overview/i);
    // On a phone the text is hidden: the button keeps its own name.
    expect(rail!.querySelector("[data-camera-back]")?.getAttribute("aria-label")).toBe("Back to overview");
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
