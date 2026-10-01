// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PileViewer } from "@/components/duel/pile-viewer";
import { UsableGlow } from "@/components/duel/usable-glow";
import { usableGlowToneForPile } from "@/components/duel/usable-glow-model";
import { LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_REMOVED, zoneKey } from "@/components/duel/constants";

afterEach(cleanup);

const grave = (sequence: number, code: number): DuelCard => ({
  controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code, name: `Card ${code}`,
});

function viewer(legal: number[], selected: number[] = [], reducedMotion = false, cards = [grave(0, 11), grave(1, 12), grave(2, 13)]) {
  const keys = (seqs: number[]) => new Set(seqs.map((s) => zoneKey(0, cards[0].location, s)));
  return render(
    <PileViewer title="Your Graveyard" cards={cards} owner="you" open onClose={() => {}} onInspectCard={() => {}}
      reducedMotion={reducedMotion} legalKeys={keys(legal)} selectedKeys={keys(selected)} />,
  );
}

describe("usableGlowToneForPile", () => {
  it("uses the summoning-circle tone of the pile", () => {
    expect(usableGlowToneForPile([{ location: LOCATION_GRAVE }])).toBe("gy");
    expect(usableGlowToneForPile([{ location: LOCATION_REMOVED }])).toBe("banish");
    expect(usableGlowToneForPile([{ location: LOCATION_EXTRA }])).toBe("extra");
    expect(usableGlowToneForPile([])).toBe("extra");
  });
});

describe("UsableGlow", () => {
  it("renders the tone and a text tag, and stays still on request", () => {
    const { container } = render(<UsableGlow tone="banish" label="Use" still />);
    const glow = container.firstElementChild as HTMLElement;
    expect(glow.getAttribute("data-tone")).toBe("banish");
    expect(glow.getAttribute("data-still")).toBe("true");
    expect(glow.getAttribute("aria-hidden")).toBe("true");
    expect(glow.textContent).toBe("Use");
  });

  it("has no tag without a label", () => {
    const { container } = render(<UsableGlow tone="gy" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild?.hasAttribute("data-still")).toBe(false);
  });
});

describe("PileViewer usable cards", () => {
  it("gives only the legal cards a glow with a Use tag, in the pile's tone", () => {
    const { container } = viewer([1]);
    const glows = container.querySelectorAll("[data-tone]");
    expect(glows).toHaveLength(1);
    expect(glows[0].getAttribute("data-tone")).toBe("gy");
    expect(glows[0].textContent).toBe("Use");
    const legalButton = glows[0].closest("button") as HTMLElement;
    expect(legalButton.getAttribute("data-legal")).toBe("true");
    expect(legalButton.getAttribute("aria-label")).toContain("can be chosen");
    expect(container.firstElementChild?.getAttribute("data-has-legal")).toBe("true");
  });

  it("shows a selected card with a check and no glow", () => {
    const { container } = viewer([0, 1], [1]);
    const buttons = screen.getAllByRole("button", { pressed: true });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].querySelector("[data-tone]")).toBeNull();
    expect(buttons[0].querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(1);
  });

  it("marks the glow still when motion is reduced", () => {
    const { container } = viewer([2], [], true);
    expect(container.querySelector("[data-tone]")?.getAttribute("data-still")).toBe("true");
  });

  it("shows no glow and no dimming when no card is usable", () => {
    const { container } = viewer([]);
    expect(container.querySelectorAll("[data-tone]")).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute("data-has-legal")).toBe("false");
  });
});
