import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { emptyHistory, ingestHistory, type HistoryContext } from "../../src/components/duel/history-model";
import { buildHistoryView, type HistoryEntry, type HistoryIconKind } from "../../src/components/duel/history-entries";
import {
  LOG_CATEGORIES,
  LOG_CATEGORY_LABEL,
  categoriesForLog,
  categoryForEntry,
  categoryForIcon,
  categoryForLogText,
  summonMethodForIcon,
  summonMethodForLogText,
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
  grave: "graveyard",
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
    // "material" has no icon of its own: it comes from the action label (categoryForEntry).
    expect(new Set([...Object.values(EXPECTED), "material"])).toEqual(new Set(LOG_CATEGORIES));
    for (const category of LOG_CATEGORIES) expect(LOG_CATEGORY_LABEL[category]).toBeTruthy();
    expect(LOG_CATEGORY_LABEL.destroy).toBe("Destroyed");
    expect(LOG_CATEGORY_LABEL.graveyard).toBe("Sent to Graveyard");
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

  it("splits Tributes and materials out of the Graveyard sends", () => {
    const tribute = entries([
      { id: 1, kind: "move", seat: 0, reason: "send", card: info(9, "Fodder"), zone: { controller: 0, location: 0x10, sequence: 0 }, from: { controller: 0, location: 0x04, sequence: 0 }, text: "" },
      { id: 2, kind: "move", seat: 0, reason: "summon", card: info(10, "Big"), zone: { controller: 0, location: 0x04, sequence: 1 }, text: "" },
      { id: 3, kind: "summon", seat: 0, card: info(10, "Big"), summonKind: "tribute", text: "" },
    ]);
    expect(tribute.map((entry) => [entry.verb, categoryForEntry(entry)])).toEqual([
      ["Tribute Summon", "summon"],
      ["Tributed", "material"],
    ]);
    const synchro = entries([
      { id: 1, kind: "move", seat: 0, reason: "send", card: info(21, "Tuner"), zone: { controller: 0, location: 0x10, sequence: 0 }, text: "" },
      { id: 2, kind: "move", seat: 0, reason: "summon", card: info(23, "Boss"), zone: { controller: 0, location: 0x04, sequence: 0 }, text: "" },
      { id: 3, kind: "summon", seat: 0, card: info(23, "Boss"), summonKind: "synchro", text: "" },
    ]);
    expect(synchro.map((entry) => [entry.verb, categoryForEntry(entry)])).toEqual([
      ["Synchro Summon", "summon"],
      ["Used as material", "material"],
    ]);
    // A plain send stays a Graveyard send, and other entries keep their icon's category.
    const [sent] = entries([{ id: 1, kind: "move", seat: 1, reason: "send", card: info(3, "Sent"), zone: { controller: 1, location: 0x10, sequence: 0 }, text: "" }]);
    expect(categoryForEntry(sent!)).toBe("graveyard");
    expect(categoryForEntry({ icon: "banish", verb: "Used as material" })).toBe("material");
    expect(categoryForEntry({ icon: "synchro", verb: "Synchro Summon" })).toBe("summon");
  });

  it("keeps sends and discards separate from destructions", () => {
    const list = entries([
      { id: 1, kind: "move", seat: 1, reason: "send", card: info(1, "Sent"), zone: { controller: 1, location: 0x10, sequence: 0 }, text: "" },
      { id: 2, kind: "move", seat: 1, reason: "discard", card: info(2, "Discarded"), zone: { controller: 1, location: 0x10, sequence: 1 }, text: "" },
      { id: 3, kind: "destroy", seat: 1, card: info(3, "Destroyed"), zone: { controller: 1, location: 0x04, sequence: 0 }, text: "" },
    ]).reverse();
    expect(list.map((entry) => [entry.verb, categoryForEntry(entry)])).toEqual([
      ["Sent to Graveyard", "graveyard"],
      ["Discard", "graveyard"],
      ["Destroyed", "destroy"],
    ]);
  });
});

describe("log categories: text log lines", () => {
  // Lines exactly as duel-server engine.ts and log-lines.ts write them.
  it.each<[string, LogCategory | null]>([
    ["Player 1 Normal Summons Junk Synchron", "summon"],
    ["Player 1 Tribute Summons Summoned Skull", "summon"],
    ["Player 2 Special Summons Stardust Dragon", "summon"],
    ["Player 2 Special Summons a face-down monster", "summon"],
    ["Player 1 Flip Summons Man-Eater Bug", "summon"],
    ["Player 1 Fusion Summons Flame Swordsman", "summon"],
    ["Player 2 Synchro Summons Stardust Dragon", "summon"],
    ["Player 1 Xyz Summons Number 39: Utopia", "summon"],
    ["Player 1 Link Summons Decode Talker", "summon"],
    ["Player 2 Ritual Summons Paladin of White Dragon", "summon"],
    ["Player 1 Pendulum Summons Odd-Eyes Pendulum Dragon", "summon"],
    ["Stardust Dragon was destroyed", "destroy"],
    ["Stardust Dragon was destroyed and banished", "destroy"],
    ["Raigeki was sent to the Graveyard", "graveyard"],
    ["Pot of Greed was discarded", "graveyard"],
    ["Decode Talker was banished", "banish"],
    ["Pot of Greed was added to Player 1's hand", "hand"],
    ["Player 2 added a card to their hand", "hand"],
    ["You added Pot of Greed to your hand", "hand"],
    ["Man-Eater Bug returned to Player 2's hand", "hand"],
    ["A face-down card returned to Player 1's hand", "hand"],
    ["Mystical Space Typhoon returned to your hand", "hand"],
    ["Stardust Dragon returned to the Extra Deck", "hand"],
    ["Pot of Greed returned to the Deck", "hand"],
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
    // Older engine text, still in stored replays.
    ["Decode Talker moved", "system"],
    ["Player 1 Flip Summons a face-down monster", "summon"],
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

  it("does not let a card name pose as a template", () => {
    expect(categoryForLogText("Stardust Dragon was destroyed by Mirror Force")).toBeNull();
    expect(categoryForLogText("Pot of Greed was discarded by Card Destruction")).toBeNull();
    expect(categoryForLogText("Player 1 Summons Destroyer")).toBeNull();
  });

  it("names the card frame of a summon line", () => {
    expect(summonMethodForLogText("Player 2 Synchro Summons Stardust Dragon")).toBe("synchro");
    expect(summonMethodForLogText("Player 1 Xyz Summons Number 39: Utopia")).toBe("xyz");
    expect(summonMethodForLogText("Player 1 Fusion Summons Flame Swordsman")).toBe("fusion");
    expect(summonMethodForLogText("Player 1 Link Summons Decode Talker")).toBe("link");
    expect(summonMethodForLogText("Player 1 Ritual Summons Paladin of White Dragon")).toBe("ritual");
    expect(summonMethodForLogText("Player 1 Pendulum Summons Odd-Eyes Pendulum Dragon")).toBe("pendulum");
    for (const verb of ["Normal", "Tribute", "Special", "Flip"]) expect(summonMethodForLogText(`Player 1 ${verb} Summons Junk Synchron`)).toBe("monster");
    expect(summonMethodForLogText("Player 2 Sets a card")).toBeNull();
    expect(summonMethodForLogText("Kaiba Synchro Summons Stardust Dragon")).toBeNull();
  });
});

describe("log categories: a whole Text log", () => {
  it("mutes the Graveyard sends directly above a summon that takes materials", () => {
    expect(categoriesForLog([
      "Fodder was sent to the Graveyard",
      "Player 2 Tribute Summons Dark Magician",
    ])).toEqual(["material", "summon"]);
    expect(categoriesForLog([
      "Raigeki was sent to the Graveyard",
      "Junk Synchron is activating",
      "Junk Synchron was sent to the Graveyard",
      "Cyber Dragon was sent to the Graveyard",
      "Player 1 Synchro Summons Stardust Dragon",
    ])).toEqual(["graveyard", "chain", "material", "material", "summon"]);
    for (const method of ["Fusion", "Link", "Ritual"]) {
      expect(categoriesForLog(["A was sent to the Graveyard", `Player 1 ${method} Summons B`])[0]).toBe("material");
    }
  });

  it("leaves a send that another line separates from the summon, and summons that take no Graveyard materials", () => {
    // A cost paid for an activation, then the summon it leads to.
    expect(categoriesForLog([
      "Cost was sent to the Graveyard",
      "Monster Reborn is activating",
      "Player 1 Special Summons Stardust Dragon",
    ])).toEqual(["graveyard", "chain", "summon"]);
    for (const verb of ["Normal", "Special", "Flip", "Xyz", "Pendulum"]) {
      expect(categoriesForLog(["A was sent to the Graveyard", `Player 1 ${verb} Summons B`])[0]).toBe("graveyard");
    }
    // A destroyed card is never material, and a send below the summon is not either.
    expect(categoriesForLog([
      "A was destroyed",
      "Player 1 Synchro Summons B",
      "C was sent to the Graveyard",
    ])).toEqual(["destroy", "summon", "graveyard"]);
  });

  it("never treats a discard as material even immediately before a material summon", () => {
    expect(categoriesForLog([
      "Cost was discarded",
      "Tuner was sent to the Graveyard",
      "Player 1 Synchro Summons Stardust Dragon",
    ])).toEqual(["graveyard", "material", "summon"]);
  });
});
