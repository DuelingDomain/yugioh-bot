// @vitest-environment jsdom
// The Deck Master chip on a phone rail shows the Summon button when the room provides the actions.
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { DmChip, DmChipActionsContext } from "@/components/duel/solid/dm-chip";
import { solidEngine } from "./helpers/solid-board";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("DmChip action", () => {
  const view = solidEngine({ domain: true }).seats[0];
  const option = { id: "summon-dm", label: "Summon" } as unknown as DuelPromptOption;

  it("has no button without a provider", () => {
    render(<DmChip seat={0} view={view} mine onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: "Summon" })).toBeNull();
  });

  it("shows Summon and submits the option with a provider", () => {
    const onChoose = vi.fn();
    render(
      <DmChipActionsContext.Provider value={{ actionsFor: () => [option], onChoose }}>
        <DmChip seat={0} view={view} mine onOpen={() => {}} />
      </DmChipActionsContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summon" }));
    expect(onChoose).toHaveBeenCalledWith(option);
  });
});
