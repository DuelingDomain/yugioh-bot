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
import { TAG_DOM } from "@/components/duel/tag/live-tag";
import { initialRoofCamera, roofReducer } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableStateId } from "@/components/duel/table/fixtures/common";

afterEach(cleanup);

function Stage({ id, withPrompt = false }: { id: TableStateId; withPrompt?: boolean }) {
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

describe("Tag hand labels", () => {
  it("has exactly one group named Your hand", () => {
    const root = mount("main");
    const groups = [...root.querySelectorAll('[role="group"]')].filter((node) => node.getAttribute("aria-label") === TAG_DOM.handLabel);
    expect(groups.length).toBe(1);
    expect(groups[0].hasAttribute("data-hand-dock")).toBe(true);
  });

  it("names the partner hand clearly and never calls it Your hand", () => {
    const root = mount("main");
    const partner = root.querySelector("[data-partner-hand]");
    expect(partner?.getAttribute("role")).toBe("group");
    expect(partner?.getAttribute("aria-label")).toBe("Corvin\u2019s hand (partner)");
    expect(partner?.getAttribute("aria-label")).not.toContain("Your hand");
  });

  it("names each own-hand card by the plain card name and keeps usable state apart", () => {
    const root = mount("main");
    const buttons = [...root.querySelectorAll<HTMLElement>("[data-hand-dock] button[data-zones]")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const name = button.getAttribute("aria-label")!;
      expect(name).not.toMatch(/can be used/i);
      expect(button.hasAttribute("aria-description")).toBe(button.getAttribute("data-usable") === "true");
    }
    const usable = root.querySelector('[data-hand-dock] [data-usable="true"]');
    expect(usable?.getAttribute("aria-description")).toBe("Can be used");
  });

  it("gives partner cards the plain name too", () => {
    const root = mount("main");
    for (const button of root.querySelectorAll("[data-partner-hand] button")) {
      expect(button.getAttribute("aria-label")).not.toMatch(/can be used/i);
      expect(button.hasAttribute("aria-description")).toBe(false);
    }
  });
});

describe("Tag hand relations", () => {
  it("marks one self hand and one partner hand, and no hand as rival", () => {
    const root = mount("main");
    const hands = [...root.querySelectorAll("[data-hand-seat]")];
    expect(hands.filter((node) => node.getAttribute("data-relation") === "self").length).toBe(1);
    expect(hands.filter((node) => node.getAttribute("data-relation") === "partner").length).toBe(1);
    // A rival hand is never drawn (hidden information), so no hand may carry another relation.
    expect(hands.length).toBe(2);
  });

  it("keeps data-side=you for the own hand only, so own-hand locators skip the partner", () => {
    const root = mount("main");
    const own = root.querySelectorAll("[data-hand-seat][data-side='you']");
    expect(own.length).toBe(1);
    expect(own[0].getAttribute("data-hand-seat")).toBe("0");
    expect(root.querySelector("[data-partner-hand]")?.hasAttribute("data-side")).toBe(false);
  });

  it("draws no hand for a spectator", () => {
    const root = mount("spectator");
    expect(root.querySelectorAll("[data-hand-seat]").length).toBe(0);
    expect(root.querySelector(`[role="group"][aria-label="${TAG_DOM.handLabel}"]`)).toBeNull();
  });
});
