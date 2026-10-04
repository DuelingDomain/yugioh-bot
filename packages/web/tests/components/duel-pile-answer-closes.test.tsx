// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { TableShell } from "@/components/duel/table/table-shell";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { LOCATION_EXTRA, LOCATION_MZONE } from "@/components/duel/constants";

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

const SEAT = 0;
const summon = (extraPick: boolean): DuelPrompt => ({
  id: "extra-summon",
  seat: SEAT,
  kind: "choice",
  title: "Main Phase 1",
  context: { type: "action", phase: "main" },
  options: [
    { id: "summon:0", label: "Special Summon", controller: SEAT, location: LOCATION_EXTRA, sequence: 0 },
    ...(extraPick ? [] : [{ id: "to_ep", label: "End Phase" }]),
  ],
});
/** The prompt after the summon: materials on the field, or (`fromPile`) a card of the Extra Deck itself. */
const materials = (fromPile: boolean): DuelPrompt => ({
  id: fromPile ? "pick-from-extra" : "pick-materials",
  seat: SEAT,
  kind: "cards",
  title: "Select materials",
  min: 1,
  max: 1,
  options: [
    fromPile
      ? { id: "x0", label: "Extra card", controller: SEAT, location: LOCATION_EXTRA, sequence: 0 }
      : { id: "m0", label: "Material", controller: SEAT, location: LOCATION_MZONE, sequence: 0 },
  ],
});

const release: { current: () => void } = { current: () => {} };

/** A shell on a fixture whose prompt is the Extra Deck summon; answering swaps in the follow-up prompt (as the engine does). */
function Harness({ base, shell, after }: { base: TableFixtureState; shell: "table" | "tag"; after: DuelPrompt | null }) {
  const [prompt, setPrompt] = useState<DuelPrompt | null>(summon(false));
  const [revision, setRevision] = useState(base.room.engine?.revision ?? 0);
  // The live controller is busy while an answer is in flight, and the next prompt arrives during that time.
  const [busy, setBusy] = useState(false);
  release.current = () => setBusy(false);
  const engine = base.room.engine;
  if (!engine) throw new Error("fixture has no engine");
  const state: TableFixtureState = { ...base, room: { ...base.room, engine: { ...engine, prompt, revision } } };
  const fixture = useFixtureController(state, { reducedMotion: true });
  const controller = {
    ...fixture,
    busy,
    canAct: fixture.canAct && !busy,
    onAnswer: (answer: DuelAnswer) => {
      setPrompt(after);
      setRevision((value) => value + 1);
      setBusy(true);
      void answer;
    },
  };
  return shell === "table" ? (
    <TableShell controller={controller} />
  ) : (
    <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />
  );
}

const SHELLS = [
  { name: "TableShell", shell: "table" as const, base: FFA3_FIXTURES.states.main },
  { name: "TagShell", shell: "tag" as const, base: TAG_FIXTURES.states.main },
];

const viewer = () => document.body.querySelector("[data-pile-viewer]");

function openExtraPile(container: HTMLElement) {
  const open = container.querySelector("button[aria-label='Open Your Extra Deck']") as HTMLElement;
  expect(open).not.toBeNull();
  act(() => void fireEvent.click(open));
  expect(viewer()).not.toBeNull();
}

/** Click the usable card in the open viewer, then the action in its menu. */
function chooseSummon() {
  const card = viewer()?.querySelector("[data-pile-card][aria-label*='can be chosen']") as HTMLElement;
  expect(card).not.toBeNull();
  act(() => void fireEvent.click(card));
  const item = document.body.querySelector("[role='menu'] [role='menuitem']") as HTMLElement;
  expect(item).not.toBeNull();
  act(() => void fireEvent.click(item));
}

describe.each(SHELLS)("$name: an action chosen in the Extra Deck viewer", ({ shell, base }) => {
  it("closes the viewer so the materials on the field can be chosen", () => {
    const { container } = render(<Harness base={base} shell={shell} after={materials(false)} />);
    openExtraPile(container);
    chooseSummon();
    expect(viewer()).toBeNull();
    act(() => release.current());
    const material = container.querySelector("[data-zones^='0:4:0'][data-legal='true'], [data-zones*=' 0:4:0'][data-legal='true']");
    expect(material).not.toBeNull();
  });

  it("closes the viewer when the engine has no prompt for the player yet", () => {
    const { container } = render(<Harness base={base} shell={shell} after={null} />);
    openExtraPile(container);
    chooseSummon();
    expect(viewer()).toBeNull();
  });

  it("keeps the viewer when the next prompt chooses cards of that same pile", () => {
    const { container } = render(<Harness base={base} shell={shell} after={materials(true)} />);
    openExtraPile(container);
    chooseSummon();
    act(() => release.current());
    expect(viewer()).not.toBeNull();
    expect(viewer()?.querySelector("[data-pile-card][aria-label*='can be chosen']")).not.toBeNull();
  });
});
