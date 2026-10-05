// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureSet, TableFixtureState } from "@/components/duel/table/fixtures/common";
import { TableShell } from "@/components/duel/table/table-shell";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { LOCATION_MZONE } from "@/components/duel/constants";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The zone pick of an effect that Special Summons (owner bug: the zones glow during the chain intro). */
function placesState(base: TableFixtureState): TableFixtureState {
  const engine = base.room.engine!;
  const seat = base.room.mySeat ?? 0;
  const own = engine.seats.find((entry) => entry.seat === seat)!;
  const free = own.monsters.map((card, sequence) => (card ? null : sequence)).filter((sequence): sequence is number => sequence != null && sequence < 5);
  const prompt: DuelPrompt = {
    id: "zone-pick",
    seat,
    kind: "places",
    title: "Select a zone",
    min: 1,
    max: 1,
    options: free.map((sequence) => ({ id: `zone-${sequence}`, label: `Monster Zone ${sequence + 1}`, controller: seat, location: LOCATION_MZONE, sequence })),
  } as DuelPrompt;
  return { ...base, id: "zone-pick" as TableFixtureState["id"], room: { ...base.room, engine: { ...engine, prompt, chain: [] } } };
}

/** A chain response (a panel prompt) that offers a Quick Effect of the player's own monster. */
function responseState(base: TableFixtureState): TableFixtureState {
  const engine = base.room.engine!;
  const seat = base.room.mySeat ?? 0;
  const own = engine.seats.find((entry) => entry.seat === seat)!;
  const sequence = own.monsters.findIndex((card) => card != null);
  const card = own.monsters[sequence]!;
  const prompt: DuelPrompt = {
    id: "respond",
    seat,
    kind: "choice",
    title: "Respond?",
    context: { type: "chain", forced: false },
    cancelable: true,
    options: [
      { id: "activate", label: `Activate ${card.name}`, card, controller: seat, location: LOCATION_MZONE, sequence },
      { id: "pass", label: "Pass" },
    ],
  } as DuelPrompt;
  return { ...base, id: "respond" as TableFixtureState["id"], room: { ...base.room, engine: { ...engine, prompt } } };
}

type Format = "ffa3" | "ffa4" | "tag";
const SETS: Record<Format, TableFixtureSet> = { ffa3: FFA3_FIXTURES, ffa4: FFA4_FIXTURES, tag: TAG_FIXTURES };

function Shell({ format, state, revealed }: { format: Format; state: TableFixtureState; revealed: boolean }) {
  const controller = { ...useFixtureController(state, { reducedMotion: true }), revealed };
  return format === "tag"
    ? <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />
    : <TableShell controller={controller} />;
}

const answers = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => call[0] === "[table-preview] answer").map((call) => (call[1] as { answer: unknown }).answer);

function clickLegal(container: HTMLElement, selector = "[data-zones][data-legal='true']") {
  const zone = container.querySelector(selector) as HTMLElement | null;
  expect(zone).not.toBeNull();
  act(() => void fireEvent.click(zone!.querySelector("button") ?? zone!));
}

describe.each(["ffa3", "ffa4", "tag"] as const)("%s: field input while a centred prompt waits its reveal", (format) => {
  it("takes the first click on a glowing zone of a zone pick (no second click needed)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell format={format} state={placesState(SETS[format].states.main)} revealed={false} />);
    clickLegal(container);
    expect(answers(info)).toHaveLength(1);
    expect(answers(info)[0]).toMatchObject({ selected: [expect.stringMatching(/^zone-/)] });
  });

  it("takes the first click on a glowing card of a board card pick", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell format={format} state={SETS[format].states["target-pick"]} revealed={false} />);
    clickLegal(container);
    expect(answers(info)).toHaveLength(1);
  });

  it("does not light the field for a hidden panel prompt (it cannot be answered there yet)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell format={format} state={responseState(SETS[format].states.main)} revealed={false} />);
    expect(container.querySelector("[data-zones][data-legal='true']")).toBeNull();
    expect(container.querySelector("[data-table-shell]")?.getAttribute("data-can-act")).toBe("false");
    expect(answers(info)).toHaveLength(0);
  });

  it("lights the field for the panel prompt once it is revealed", () => {
    const { container } = render(<Shell format={format} state={responseState(SETS[format].states.main)} revealed />);
    expect(container.querySelector("[data-zones][data-legal='true']")).not.toBeNull();
  });
});
