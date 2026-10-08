// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter, isStripPrompt, optionsOnBoard } from "@/components/duel/prompt-center";
import { usePromptDraft } from "@/components/duel/prompts";
import { materialHostNotes } from "@/components/duel/material-host";

const MZONE = 0x04;
const OVERLAY = 0x80;

const card = (code: number, name: string): DuelCardInfo => ({
  code, name, description: "Printed text.", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});

/** A material as the server sends it: under the Xyz in `hostSequence`, at place `place` under it. */
function material(index: number, place: number, name: string, hostSequence = 0, hostName = "Ryzeal Duo Drive", controller = 0): DuelPromptOption {
  return {
    id: `card:${index}`, label: name, card: card(1000 + index, name), controller, location: OVERLAY, sequence: place,
    host: { controller, location: MZONE, sequence: hostSequence, code: 7511613, name: hostName },
  };
}

const detach = (options: DuelPromptOption[], min = 2, max = 2): DuelPrompt => ({
  id: "detach", seat: 0, kind: "cards", title: "Select the Xyz Material(s) to detach", min, max, options,
});

const three = [material(0, 0, "Celtic Guardian"), material(1, 1, "Axe Raider"), material(2, 2, "Mystical Elf")];

afterEach(cleanup);

describe("Xyz materials in a pick", () => {
  it("are never answered on the board, even when their Xyz zone is drawn", () => {
    const prompt = detach(three);
    // The Xyz monster's own zone exists on the board; its materials must not count as clicks on it.
    expect(optionsOnBoard(prompt, (key) => key === `0:${MZONE}:0`)).toBe(false);
    expect(isStripPrompt(prompt)).toBe(true);
  });

  it("name the Xyz each material sits under only when there is more than one Xyz", () => {
    expect(materialHostNotes(three)).toEqual([null, null, null]);
    const mixed = [...three.slice(0, 2), material(2, 0, "Mystical Elf", 1, "Number 39: Utopia")];
    expect(materialHostNotes(mixed).map((note) => note?.detail)).toEqual([
      "Under Ryzeal Duo Drive", "Under Ryzeal Duo Drive", "Under Number 39: Utopia",
    ]);
  });

  it("tell two Xyz of one name apart by order, with no zone numbers", () => {
    const twin = [material(0, 0, "Celtic Guardian", 0), material(1, 0, "Axe Raider", 2), material(2, 1, "Mystical Elf", 2)];
    expect(materialHostNotes(twin).map((note) => note?.detail)).toEqual([
      "1 of 2 · Under Ryzeal Duo Drive", "2 of 2 · Under Ryzeal Duo Drive", "2 of 2 · Under Ryzeal Duo Drive",
    ]);
  });

  it("count the opponent's twins from the left of the 1v1 board, where their zones run backwards", () => {
    const far = [material(0, 0, "Celtic Guardian", 1, "Ryzeal Duo Drive", 1), material(1, 0, "Axe Raider", 3, "Ryzeal Duo Drive", 1)];
    // Zone 3 is drawn left of zone 1 on the far side, so it is the first.
    expect(materialHostNotes(far, { mySeat: 0 }).map((note) => note?.detail)).toEqual([
      "2 of 2 · Under Ryzeal Duo Drive", "1 of 2 · Under Ryzeal Duo Drive",
    ]);
    // On a table of 3 or 4 every row reads left to right by zone.
    expect(materialHostNotes(far, { mySeat: 0, nameOf: () => "Bo" }).map((note) => note?.detail)).toEqual([
      "1 of 2 · Under Ryzeal Duo Drive", "2 of 2 · Under Ryzeal Duo Drive",
    ]);
  });

  it("count twins right when both players' Xyz share one prompt, whatever the option order", () => {
    // Opponent zone 2, my Utopia zone 0, opponent zone 1: on the far side zone 2 is drawn left of zone 1.
    const mixed = [
      material(0, 0, "Celtic Guardian", 2, "Ryzeal Duo Drive", 1),
      material(1, 0, "Axe Raider", 0, "Number 39: Utopia", 0),
      material(2, 0, "Mystical Elf", 1, "Ryzeal Duo Drive", 1),
    ];
    expect(materialHostNotes(mixed, { mySeat: 0 }).map((note) => note?.detail)).toEqual([
      "1 of 2 · Under opponent's Ryzeal Duo Drive", "Under your Number 39: Utopia", "2 of 2 · Under opponent's Ryzeal Duo Drive",
    ]);
  });

  it("call an Xyz the viewer cannot see a face-down Xyz", () => {
    const hidden = (index: number, seat: number, name?: string): DuelPromptOption => {
      const option = material(index, 0, "Celtic Guardian", index, name ?? "x", seat);
      return { ...option, host: { ...option.host!, name: undefined } };
    };
    expect(materialHostNotes([hidden(0, 0), hidden(1, 0), material(2, 0, "Mystical Elf", 4, "Number 39: Utopia", 0)], { mySeat: 0 }).map((note) => note?.detail)).toEqual([
      "1 of 2 · Under a face-down Xyz", "2 of 2 · Under a face-down Xyz", "Under Number 39: Utopia",
    ]);
    expect(materialHostNotes([hidden(0, 1), material(1, 0, "Axe Raider", 2, "Number 39: Utopia", 0)], { mySeat: 0 }).map((note) => note?.detail)).toEqual([
      "Under opponent's face-down Xyz", "Under your Number 39: Utopia",
    ]);
  });

  it("name the owner when the Xyz have different controllers: your / opponent's in 1v1, the player's name on a big table", () => {
    const split = [material(0, 0, "Celtic Guardian", 0, "Ryzeal Duo Drive", 0), material(1, 0, "Axe Raider", 0, "Ryzeal Duo Drive", 1)];
    expect(materialHostNotes(split, { mySeat: 0 }).map((note) => note?.detail)).toEqual([
      "Under your Ryzeal Duo Drive", "Under opponent's Ryzeal Duo Drive",
    ]);
    const names = ["Ann", "Bo", "Cy"];
    expect(materialHostNotes(split, { mySeat: 1, nameOf: (seat) => names[seat] }).map((note) => note?.detail)).toEqual([
      "Under Ann's Ryzeal Duo Drive", "Under your Ryzeal Duo Drive",
    ]);
  });

  it("say Xyz material when one Xyz's materials share the prompt with other cards", () => {
    const plain = { id: "card:9", label: "Dark Magician", card: card(46986414, "Dark Magician"), controller: 0, location: MZONE, sequence: 4 } as DuelPromptOption;
    expect(materialHostNotes([...three.slice(0, 2), plain]).map((note) => note?.detail)).toEqual(["Xyz material", "Xyz material", undefined]);
    // Materials alone (one Xyz) need no line.
    expect(materialHostNotes(three)).toEqual([null, null, null]);
  });

  it("show as a card list; picking two and Confirm answers with those materials", () => {
    const prompt = detach(three);
    const onSubmit = vi.fn();
    function Panel() {
      const draft = usePromptDraft(prompt);
      return (
        <div data-testid="board">
          <div data-zones={`0:${MZONE}:0`} />
          <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
            menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} />
        </div>
      );
    }
    render(<Panel />);
    // The tiles carry the card name; the board bar ("0/2 selected" with no way to pick) is not shown.
    const tiles = screen.getAllByRole("button", { name: /^\d\. / });
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual(["1. Celtic Guardian", "2. Axe Raider", "3. Mystical Elf"]);
    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[2]);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith({ selected: ["card:0", "card:2"] });
  });

  it("list one at a time in a select/unselect (toggle) pick too", () => {
    const prompt: DuelPrompt = {
      id: "toggle", seat: 0, kind: "toggle", title: "Select the Xyz Material(s) to detach", min: 2, max: 2, finishable: false,
      options: three.map((option) => ({ ...option, id: option.id.replace("card", "select"), selected: false })),
    };
    const onSubmit = vi.fn();
    function Panel() {
      const draft = usePromptDraft(prompt);
      return (
        <div>
          <div data-zones={`0:${MZONE}:0`} />
          <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
            menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} />
        </div>
      );
    }
    render(<Panel />);
    const tiles = screen.getAllByRole("button", { name: /^\d\. / });
    expect(tiles).toHaveLength(3);
    fireEvent.click(tiles[1]);
    expect(onSubmit).toHaveBeenCalledWith({ choice: "select:1" });
  });
});
