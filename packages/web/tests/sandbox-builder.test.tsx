// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { SandboxBuilder } from "@/components/sandbox/builder";
import type { BuilderServices } from "@/components/sandbox/api";
import type { SandboxBuilderState } from "@/components/sandbox/board-model";
import { TYPE_EFFECT, TYPE_MONSTER, TYPE_SPELL, TYPE_XYZ } from "@/components/duel/constants";

function card(code: number, name: string, type: number): DeckCardInfo {
  return { code, name, description: "", type, attack: 2500, defense: 2100, level: 7, attribute: 1, race: "Spellcaster", alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3 };
}

const MAGICIAN = card(46986414, "Dark Magician", TYPE_MONSTER | TYPE_EFFECT);
const XYZ = card(2000001, "Number 39: Utopia", TYPE_MONSTER | TYPE_XYZ);
const MATERIAL = card(2000002, "Gagaga Magician", TYPE_MONSTER | TYPE_EFFECT);
const POT = card(55144522, "Pot of Greed", TYPE_SPELL);
const ALL = [MAGICIAN, XYZ, MATERIAL, POT];

const services: BuilderServices = {
  search: async (text) => {
    const key = text.trim().toLowerCase();
    return ALL.filter((c) => c.name.toLowerCase().includes(key));
  },
  lookup: async (codes) => ALL.filter((c) => codes.includes(c.code)),
  start: vi.fn(async () => ({ slug: "abc" })),
};

function setup() {
  const changes: SandboxBuilderState[] = [];
  render(<SandboxBuilder services={services} onChange={(state) => changes.push(state)} />);
  return { last: () => changes[changes.length - 1] };
}

async function quickAdd(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = screen.getByRole("combobox", { name: /search a card to add/i });
  await user.clear(box);
  await user.type(box, `${text}{Enter}`);
}

afterEach(() => cleanup());

describe("SandboxBuilder", () => {
  it("adds the top hit to the hand with Enter", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await quickAdd(user, "dark magician");
    await waitFor(() => expect(last().board.p0?.hand).toEqual([MAGICIAN.code]));
  });

  it("places a card in the first empty Monster Zone", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await user.click(screen.getByRole("button", { name: "Field" }));
    await quickAdd(user, "dark magician");
    await waitFor(() => expect(last().board.p0?.monsters?.[0]).toBe(MAGICIAN.code));
    expect(await screen.findByRole("button", { name: /Monster 1, Dark Magician/ })).toBeInTheDocument();
  });

  it("places the selected card in a clicked empty zone and refuses a wrong type", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    const box = screen.getByRole("combobox", { name: /search a card to add/i });
    await user.type(box, "pot of greed");
    await user.click(await screen.findByRole("button", { name: /^Pot of Greed/ }));
    expect(screen.getByTestId("armed-card")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Monster 2, empty/ }));
    expect(last()?.board.p0?.monsters).toBeUndefined();
    expect(screen.getAllByRole("status").some((el) => /Only monsters/.test(el.textContent ?? ""))).toBe(true);
    await user.click(screen.getByRole("button", { name: /^Spell\/Trap 3, empty/ }));
    await waitFor(() => expect(last().board.p0?.spells?.[2]).toBe(POT.code));
  });

  it("sets the position of a placed monster from the popover", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await user.click(screen.getByRole("button", { name: "Field" }));
    await quickAdd(user, "dark magician");
    await user.click(await screen.findByRole("button", { name: /Monster 1, Dark Magician/ }));
    const dialog = await screen.findByRole("dialog", { name: /Dark Magician options/ });
    await user.click(within(dialog).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(last().board.p0?.monsters?.[0]).toMatchObject({ card: MAGICIAN.code, pos: "set" }));
    expect(screen.getByRole("button", { name: /Monster 1, Dark Magician, Set/ })).toBeInTheDocument();
  });

  it("adds and removes an Xyz material", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await user.click(screen.getByRole("button", { name: "Field" }));
    await quickAdd(user, "utopia");
    await user.click(await screen.findByRole("button", { name: /Monster 1, Number 39/ }));
    const dialog = await screen.findByRole("dialog", { name: /Number 39: Utopia options/ });
    const input = within(dialog).getByLabelText(/add xyz material/i);
    await user.type(input, "gagaga{Enter}");
    await waitFor(() => expect(last().board.p0?.monsters?.[0]).toMatchObject({ card: XYZ.code, materials: [MATERIAL.code] }));
    await user.click(await within(dialog).findByRole("button", { name: /Remove material Gagaga Magician/ }));
    await waitFor(() => expect(last().board.p0?.monsters?.[0]).toBe(XYZ.code));
  });

  it("sets the life points of a seat", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    const lp = screen.getByLabelText("Life points of P0");
    await user.type(lp, "4000{Enter}");
    await waitFor(() => expect(last().board.p0?.lp).toBe(4000));
  });

  it("starts the duel with the board and goes to the table", async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    render(<SandboxBuilder services={services} onStarted={onStarted} />);
    await user.click(screen.getByRole("button", { name: /^Start$/ }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("abc"));
    expect(services.start).toHaveBeenCalled();
  });
});
