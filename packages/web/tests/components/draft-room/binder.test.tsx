// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Binder, type BinderProps } from "../../../src/components/draft/room/binder";
import { DraftRoom } from "../../../src/components/draft/room/draft-room";
// With animations Off the pack ribbon holds the table for 1.3 s before the cards show, as in the mock.
configure({ asyncUtilTimeout: 4000 });

import { EMPTY_FILTER, type RoomCard, type RoomFilter } from "../../../src/components/draft/room/room-model";
import { useDraftStore } from "../../../src/lib/stores/draft-store";

vi.mock("../../../src/components/duel/fonts", () => ({ duelFontClasses: "" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const card = (id: number, name: string, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
  passcode: id + 100000,
  name,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "DARK",
  level: 4,
  effectText: "",
  imageUrl: `/c/${id}.jpg`,
  imageUrlSmall: `/c/${id}s.jpg`,
  ...over,
});

const pool = [
  card(1, "Zulu spell", { type: "Normal Spell Card", frameType: "spell" }),
  card(2, "Beta normal", { type: "Normal Monster", frameType: "normal" }),
  card(3, "Alpha trap", { type: "Normal Trap Card", frameType: "trap" }),
  card(4, "Omega effect", { level: 8 }),
  card(5, "Gamma fusion", { type: "Fusion Monster", frameType: "fusion", level: 6 }),
  card(6, "Delta effect"),
];

interface HarnessProps {
  pool?: RoomCard[];
  initialFilter?: RoomFilter;
  theme?: boolean;
  phone?: boolean;
}

function Harness({ pool = [], initialFilter = EMPTY_FILTER, theme = false, phone = false }: HarnessProps) {
  const [filter, onFilter] = useState<RoomFilter>(initialFilter);
  return (
    <Binder
      draftName="Friday cube"
      theme={theme}
      pool={pool}
      packCards={pool}
      filter={filter}
      onFilter={onFilter}
      pickConfig={{ theme, packSize: 2, cardsPerPlayer: 2 }}
      target={6}
      newId={null}
      phone={phone}
      onClose={() => {}}
      onPeek={() => {}}
    />
  );
}

const picks = () => screen.getByRole("complementary", { name: "Your picks" });
const pickList = () => picks().querySelector<HTMLElement>(".list")!;
const names = () => Array.from(pickList().querySelectorAll(".rn"), (el) => el.textContent);
const monsters = () => screen.getByRole("button", { name: /Monsters$/ });
const spells = () => screen.getByRole("button", { name: /Spells$/ });
const traps = () => screen.getByRole("button", { name: /Traps$/ });

afterEach(cleanup);

it("names the binder without tabs or a Taken by others control", () => {
  render(<Harness pool={pool} />);
  expect(within(picks()).getByRole("heading", { name: "Your picks" })).toBeInTheDocument();
  expect(screen.queryByText(/taken by others/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /taken by others/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  expect(names()).toHaveLength(6);
  expect(screen.getByText("6 of 6 picked")).toBeInTheDocument();
});

describe.each([390, 1100, 1440])("binder panel keyboard at %ipx", (width) => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("matchMedia", (query: string) => {
      const min = query.match(/min-width:\s*(\d+)px/);
      const max = query.match(/max-width:\s*(\d+)px/);
      return {
        matches: !!(min || max) && (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useDraftStore.setState({
      ...useDraftStore.getInitialState(),
      slug: "binder-keys",
      currentPack: [card(7, "Pack one"), card(8, "Pack two"), card(9, "Pack three")],
      myPool: pool,
      seats: [
        { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
        { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
      ],
      timerSeconds: 40,
      isMyTurn: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    useDraftStore.setState(useDraftStore.getInitialState());
  });

  const panelAttribute = width === 390 ? "data-sheet" : "data-binder";
  const openBinder = () => {
    fireEvent.click(screen.getByRole("button", { name: /Open your picks/ }));
    const room = screen.getByRole("dialog", { name: "Draft room" });
    if (width < 1440) expect(room).toHaveAttribute(panelAttribute, width === 390 ? "binder" : "");
    return room;
  };
  const renderRoom = () => render(
    <DraftRoom slug="binder-keys" name="Friday" config={{ packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6 }} isParticipant />,
  );

  if (width < 1440) {
    it("closes the binder on Escape from the sort control", async () => {
      const user = userEvent.setup();
      renderRoom();
      const room = openBinder();
      const sort = screen.getByRole("button", { name: "By type" });
      sort.focus();
      await user.tab({ shift: true });
      await user.tab();
      expect(sort).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(room).not.toHaveAttribute(panelAttribute);
    });

    it("closes the binder on Escape from empty search", async () => {
      const user = userEvent.setup();
      renderRoom();
      const room = openBinder();
      const search = screen.getByRole("searchbox");
      search.focus();
      expect(search).toHaveValue("");
      await user.keyboard("{Escape}");
      expect(search).not.toHaveFocus();
      expect(room).not.toHaveAttribute(panelAttribute);
    });

    it("clears search on the first Escape and closes the binder on the second", async () => {
      const user = userEvent.setup();
      renderRoom();
      const room = openBinder();
      const search = screen.getByRole("searchbox");
      await user.type(search, "beta");
      await waitFor(() => expect(names()).toEqual(["Beta normal"]));
      await user.keyboard("{Escape}");
      expect(search).toHaveValue("");
      expect(search).toHaveFocus();
      expect(names()).toEqual(["Omega effect", "Beta normal", "Delta effect", "Zulu spell", "Alpha trap", "Gamma fusion"]);
      expect(room).toHaveAttribute(panelAttribute, width === 390 ? "binder" : "");
      await user.keyboard("{Escape}");
      expect(search).not.toHaveFocus();
      expect(room).not.toHaveAttribute(panelAttribute);
    });
  } else {
    it.each(["search"])("keeps the selected card on Escape from the %s field", async (field) => {
      const user = userEvent.setup();
      renderRoom();
      await waitFor(() => expect(document.querySelector('.tcard[data-id="8"]')).toBeTruthy());
      fireEvent.keyDown(document, { key: "2" });
      const selected = document.querySelector('.tcard[data-id="8"]');
      expect(selected).toHaveAttribute("data-sel");
      openBinder();
      const input = screen.getByRole("searchbox");
      input.focus();
      if (field === "search") await user.type(input, "beta");
      await user.keyboard("{Escape}");
      expect(selected).toHaveAttribute("data-sel");
      expect(input).toHaveFocus();
      if (field === "search") {
        expect(input).toHaveValue("");
        await user.keyboard("{Escape}");
        expect(input).not.toHaveFocus();
        expect(selected).toHaveAttribute("data-sel");
      }
    });
  }

  it.each(["search"])("keeps number keys, arrows, Enter and / in the %s field without picking cards", async (field) => {
    const user = userEvent.setup();
    renderRoom();
    await waitFor(() => expect(document.querySelector('.tcard[data-id="8"]')).toBeTruthy());
    fireEvent.keyDown(document, { key: "2" });
    const selected = document.querySelector('.tcard[data-id="8"]');
    expect(selected).toHaveAttribute("data-sel");
    const room = openBinder();
    const input = screen.getByRole("searchbox");
    input.focus();
    await user.keyboard("123456789/{ArrowLeft}{ArrowRight}{ArrowUp}{ArrowDown}{Enter}");
    expect(input).toHaveFocus();
    if (field === "search") expect(input).toHaveValue("123456789/");
    expect(selected).toHaveAttribute("data-sel");
    if (width < 1440) expect(room).toHaveAttribute(panelAttribute, width === 390 ? "binder" : "");
    expect(fetch).not.toHaveBeenCalled();
    expect(useDraftStore.getState().currentPack.map((c) => c.id)).toEqual([7, 8, 9]);
    expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

const clickOrder = (name: "By type" | "In order") => fireEvent.click(screen.getByRole("button", { name }));

describe("binder sorting", () => {
  const orders = [
    { order: "By type", want: ["Omega effect", "Beta normal", "Delta effect", "Zulu spell", "Alpha trap", "Gamma fusion"] },
    { order: "In order", want: ["Zulu spell", "Beta normal", "Alpha trap", "Omega effect", "Gamma fusion", "Delta effect"] },
  ] as const;

  it.each(orders)("renders the $order sequence", ({ order, want }) => {
    render(<Harness pool={pool} />);
    const seg = screen.getByRole("group", { name: "Sort" });
    expect(within(seg).getAllByRole("button").map((el) => el.textContent)).toEqual(["By type", "In order"]);
    expect(within(seg).getByRole("button", { name: "By type" })).toHaveAttribute("aria-pressed", "true");
    clickOrder(order);
    expect(within(seg).getByRole("button", { name: order })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(want);
    expect(pool.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("no longer offers a Sort select", () => {
    render(<Harness pool={pool} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps theme phases in pick order and the original pick numbers", () => {
    render(<Harness theme pool={[pool[1], pool[0], pool[4], card(7, "Xyz", { type: "Xyz Monster", frameType: "xyz" })]} />);
    clickOrder("In order");
    const list = pickList();
    expect(names()).toEqual(["Beta normal", "Zulu spell", "Gamma fusion", "Xyz"]);
    const headings = within(list).getAllByRole("heading");
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveTextContent("Main deck");
    expect(headings[1]).toHaveTextContent("Extra deck");
    expect(Array.from(list.querySelectorAll(".no"), (el) => el.textContent)).toEqual(["Round 1", "Round 2", "Round 1", "Round 2"]);
  });

  it("keeps separate copies in pick order and groups them only by type", () => {
    render(<Harness pool={[pool[1], pool[0], pool[1]]} />);
    expect(names()).toEqual(["Beta normal", "Zulu spell"]);
    expect(within(pickList()).getByText("×2")).toBeInTheDocument();
    clickOrder("In order");
    expect(names()).toEqual(["Beta normal", "Zulu spell", "Beta normal"]);
    expect(Array.from(pickList().querySelectorAll(".no"), (el) => el.textContent)).toEqual(["Pick 1", "Pick 2", "Pick 1"]);
    const rows = within(pickList()).getAllByRole("button");
    fireEvent.click(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(rows[2]).toHaveAttribute("aria-expanded", "false");
  });

  it("puts Export YDK after the list as a quiet link, not in the bar", () => {
    const { container } = render(<Harness pool={pool} />);
    const exportBtn = screen.getByRole("button", { name: "Export YDK" });
    expect(container.querySelector(".bd-bar")).not.toContainElement(exportBtn);
    const list = container.querySelector(".list")!;
    expect(list.compareDocumentPosition(exportBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exportBtn.closest(".bd-foot")).not.toBeNull();
  });
});

describe("binder facet counts", () => {
  it("keeps whole-pool Spell and Trap counts with Monster selected", () => {
    render(<Harness pool={pool} />);
    fireEvent.click(monsters());
    expect(names()).toEqual(["Omega effect", "Beta normal", "Delta effect"]);
    expect(screen.getByText(/Showing 3 of 6/)).toBeInTheDocument();
    expect(spells().querySelector("b")).toHaveTextContent("1");
    expect(traps().querySelector("b")).toHaveTextContent("1");
  });

  it("keeps other attribute and level counts when an attribute is selected", () => {
    render(<Harness pool={[card(21, "Dark monster"), card(22, "Light monster", { attribute: "LIGHT", level: 8 })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Dark 1" }));
    expect(names()).toEqual(["Dark monster"]);
    expect(screen.getByText(/Showing 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No tribute, level 1 to 4: 1 monster" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 tributes, level 7 to 12: 1 monster" })).toBeInTheDocument();
  });
});

describe("binder monster subtype", () => {
  const monstersPool = [
    card(11, "Effect monster", { type: "Normal Monster", frameType: "effect" }),
    card(12, "Effect pendulum", { type: "Pendulum Effect Monster", frameType: "effect_pendulum" }),
    card(13, "Normal monster", { type: "Effect Monster", frameType: "normal" }),
    card(14, "Normal pendulum", { type: "Pendulum Normal Monster", frameType: "normal_pendulum" }),
    card(15, "Ritual monster", { type: "Ritual Effect Monster", frameType: "ritual" }),
    pool[0],
    pool[4],
  ];

  it("shows subtype toggles only when Monster is the sole selected kind", () => {
    render(<Harness pool={monstersPool} />);
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    fireEvent.click(spells());
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    fireEvent.click(monsters());
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    fireEvent.click(spells());
    const subtypes = screen.getByRole("group", { name: "Monster subtype" });
    expect(within(subtypes).getAllByRole("button").map((el) => el.textContent)).toEqual(["All monsters", "Effect", "Normal"]);
    expect(within(subtypes).getByRole("button", { name: "All monsters" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters by frame type, includes pendulums and keeps whole-list facet counts", () => {
    render(<Harness pool={monstersPool} />);
    fireEvent.click(monsters());
    expect(names()).toEqual(["Effect monster", "Effect pendulum", "Normal monster", "Normal pendulum", "Ritual monster"]);
    fireEvent.click(screen.getByRole("button", { name: "Effect" }));
    expect(names()).toEqual(["Effect monster", "Effect pendulum"]);
    expect(screen.getByText(/Showing 2 of 7/)).toBeInTheDocument();
    expect(monsters().querySelector("b")).toHaveTextContent("5");
    expect(spells().querySelector("b")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "No tribute, level 1 to 4: 5 monsters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark 7" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    expect(names()).toEqual(["Normal monster", "Normal pendulum"]);
    const subtypes = within(screen.getByRole("group", { name: "Monster subtype" }));
    expect(subtypes.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    expect(subtypes.getByRole("button", { name: "Effect" })).toHaveAttribute("aria-pressed", "false");
    expect(subtypes.getByRole("button", { name: "All monsters" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(subtypes.getByRole("button", { name: "All monsters" }));
    expect(names()).toEqual(["Effect monster", "Effect pendulum", "Normal monster", "Normal pendulum", "Ritual monster"]);
  });

  it.each(["add Spell", "turn off Monster"])("resets the subtype when kinds change: %s", (change) => {
    render(<Harness pool={monstersPool} />);
    fireEvent.click(monsters());
    fireEvent.click(screen.getByRole("button", { name: "Effect" }));
    fireEvent.click(change === "add Spell" ? spells() : monsters());
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    expect(pickList()).toHaveTextContent("Normal monster");
    fireEvent.click(change === "add Spell" ? spells() : monsters());
    expect(screen.getByRole("button", { name: "All monsters" })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toHaveLength(5);
  });

  it("clears a subtype when the parent changes kinds outside the binder", () => {
    const onFilter = vi.fn();
    const props: BinderProps = {
      draftName: "Friday cube",
      theme: false,
      pool: monstersPool, packCards: monstersPool,
      filter: { ...EMPTY_FILTER, kinds: new Set(["monster"]), monsterSubtype: "effect" },
      onFilter, pickConfig: { theme: false, packSize: 2, cardsPerPlayer: 2 },
      target: 6, newId: null, phone: false, onClose: () => {}, onPeek: () => {},
    };
    const { rerender } = render(<Binder {...props} />);
    expect(names()).toHaveLength(2);
    const mixed: RoomFilter = { ...props.filter, kinds: new Set(["monster", "spell"]) };
    rerender(<Binder {...props} filter={mixed} />);
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    expect(onFilter).toHaveBeenCalledWith({ ...mixed, monsterSubtype: "all" });
    rerender(<Binder {...props} filter={{ ...mixed, kinds: new Set(["monster"]), monsterSubtype: "all" }} />);
    expect(screen.getByRole("button", { name: "All monsters" })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toHaveLength(5);
  });
});

describe("binder empty filters", () => {
  const filtered: RoomFilter = {
    kinds: new Set(["monster"]),
    monsterSubtype: "effect",
    q: "normal",
    lvl: new Set(["low"]),
    attr: new Set(["DARK"]),
    arch: new Set(),
    type: new Set(),
  };

  it("shows the filtered empty message and clears every filter while retaining sort", () => {
    const { container } = render(<Harness phone pool={[pool[1], pool[0]]} initialFilter={filtered} />);
    clickOrder("In order");
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    expect(screen.getByText(/Showing 0 of 2/)).toBeInTheDocument();
    expect(names()).toEqual([]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".mix-bar i[data-kind]"), (el) => [el.dataset.kind, el.style.getPropertyValue("--n")])).toEqual([
      ["monster", "1"], ["spell", "1"], ["trap", "0"], ["extra", "0"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Beta normal", "Zulu spell"]);
    expect(screen.queryByText("No cards match these filters.")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(monsters()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In order" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(monsters());
    expect(screen.getByRole("button", { name: "All monsters" })).toHaveAttribute("aria-pressed", "true");
  });

  it("allows clearing active filters even with no picks", () => {
    render(<Harness initialFilter={filtered} />);
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText("No cards match these filters.")).not.toBeInTheDocument();
    expect(pickList()).toHaveTextContent("Your picks land here as you draft.");
  });
});

describe("binder archetype row", () => {
  const archPool = [
    card(1, "Magician of Dark Illusion", { archetype: "Dark Magician" }),
    card(2, "Blue-Eyes White Dragon", { archetype: "Blue-Eyes" }),
    card(3, "Dark Magic Attack", { type: "Normal Spell Card", frameType: "spell", archetype: "Dark Magician" }),
    card(4, "Plain card"),
  ];
  const chip = (name: RegExp) => screen.getByRole("button", { name });

  it("shows one chip per archetype with counts, and filters the list when switched on", () => {
    render(<Harness pool={archPool} />);
    expect(chip(/^Dark Magician 2$/)).toHaveAttribute("aria-pressed", "false");
    expect(chip(/^Blue-Eyes 1$/)).toBeInTheDocument();
    fireEvent.click(chip(/^Dark Magician 2$/));
    expect(chip(/^Dark Magician 2$/)).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Magician of Dark Illusion", "Dark Magic Attack"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(names()).toHaveLength(4);
  });

  it("hides the row when no card has an archetype", () => {
    render(<Harness pool={[card(1, "Plain")]} />);
    expect(screen.queryByText("Archetype")).not.toBeInTheDocument();
  });

  it("finds picks by archetype name in the search box", () => {
    render(<Harness pool={archPool} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "blue-eyes" } });
    return waitFor(() => expect(names()).toEqual(["Blue-Eyes White Dragon"]));
  });
});

describe("binder type rows", () => {
  // The kind buttons also say "Spells" and "Traps"; the facet rows label themselves in .fg > span.
  const rowLabels = () => [...document.querySelectorAll(".fg > span")].map((n) => n.textContent);
  const typed = [
    card(1, "Blue-Eyes White Dragon", { race: "Dragon" }),
    card(2, "Red-Eyes Black Dragon", { race: "Dragon" }),
    card(3, "Dark Magician", { race: "Spellcaster" }),
    card(4, "Mystical Space Typhoon", { type: "Spell Card", frameType: "spell", spellTrapType: "Quick-Play" }),
    card(5, "Magic Jammer", { type: "Trap Card", frameType: "trap", spellTrapType: "Counter" }),
  ];
  const chip = (name: RegExp) => screen.getByRole("button", { name });

  it("shows Monster type, Spells and Traps rows and filters by the chip", () => {
    render(<Harness pool={typed} />);
    expect(rowLabels()).toEqual(expect.arrayContaining(["Monster type", "Spells", "Traps"]));
    fireEvent.click(chip(/^Dragon 2$/));
    expect(chip(/^Dragon 2$/)).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Blue-Eyes White Dragon", "Red-Eyes Black Dragon"]);
    fireEvent.click(chip(/^Counter 1$/));
    expect(names()).toEqual(["Blue-Eyes White Dragon", "Red-Eyes Black Dragon", "Magic Jammer"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(names()).toHaveLength(5);
  });

  it("hides all three rows when the engine gave no types", () => {
    render(<Harness pool={[card(1, "Plain"), card(2, "Other")]} />);
    expect(rowLabels()).not.toEqual(expect.arrayContaining(["Monster type"]));
    expect(rowLabels()).not.toContain("Spells");
    expect(rowLabels()).not.toContain("Traps");
  });

  it("finds picks by monster type in the search box", () => {
    render(<Harness pool={typed} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "spellcaster" } });
    return waitFor(() => expect(names()).toEqual(["Dark Magician"]));
  });
});
