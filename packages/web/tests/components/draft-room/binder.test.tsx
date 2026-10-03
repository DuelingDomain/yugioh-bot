// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Binder, type BinderProps } from "../../../src/components/draft/room/binder";
import { EMPTY_FILTER, type RoomCard, type RoomFilter } from "../../../src/components/draft/room/room-model";

const card = (id: number, name: string, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
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

describe("binder sorting", () => {
  const orders = [
    { order: "type", want: ["Omega effect", "Beta normal", "Delta effect", "Zulu spell", "Alpha trap", "Gamma fusion"] },
    { order: "oldest", want: ["Zulu spell", "Beta normal", "Alpha trap", "Omega effect", "Gamma fusion", "Delta effect"] },
    { order: "newest", want: ["Delta effect", "Gamma fusion", "Omega effect", "Alpha trap", "Beta normal", "Zulu spell"] },
    { order: "name", want: ["Alpha trap", "Beta normal", "Delta effect", "Gamma fusion", "Omega effect", "Zulu spell"] },
  ];

  it.each(orders)("renders the $order sequence", ({ order, want }) => {
    render(<Harness pool={pool} />);
    const sort = screen.getByRole("combobox", { name: "Sort" });
    expect(sort).toHaveValue("type");
    expect(sort).toBeEnabled();
    expect(within(sort).getAllByRole("option").map((el) => el.textContent)).toEqual(["Type", "Newest", "Oldest", "Name"]);
    fireEvent.change(sort, { target: { value: order } });
    expect(names()).toEqual(want);
    expect(pool.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reverses theme phases for newest and retains original pick numbers", () => {
    render(<Harness theme pool={[pool[1], pool[0], pool[4], card(7, "Xyz", { type: "Xyz Monster", frameType: "xyz" })]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "newest" } });
    const list = pickList();
    expect(names()).toEqual(["Xyz", "Gamma fusion", "Zulu spell", "Beta normal"]);
    const headings = within(list).getAllByRole("heading");
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveTextContent("Extra deck");
    expect(headings[1]).toHaveTextContent("Main deck");
    expect(Array.from(list.querySelectorAll(".no"), (el) => el.textContent)).toEqual(["Round 2", "Round 1", "Round 2", "Round 1"]);
  });

  it("keeps separate copies in pick order and groups them only for Type", () => {
    render(<Harness pool={[pool[1], pool[0], pool[1]]} />);
    expect(names()).toEqual(["Beta normal", "Zulu spell"]);
    expect(within(pickList()).getByText("×2")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "oldest" } });
    expect(names()).toEqual(["Beta normal", "Zulu spell", "Beta normal"]);
    expect(Array.from(pickList().querySelectorAll(".no"), (el) => el.textContent)).toEqual(["Pick 1", "Pick 2", "Pick 1"]);
    const rows = within(pickList()).getAllByRole("button");
    fireEvent.click(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-expanded", "true");
    expect(rows[2]).toHaveAttribute("aria-expanded", "false");
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
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "name" } });
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
  };

  it("shows the filtered empty message and clears every filter while retaining sort", () => {
    const { container } = render(<Harness phone pool={[pool[1], pool[0]]} initialFilter={filtered} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "newest" } });
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    expect(screen.getByText(/Showing 0 of 2/)).toBeInTheDocument();
    expect(names()).toEqual([]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".mix-bar i[data-kind]"), (el) => [el.dataset.kind, el.style.getPropertyValue("--n")])).toEqual([
      ["monster", "1"], ["spell", "1"], ["trap", "0"], ["extra", "0"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Zulu spell", "Beta normal"]);
    expect(screen.queryByText("No cards match these filters.")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(monsters()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: "Monster subtype" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("newest");
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
