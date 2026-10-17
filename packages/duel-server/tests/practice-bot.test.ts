import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";
import { validateDeck } from "../src/deck-legality.js";
import {
  AXE_RAIDER,
  PracticeBotError,
  buildPracticeBotDeck,
  choosePracticeBotAnswer,
} from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

function info(code: number): DuelCardInfo {
  return {
    code,
    name: `Card ${code}`,
    description: "",
    type: 1,
    attack: 1000,
    defense: 1000,
    level: 4,
    attribute: 1,
    race: "warrior",
  };
}

function prompt(partial: Partial<DuelPrompt> & Pick<DuelPrompt, "kind" | "title">): DuelPrompt {
  return {
    id: "p1",
    seat: 1,
    options: [],
    ...partial,
  };
}

describe("practice bot preset decks", () => {
  it("builds a deterministic 40-card EARTH Normal beatdown that the engine accepts", () => {
    const first = buildPracticeBotDeck("normal", DATA);
    const second = buildPracticeBotDeck("normal", DATA);
    expect(first.main).toHaveLength(40);
    expect(first.extra).toEqual([]);
    expect(first.side).toEqual([]);
    expect(first.deckMaster).toBeUndefined();
    expect(first).toEqual(second);
    expect(() => validateDeck("normal", first, DATA)).not.toThrow();
  });

  it("builds 60 unique low-level EARTH Normal Monsters plus a separate Axe Raider master", () => {
    const first = buildPracticeBotDeck("domain", DATA);
    const second = buildPracticeBotDeck("domain", DATA);
    expect(first.deckMaster).toBe(AXE_RAIDER);
    expect(first.main).toHaveLength(60);
    expect(new Set(first.main).size).toBe(60);
    expect(first.main).not.toContain(AXE_RAIDER);
    expect(first.extra).toEqual([]);
    expect(first.side).toEqual([]);
    expect(first).toEqual(second);
    expect(() => validateDeck("domain", first, DATA)).not.toThrow();
    const db = new Database(`${DATA}/cards.cdb`, { readonly: true });
    try {
      const playable = db.prepare<[string], { count: number }>(
        "select count(*) as count from datas where id in (select value from json_each(?)) and type=17 and level<=4 and attribute=1",
      ).get(JSON.stringify(first.main));
      expect(playable?.count).toBe(60);
    } finally {
      db.close();
    }
  });
});

describe("practice bot prompt choices", () => {
  it.each([
    ["cards", { selected: ["card:0", "card:1"] }],
    ["sum", { selected: ["card:0", "card:1"] }],
    ["order", { selected: ["card:0", "card:1"] }],
    ["toggle", { choice: "card:0" }],
    ["counters", { counts: { "card:0": 1, "card:1": 1 } }],
  ] as const)("keeps required %s options of a leaving seat", (kind, answer) => {
    const required = prompt({ kind, title: "Required selection", min: 2, max: 2, target: 2, sumMode: "exact",
      options: [0, 1].map((index) => ({ id: `card:${index}`, label: "Required card", controller: 2, values: [1], max: 1 })) });
    expect(choosePracticeBotAnswer(required, { table: { living: [0, 1], eliminated: [] } })).toEqual(answer);
  });

  it("keeps a partial leaving-seat list when every card is required", () => {
    const required = prompt({ kind: "cards", title: "Required selection", min: 2, max: 2,
      options: [{ id: "card:0", label: "Own card", controller: 1 }, { id: "card:1", label: "Leaving card", controller: 2 }] });
    expect(choosePracticeBotAnswer(required, { table: { living: [0, 1], eliminated: [] } })).toEqual({ selected: ["card:0", "card:1"] });
  });

  it("summons then battles and never shuffles or toggles idle positions", () => {
    const idle = prompt({
      kind: "choice",
      title: "Choose an action",
      options: [
        { id: "pos:0", label: "Change position" },
        { id: "shuffle", label: "Shuffle hand" },
        { id: "summon:0", label: "Normal Summon" },
        { id: "to_bp", label: "Enter Battle Phase" },
        { id: "to_ep", label: "End Phase" },
      ],
    });
    expect(choosePracticeBotAnswer(idle)).toEqual({ choice: "summon:0" });

    const stuck = prompt({
      kind: "choice",
      title: "Choose an action",
      options: [
        { id: "pos:0", label: "Change position" },
        { id: "shuffle", label: "Shuffle hand" },
        { id: "to_ep", label: "End Phase" },
      ],
    });
    expect(choosePracticeBotAnswer(stuck)).toEqual({ choice: "to_ep" });

    const battle = prompt({
      kind: "choice",
      title: "Choose a battle action",
      options: [
        { id: "activate:0", label: "Activate" },
        { id: "attack:0", label: "Attack" },
        { id: "to_m2", label: "Enter Main Phase 2" },
      ],
    });
    expect(choosePracticeBotAnswer(battle)).toEqual({ choice: "attack:0" });
  });

  it("passes optional yes/no and chains, and answers mandatory ones", () => {
    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "choice",
          title: "Apply the effect?",
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        }),
      ),
    ).toEqual({ choice: "no" });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "choice",
          title: "Select a chain link or pass",
          cancelable: true,
          min: 0,
          max: 1,
          options: [{ id: "card:0", label: "Trap" }],
        }),
      ),
    ).toEqual({ cancel: true });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "choice",
          title: "Select a mandatory effect",
          min: 1,
          max: 1,
          options: [
            { id: "card:0", label: "First" },
            { id: "card:1", label: "Second" },
          ],
        }),
      ),
    ).toEqual({ choice: "card:0" });
  });

  it("finishes optional toggles instead of spinning select/unselect", () => {
    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "toggle",
          title: "Select or unselect a card",
          min: 0,
          max: 2,
          finishable: true,
          options: [
            { id: "select:0", label: "A", selected: false },
            { id: "unselect:0", label: "B", selected: true },
          ],
        }),
      ),
    ).toEqual({ finish: true });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "toggle",
          title: "Select a card",
          min: 1,
          max: 1,
          options: [
            { id: "unselect:0", label: "Already", selected: true },
            { id: "select:0", label: "Next", selected: false },
          ],
        }),
      ),
    ).toEqual({ choice: "select:0" });
  });

  it("tributes the fewest cards that meet weighted release, not every monster", () => {
    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "tribute",
          title: "Select tribute(s)",
          min: 2,
          max: 3,
          options: [
            { id: "card:0", label: "One", values: [1] },
            { id: "card:1", label: "Two", values: [2] },
            { id: "card:2", label: "One more", values: [1] },
          ],
        }),
      ),
    ).toEqual({ selected: ["card:1"] });
  });

  it("selects a SELECT_SUM subset using packed alternatives and required cards", () => {
    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "sum",
          title: "Select cards totaling 1",
          min: 1,
          max: 1,
          target: 1,
          options: [{ id: "card:0", label: "Packed", values: [1, 2] }],
        }),
      ),
    ).toEqual({ selected: ["card:0"] });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "sum",
          title: "Select cards totaling 5",
          min: 3,
          max: 3,
          target: 5,
          mandatory: ["must:0"],
          options: [
            { id: "must:0", label: "Required", values: [1], selected: true },
            { id: "card:0", label: "Two", values: [2] },
            { id: "card:1", label: "Nine", values: [9] },
            { id: "card:2", label: "Two or three", values: [2, 3] },
          ],
        }),
      ),
    ).toEqual({ selected: ["card:0", "card:2"] });
  });

  it("announces a search-permitted card and refuses a canned passcode", () => {
    expect(() =>
      choosePracticeBotAnswer(prompt({ kind: "announce-card", title: "Announce a card", min: 1, max: 1 })),
    ).toThrow(PracticeBotError);

    expect(
      choosePracticeBotAnswer(prompt({ kind: "announce-card", title: "Announce a card", min: 1, max: 1 }), {
        permittedCards: [info(89631139), info(46986414)],
      }),
    ).toEqual({ cardCode: 89631139 });
  });

  it("picks face-up attack, first legal places, original order, and counter totals", () => {
    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "choice",
          title: "Select a position",
          options: [
            { id: "pos:2", label: "Face-down Defence" },
            { id: "pos:1", label: "Face-up Attack" },
          ],
        }),
      ),
    ).toEqual({ choice: "pos:1" });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "places",
          title: "Select a zone",
          min: 1,
          max: 1,
          options: [
            { id: "place:0", label: "P1 Monster Zone 1" },
            { id: "place:1", label: "P1 Monster Zone 2" },
          ],
        }),
      ),
    ).toEqual({ selected: ["place:0"] });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "order",
          title: "Choose the card order",
          min: 2,
          max: 2,
          options: [
            { id: "card:0", label: "First" },
            { id: "card:1", label: "Second" },
          ],
        }),
      ),
    ).toEqual({ selected: ["card:0", "card:1"] });

    expect(
      choosePracticeBotAnswer(
        prompt({
          kind: "counters",
          title: "Remove 3 counters",
          min: 3,
          max: 3,
          target: 3,
          options: [
            { id: "card:0", label: "A", max: 2 },
            { id: "card:1", label: "B", max: 2 },
          ],
        }),
      ),
    ).toEqual({ counts: { "card:0": 2, "card:1": 1 } });
  });
});
