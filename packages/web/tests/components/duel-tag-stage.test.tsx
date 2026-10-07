// @vitest-environment jsdom
import React, { useReducer } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SeatField } from "@/components/duel/field";
import { PromptCenter } from "@/components/duel/prompt-center";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableStateId } from "@/components/duel/table/fixtures/common";

afterEach(cleanup);

function Stage({ id, withPrompt = false, hub }: { id: TableStateId; withPrompt?: boolean; hub?: React.ReactNode }) {
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
        hub={hub}
        promptCenter={
          withPrompt ? (
            <PromptCenter
              prompt={controller.prompt}
              mySeat={controller.viewerSeat}
              active
              slug="tag-test"
              busy={false}
              draft={controller.draft}
              onSubmit={controller.onAnswer}
              menuOpen={false}
              chain={controller.engine.chain}
              aimLocked={false}
              reducedMotion
              revision={controller.engine.revision}
              battleStep={controller.engine.battleStep}
              revealed
              onInspectCard={() => {}}
              nameOf={controller.nameOf}
            />
          ) : undefined
        }
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

  const sides = (root: HTMLElement) => [0, 1, 2, 3].map((seat) => root.querySelector(`[data-seat-field="${seat}"]`)?.getAttribute("data-side"));

  it("gives data-side=you to the viewer's own field only; the partner reads partner", () => {
    expect(sides(mount("main"))).toEqual(["you", "opp", "partner", "opp"]);
  });

  it("gives a spectator no data-side=you", () => {
    expect(sides(mount("spectator"))).toEqual(["opp", "opp", "opp", "opp"]);
  });

  it("puts data-table-stage=tag on the data-tag-stage node", () => {
    expect(mount("main").querySelector("[data-tag-stage][data-table-stage='tag']")).not.toBeNull();
  });
});

describe("TagStage prompt centre", () => {
  it("answers a card pick on the board with the select bar", () => {
    const root = render(<Stage id="target-pick" withPrompt />).container;
    const bar = root.querySelector("[data-tag-stage] > div[class*='layer'] [data-place]");
    expect(bar).not.toBeNull();
    // The chain effects keep clear of the bar: it carries the obstacle marker (not data-prompt-panel, which the tooltip reads).
    expect(bar!.hasAttribute("data-prompt-surface")).toBe(true);
    expect(bar!.hasAttribute("data-prompt-panel")).toBe(false);
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

describe("TagStage chrome", () => {
  it("mounts the phase hub in its own slot on the board, only when it gets one", () => {
    expect(mount("main").querySelector("[data-phase-hub-slot]")).toBeNull();
    const { container } = render(<Stage id="main" hub={<nav data-testid="phases">phases</nav>} />);
    const slot = container.querySelector("[data-phase-hub-slot]") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.querySelector("[data-testid='phases']")).not.toBeNull();
  });

  it("gives every seat name plate the full name as its tooltip", () => {
    const root = mount("main");
    const pills = [...root.querySelectorAll<HTMLElement>("[class*='bpill']")].filter((node) => !/bpills/.test(node.className) && node.querySelector("span"));
    expect(pills.length).toBe(4);
    for (const pill of pills) {
      // The name span takes the pointer; the rest of the pill must not, or it blocks the fields under it.
      const name = pill.querySelector("span") as HTMLElement;
      expect(name.getAttribute("title")).toBeTruthy();
      expect(name.getAttribute("title")?.toUpperCase()).toContain(name.textContent ?? "?");
      expect(pill.hasAttribute("title")).toBe(false);
    }
  });

  it("keeps each team plate to one row: one team name, one chip per member, the full member name for screen readers", () => {
    const root = mount("main");
    const plates = root.querySelectorAll("[data-team-plate]");
    expect(plates.length).toBe(2);
    for (const plate of plates) {
      expect(plate.querySelectorAll("[data-team-name]").length).toBe(1);
      const chips = plate.querySelectorAll("[data-member-seat]");
      expect(chips.length).toBe(2);
      for (const chip of chips) expect(chip.querySelector("[class*='srOnly']")?.textContent?.length).toBeGreaterThan(0);
    }
  });
});
