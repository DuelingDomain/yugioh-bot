import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { emptyHistory, ingestHistory, type HistoryContext } from "../../src/components/duel/history-model";
import { buildHistoryView, type HistoryEntry, type HistoryIconKind } from "../../src/components/duel/history-entries";
import {
  LOG_CATEGORIES,
  LOG_CATEGORY_LABEL,
  categoryForIcon,
  categoryForLogText,
  summonMethodForIcon,
  type LogCategory,
} from "../../src/components/duel/log-category";

// Every icon kind and the category it must land in. Typed as a full Record, so a new icon kind fails
// typecheck here as well as in log-category.ts.
const EXPECTED: Record<HistoryIconKind, LogCategory> = {
  normal: "summon",
  tribute: "summon",
  special: "summon",
  flip: "summon",
  fusion: "summon",
  synchro: "summon",
  xyz: "summon",
  link: "summon",
  ritual: "summon",
  pendulum: "summon",
  activate: "chain",
  chain: "chain",
  attack: "battle",
  direct: "battle",
  "lp-loss": "battle",
  destroy: "destroy",
  grave: "destroy",
  banish: "banish",
  set: "set",
  draw: "hand",
  hand: "hand",
  deck: "hand",
  "lp-gain": "system",
  position: "system",
  "flip-up": "system",
};

describe("log categories: history icons", () => {
  it.each(Object.entries(EXPECTED))("puts %s in %s", (icon, category) => {
    expect(categoryForIcon(icon as HistoryIconKind)).toBe(category);
  });

  it("uses each category and labels every one", () => {
    expect(new Set(Object.values(EXPECTED))).toEqual(new Set(LOG_CATEGORIES));
    for (const category of LOG_CATEGORIES) expect(LOG_CATEGORY_LABEL[category]).toBeTruthy();
  });

  it("falls back to system for an icon kind it does not know yet", () => {
    expect(categoryForIcon("reveal" as HistoryIconKind)).toBe("system");
  });

  it("names the card frame for each summon method", () => {
    expect(summonMethodForIcon("fusion")).toBe("fusion");
    expect(summonMethodForIcon("synchro")).toBe("synchro");
    expect(summonMethodForIcon("xyz")).toBe("xyz");
    expect(summonMethodForIcon("link")).toBe("link");
    expect(summonMethodForIcon("ritual")).toBe("ritual");
    expect(summonMethodForIcon("pendulum")).toBe("pendulum");
    for (const icon of ["normal", "tribute", "special", "flip"] as const) expect(summonMethodForIcon(icon)).toBe("monster");
    for (const icon of ["set", "activate", "attack", "draw", "banish", "flip-up"] as const) expect(summonMethodForIcon(icon)).toBeNull();
  });
});

describe("log categories: built entries", () => {
  const info = (code: number, name: string): DuelCardInfo =>
    ({ code, name, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "" });
  const ctx: HistoryContext = { revision: 1, turn: 2, turnSeat: 1, phase: "main1", seatCount: 2, cards: [] };
  const who = (seat: number | null) => (seat === 0 ? "You" : "Rival");

  function entries(events: DuelEvent[]): HistoryEntry[] {
    const view = buildHistoryView(ingestHistory(emptyHistory(), events, ctx).items, { mySeat: 0, who });
    return view.groups.flatMap((group) => group.rows).filter((row): row is HistoryEntry => row.type === "entry");
  }

  it("colours an opponent's hidden Set and draw without needing the card", () => {
    const list = entries([
      { id: 1, kind: "set", seat: 1, text: "Player 2 Sets a card", zone: { controller: 1, location: 0x08, sequence: 0 } },
      { id: 2, kind: "move", seat: 1, reason: "draw", text: "", zone: { controller: 1, location: 0x02, sequence: 0 } },
    ]);
    expect(list.map((entry) => [entry.title, categoryForIcon(entry.icon)])).toEqual([
      ["1 card", "hand"],
      ["Face-down card", "set"],
    ]);
  });

  it("keeps the Extra Deck method of each summon", () => {
    const kinds = ["fusion", "synchro", "xyz", "link", "ritual", "pendulum"] as const;
    const list = entries(kinds.map((summonKind, index) => ({
      id: index + 1, kind: "summon", seat: 0, card: info(index + 1, summonKind), summonKind, text: "",
    })));
    expect(list.map((entry) => summonMethodForIcon(entry.icon)).reverse()).toEqual([...kinds]);
    expect(new Set(list.map((entry) => categoryForIcon(entry.icon)))).toEqual(new Set(["summon"]));
  });
});

describe("log categories: text log lines", () => {
  // Lines exactly as duel-server engine.ts writes them.
  it.each<[string, LogCategory | null]>([
    ["Player 1 Normal Summons Junk Synchron", "summon"],
    ["Player 2 Special Summons Stardust Dragon", "summon"],
    ["Player 1 Flip Summons a face-down monster", "summon"],
    ["Player 2 Sets a card", "set"],
    ["Player 1 drew 2 card(s)", "hand"],
    ["You drew Pot of Greed, Raigeki", "hand"],
    ["Mirror Force is activating", "chain"],
    ["A chain link was negated", "chain"],
    ["Chain ended", "chain"],
    ["A monster declares an attack", "battle"],
    ["A monster declares a direct attack", "battle"],
    ["Player 2 takes 2500 damage", "battle"],
    ["Player 1 pays 1000 LP", "battle"],
    ["Player 1 gains 500 LP", "system"],
    ["Decode Talker moved", "system"],
    ["Player 2 shuffled their deck", "system"],
    ["Player 1 shuffled their hand", "system"],
    ["Confirmed Man-Eater Bug", "system"],
    ["Excavated Card Destruction", "system"],
    ["Coin toss: Heads, Tails", "system"],
    ["Dice roll: 4", "system"],
    // Their own look, or free text: no category.
    ["Turn 3 — Player 2", null],
    ["main1", null],
    ["draw", null],
    ["Player 1 wins (LP reached 0)", null],
    ["Draw (Both players reached 0 LP)", null],
    ["Add 1 Spellcaster monster from your Deck to your hand", null],
  ])("%s → %s", (text, category) => {
    expect(categoryForLogText(text)).toBe(category);
  });

  it("reads the raw text, so a display name cannot pose as a template", () => {
    // After name substitution this would read "Sets a card"-like; the raw engine text is what is matched.
    expect(categoryForLogText("Kaiba Sets a card")).toBeNull();
    expect(categoryForLogText("Player 1 Sets a card")).toBe("set");
  });
});
