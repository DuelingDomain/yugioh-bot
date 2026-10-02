// @vitest-environment jsdom
import React, { useReducer } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SeatField } from "@/components/duel/field";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableStateId } from "@/components/duel/table/fixtures/common";

afterEach(cleanup);

function Stage({ id }: { id: TableStateId }) {
  const state = TAG_FIXTURES.states[id];
  const controller = useFixtureController(state, { reducedMotion: true });
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
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

function mount(id: TableStateId) {
  return render(<Stage id={id} />).container;
}

describe("TagStage FX hooks", () => {
  it("keeps one data-lp-seat per seat, on the team member chips", () => {
    const root = mount("main");
    for (const seat of [0, 1, 2, 3]) {
      const nodes = root.querySelectorAll(`[data-lp-seat="${seat}"]`);
      expect(nodes.length).toBe(1);
      expect(nodes[0].closest("[data-member-seat]")?.getAttribute("data-member-seat")).toBe(String(seat));
    }
  });

  it("marks cards with data-zones and the art with data-card-art", () => {
    const root = mount("main");
    expect(root.querySelectorAll("[data-zones]").length).toBeGreaterThan(10);
    expect(root.querySelectorAll("[data-card-art]").length).toBeGreaterThan(5);
  });

  it("marks the own hand and the partner hand with data-hand-seat", () => {
    const root = mount("main");
    expect(root.querySelector('[data-hand-dock] [data-hand-seat="0"]')).not.toBeNull();
    expect(root.querySelector('[data-partner-hand][data-hand-seat="2"]')).not.toBeNull();
  });

  it("keeps rival fields on data-side=opp with a seat angle", () => {
    const root = mount("main");
    for (const seat of [1, 3]) {
      const field = root.querySelector(`[data-seat-field="${seat}"]`);
      expect(field?.getAttribute("data-side")).toBe("opp");
      expect(field?.getAttribute("data-seat-angle")).not.toBeNull();
    }
  });
});

describe("TagStage field relations", () => {
  const relations = (root: HTMLElement) =>
    [0, 1, 2, 3].map((seat) => root.querySelector(`[data-field-hold="${seat}"]`)?.getAttribute("data-relation"));

  it("tags every field with its relation so the Partner nib stays on the partner", () => {
    expect(relations(mount("target-pick"))).toEqual(["self", "opponent", "partner", "opponent"]);
  });

  it("calls every field other for a spectator", () => {
    expect(relations(mount("spectator"))).toEqual(["other", "other", "other", "other"]);
  });
});

describe("TagStage hands", () => {
  it("shows the partner hand with its caption", () => {
    const root = mount("main");
    const caption = root.querySelector("[data-partner-caption]");
    expect(caption?.textContent).toContain("Corvin\u2019s hand");
    expect(caption?.textContent).toContain("only your team sees it");
  });

  it("gives the partner no usable glow and no dimming", () => {
    const root = mount("main");
    const partner = root.querySelector("[data-partner-hand]");
    expect(partner).not.toBeNull();
    for (const card of partner!.querySelectorAll("[data-usable]")) expect(card.getAttribute("data-usable")).toBe("false");
    expect(partner!.querySelector('[data-state="usable"]')).toBeNull();
    expect(root.querySelector('[data-seat-field="2"]')?.getAttribute("data-usable")).toBe("false");
    expect(root.innerHTML).not.toMatch(/\b(dim|dimmed|disabledCard)\b/);
  });

  it("lights the usable cards of your own hand", () => {
    const root = mount("main");
    const usable = root.querySelectorAll('[data-hand-dock] [data-usable="true"]');
    expect(usable.length).toBeGreaterThanOrEqual(1);
    expect(root.querySelector('[data-hand-dock] [data-usable="true"]')?.textContent).toContain("Use");
  });

  it("hides every hand from a spectator", () => {
    const root = mount("spectator");
    expect(root.querySelector("[data-partner-hand]")).toBeNull();
    expect(root.querySelector("[data-hand-dock] [data-usable='true']")).toBeNull();
  });
});

describe("TagStage chain and response", () => {
  it("labels chain links by player and team", () => {
    const root = mount("chain-2");
    const links = [...root.querySelectorAll("[data-chain-link]")].map((node) => node.textContent ?? "");
    expect(links.length).toBe(2);
    expect(links[0]).toContain("C1");
    expect(links[0]).toContain("Mirelle");
    expect(links[1]).toContain("C2");
    expect(links[1]).toMatch(/Corvin Hale\s*◆\s*1B/);
  });

  it("shows the response window with the member states", () => {
    const root = mount("chain-2");
    const line = root.querySelector("[data-response-window]");
    expect(line?.textContent).toContain("Aster");
    expect(line?.textContent).toContain("choosing");
    expect(line?.textContent).toContain("waiting");
  });

  it("offers the rival choice on both rivals", () => {
    const root = mount("choose-opponent");
    const picks = root.querySelectorAll("[data-pick-bar] [data-seatpick]");
    expect(picks.length).toBe(2);
  });
});

describe("TagStage team loss", () => {
  it("cracks the lost team plate", () => {
    const root = mount("elimination");
    expect(root.textContent).toContain("TEAM DOWN");
  });
});
