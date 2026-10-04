import { describe, expect, it } from "vitest";
import { selectBarCopy, sumSelectionValues, synchroSelectionValues, type BarCopyInput } from "@/components/duel/select-bar-copy";
import type { DuelPrompt } from "@yugidraft/shared/duels";

function copy(overrides: Partial<BarCopyInput> = {}) {
  return selectBarCopy({ kind: "cards", title: "Select 2 card(s)", min: 2, max: 2, count: 0, ...overrides });
}

describe("selectBarCopy title", () => {
  it("shortens a zone pick and moves the card to the second line", () => {
    const out = copy({ kind: "places", title: "Select a zone for Blue-Eyes White Dragon", min: 1, max: 1 });
    expect(out.kind).toBe("zone");
    expect(out.title).toBe("Choose a zone");
    expect(out.detail).toBe("Blue-Eyes White Dragon");
    expect(out.sub).toBe("Blue-Eyes White Dragon · Pick 1");
  });

  it("names zones with no card and zones to disable", () => {
    expect(copy({ kind: "places", title: "Select a zone", min: 1, max: 1 })).toMatchObject({ title: "Choose a zone", detail: null, sub: "Pick 1" });
    expect(copy({ kind: "places", title: "Select zone(s) to disable", min: 1, max: 1 }).title).toBe("Disable a zone");
    expect(copy({ kind: "places", title: "Select zone(s) to disable", min: 2, max: 2 }).title).toBe("Disable 2 zones");
    expect(copy({ kind: "places", title: "Select a zone", min: 2, max: 2 }).title).toBe("Choose 2 zones");
    expect(copy({ kind: "places", title: "Select a zone" , min: 1, max: 3 }).title).toBe("Choose zones");
  });

  it("uses the source card for a zone pick when the engine names none", () => {
    expect(copy({ kind: "places", title: "Select a zone", min: 1, max: 1, sourceName: "Raigeki" }).detail).toBe("Raigeki");
  });

  it("calls a material pick Select materials and keeps the summon kind as the detail", () => {
    const out = copy({ kind: "toggle", title: "Select the card(s) to use as Fusion Material", min: 2, max: 2, count: 1, toggling: true });
    expect(out.kind).toBe("materials");
    expect(out.title).toBe("Select materials");
    expect(out.detail).toBe("Fusion material");
    expect(out.sub).toBe("Fusion material · Pick 2 · 1/2 selected");
    expect(copy({ title: "Select the card(s) to be used as Xyz material" }).detail).toBe("Xyz material");
    expect(copy({ title: "Select the card(s) to use as material" }).detail).toBeNull();
  });

  it("calls a discard Discard N", () => {
    expect(copy({ title: "Select the card(s) to discard", min: 2, max: 2 }).title).toBe("Discard 2");
    expect(copy({ title: "Select the card(s) to discard", min: 1, max: 1 }).title).toBe("Discard 1");
    expect(copy({ title: "Select the card(s) to discard", min: 0, max: 3 }).title).toBe("Discard cards");
  });

  it("calls a tribute Tribute N monsters", () => {
    expect(copy({ kind: "tribute", title: "Select tribute(s)", min: 2, max: 3 }).title).toBe("Tribute 2 monsters");
    expect(copy({ kind: "tribute", title: "Select tribute(s)", min: 1, max: 1 }).title).toBe("Tribute 1 monster");
    expect(copy({ kind: "tribute", title: "Select tribute(s)", min: 0, max: 3 }).title).toBe("Tribute");
    expect(copy({ title: "Select the card(s) to Tribute", min: 1, max: 1 }).title).toBe("Tribute 1");
  });

  it("calls a target pick Choose a target", () => {
    expect(copy({ title: "Select the target(s)", min: 1, max: 1 }).title).toBe("Choose a target");
    expect(copy({ title: "Select the attack target", min: 1, max: 1 }).title).toBe("Choose a target");
    expect(copy({ title: "Select the target(s)", min: 1, max: 3 }).title).toBe("Choose targets");
    expect(copy({ title: "Select 1 card(s)", aiming: true }).title).toBe("Choose a target");
  });

  it("calls a position pick Choose a position", () => {
    const out = copy({ kind: "choice", title: "Select a position for Dark Magician", min: 1, max: 1 });
    expect(out.title).toBe("Choose a position");
    expect(out.detail).toBe("Dark Magician");
  });

  it("forces the position title for a position prompt whatever the engine says", () => {
    const out = copy({ kind: "choice", title: "Select a card", min: 1, max: 1, position: true, sourceName: "Dark Magician" });
    expect(out).toMatchObject({ kind: "position", title: "Choose a position", detail: "Dark Magician" });
  });

  it("keeps the purpose of a generic card pick on the second line", () => {
    const out = copy({ title: "Select the card(s) to send to the Graveyard", min: 1, max: 1 });
    expect(out.title).toBe("Select a card");
    expect(out.detail).toBe("Send to the Graveyard");
    expect(copy({ title: "Select the card(s) to Special Summon", min: 2, max: 2 })).toMatchObject({ title: "Select 2 cards", detail: "Special Summon" });
    expect(copy({ title: "Select 2 card(s)", min: 1, max: 3 })).toMatchObject({ title: "Select cards", detail: null });
  });

  it("keeps an engine title that names no card pick whole", () => {
    expect(copy({ title: "Choose something very unusual to do now" }).title).toBe("Choose something very unusual to do now");
  });

  it("selects cards for a sum pick", () => {
    expect(copy({ kind: "sum", title: "Select cards totaling 8", min: 1, max: 3, target: 8 }).title).toBe("Select cards");
  });

  it("never cuts a title: every title is a short, whole label", () => {
    const titles = [
      copy({ kind: "places", title: "Select a zone for Blue-Eyes White Dragon", min: 1, max: 1 }).title,
      copy({ title: "Select the card(s) to use as Synchro Material" }).title,
      copy({ title: "Select the card(s) to discard" }).title,
      copy({ kind: "tribute", title: "Select tribute(s)", min: 2, max: 2 }).title,
      copy({ title: "Select the target(s)", min: 1, max: 1 }).title,
      copy({ title: "Select the card(s) to send to the Graveyard", min: 3, max: 3 }).title,
    ];
    for (const title of titles) expect(title.length).toBeLessThanOrEqual(18);
  });

  it("keeps the full engine text for the tooltip and the screen reader", () => {
    const out = copy({ kind: "places", title: "Select a zone for Blue-Eyes White Dragon", description: "Pick where it goes", min: 1, max: 1 });
    expect(out.full).toBe("Select a zone for Blue-Eyes White Dragon");
    expect(out.tooltip).toBe("Select a zone for Blue-Eyes White Dragon\nPick where it goes");
  });
});

describe("selectBarCopy progress", () => {
  it.each([
    { count: 0, total: 0, counter: "Level 0 / 7", met: false },
    { count: 1, total: 3, counter: "Level 3 / 7", met: false },
    { count: 2, total: 7, counter: "Level 7 / 7", met: true },
    { count: 2, total: 8, counter: "Level 8 / 7", met: false },
  ])("reports Synchro Level progress at $count picks", ({ count, total, counter, met }) => {
    expect(copy({ kind: "toggle", title: "Select the card(s) to use as Synchro Material", min: 1, max: 1,
      target: 7, total, count, sumMode: "exact" })).toMatchObject({ title: "Choose a material", counter, met });
  });

  it("falls back to the selected count when the Synchro target is unknown and keeps Xyz/Link counts", () => {
    for (const summon of ["Synchro", "Xyz", "Link"]) {
      expect(copy({ kind: "toggle", title: `Select the card(s) to use as ${summon} Material`, min: 1, max: 1,
        count: 2, total: 7 }).counter).toBe("2 selected");
    }
  });

  it("reads Pick 1 for a pick answered at once", () => {
    expect(copy({ min: 1, max: 1 }).progress).toBe("Pick 1");
  });

  it("counts a pick that needs steps", () => {
    expect(copy({ min: 2, max: 2, count: 0 }).progress).toBe("Pick 2 · 0/2 selected");
    expect(copy({ min: 2, max: 2, count: 1 }).progress).toBe("Pick 2 · 1/2 selected");
    expect(copy({ kind: "toggle", toggling: true, min: 1, max: 1, count: 0 }).progress).toBe("0 selected");
    expect(copy({ min: 1, max: 1, count: 1 }).progress).toBe("Pick 1 · 1/1 selected");
  });

  it("says up to N, or a range", () => {
    expect(copy({ min: 0, max: 3, count: 1 }).progress).toBe("Pick up to 3 · 1 selected");
    expect(copy({ min: 2, max: 3, count: 1 }).progress).toBe("Pick 2 to 3 · 1 selected");
  });

  it("shows the sum target and the values chosen", () => {
    expect(copy({ kind: "sum", target: 8, values: "4 + 4", min: 1, max: 3 }).progress).toBe("Total 8 · 4 + 4");
    expect(copy({ kind: "sum", target: 8, min: 1, max: 3 }).progress).toBe("Total 8");
  });

  it("counts tributes by what they are worth against what is needed", () => {
    expect(copy({ kind: "tribute", min: 2, max: 3, count: 1 }).progress).toBe("1/2");
    // One card that counts as two completes a two-Tribute pick.
    expect(copy({ kind: "tribute", min: 2, max: 2, count: 1, total: 2 })).toMatchObject({ counter: "2/2", met: true });
    expect(copy({ kind: "tribute", min: 2, max: 2, count: 1, total: 1 })).toMatchObject({ counter: "1/2", met: false });
  });

  it("counts an order pick as ordered", () => {
    expect(copy({ kind: "order", title: "Choose the card order", min: 3, max: 3, count: 1 })).toMatchObject({
      title: "Choose the card order",
      progress: "1 of 3 ordered",
    });
  });

  it("tells the player to point while aiming", () => {
    expect(copy({ aiming: true }).progress).toBe("Point at a target, then confirm");
  });

  it("joins the detail and the progress on the second line", () => {
    expect(copy({ title: "Select the card(s) to discard", min: 2, max: 2, count: 1 }).sub).toBe("Pick 2 · 1/2 selected");
    expect(copy({ title: "Select the card(s) to send to the Graveyard", min: 1, max: 1 }).sub).toBe("Send to the Graveyard · Pick 1");
  });
});

describe("selectBarCopy ask, counter and remaining", () => {
  it("splits the progress into the ask and the count chip", () => {
    expect(copy({ min: 2, max: 2, count: 0 })).toMatchObject({ instruction: "Pick 2", counter: "0/2 selected", remaining: 2 });
    expect(copy({ min: 2, max: 2, count: 2 })).toMatchObject({ instruction: "Pick 2", counter: "2/2 selected", remaining: null });
    expect(copy({ min: 1, max: 3, count: 0 })).toMatchObject({ instruction: "Pick 1 to 3", counter: "0 selected", remaining: 1 });
    expect(copy({ min: 0, max: 3, count: 1 })).toMatchObject({ instruction: "Pick up to 3", counter: "1 selected", remaining: null });
  });

  it("has no chip for a single pick and no help where the count is not plain", () => {
    expect(copy({ min: 1, max: 1 })).toMatchObject({ instruction: "Pick 1", counter: null });
    expect(copy({ kind: "tribute", min: 2, max: 3, count: 1 })).toMatchObject({ instruction: "", counter: "1/2", remaining: null });
    expect(copy({ kind: "sum", target: 8, values: "4 + 4", min: 1, max: 3 })).toMatchObject({ instruction: "Total 8", counter: "4 + 4", remaining: null });
    expect(copy({ aiming: true })).toMatchObject({ instruction: "Point at a target, then confirm", counter: null, remaining: null });
  });

  it("keeps the progress as the ask and the count joined", () => {
    const out = copy({ min: 2, max: 2, count: 1 });
    expect(out.progress).toBe(`${out.instruction} · ${out.counter}`);
  });
});

describe("sumSelectionValues", () => {
  const sum = (target: number, sumMode: DuelPrompt["sumMode"], values: number[][]): DuelPrompt => ({
    id: "p", seat: 0, kind: "sum", title: "Tribute", target, sumMode,
    options: values.map((entry, index) => ({ id: `c${index}`, label: `Card ${index}`, values: entry })),
  } as DuelPrompt);
  const met = (prompt: DuelPrompt, ids: string[]) => sumSelectionValues(prompt, ids).sumMet;

  it("meets an at-least sum only with no spare card, as the core requires", () => {
    const ritual = sum(4, "at-least", [[2], [3], [4]]);
    expect(met(ritual, ["c0"])).toBe(false);
    expect(met(ritual, ["c0", "c1"])).toBe(true);
    expect(met(ritual, ["c2"])).toBe(true);
    // 2 + 3 + 4 reaches 4, but the core retries: without the 2 it still reaches 4.
    expect(met(ritual, ["c0", "c1", "c2"])).toBe(false);
  });

  it("checks alternative values the way the core does: highest values reach, lowest values have no spare", () => {
    expect(met(sum(4, "at-least", [[1, 3], [2]]), ["c0", "c1"])).toBe(true);
    expect(met(sum(4, "at-least", [[1, 5], [4]]), ["c0", "c1"])).toBe(false);
    // 6 + 1 reaches 5, and 2 + 1 - 1 stays under it: the core accepts, though no single assignment has no spare.
    expect(met(sum(5, "at-least", [[2, 6], [1]]), ["c0", "c1"])).toBe(true);
  });

  it("counts required cards in the at-least check, as the core does", () => {
    // The core takes the smallest value over required and chosen cards together: a required 1 makes the chosen 4 spare.
    const required = sum(4, "at-least", [[1], [4]]);
    expect(met(required, ["c0", "c1"])).toBe(false);
    expect(met(required, ["c0"])).toBe(false);
  });

  it("meets an exact sum only on the target", () => {
    const synchro = sum(7, "exact", [[3], [4], [2]]);
    expect(met(synchro, ["c0", "c1"])).toBe(true);
    expect(met(synchro, ["c0", "c2"])).toBe(false);
  });
});

describe("synchroSelectionValues", () => {
  const toggle = (options: Array<{ level: number; selected?: boolean; varies?: boolean }>): DuelPrompt => ({
    id: "p", seat: 0, kind: "toggle", title: "Select the Synchro Material", target: 6, sumMode: "exact",
    options: options.map((entry, index) => ({ id: `c${index}`, label: `Card ${index}`, currentLevel: entry.level,
      selected: entry.selected, synchroLevelVaries: entry.varies })),
  } as DuelPrompt);

  it("sums the selected materials' current Levels", () => {
    expect(synchroSelectionValues(toggle([{ level: 4, selected: true }, { level: 2, selected: true }, { level: 3 }])).total).toBe(6);
  });

  it("gives no total once a material with its own Synchro Level is selected, so the count shows instead", () => {
    const prompt = toggle([{ level: 4, selected: true, varies: true }, { level: 4 }]);
    expect(synchroSelectionValues(prompt).total).toBeUndefined();
    expect(selectBarCopy({ kind: "toggle", title: prompt.title, min: 1, max: 1, count: 1, target: 6, sumMode: "exact",
      ...synchroSelectionValues(prompt) }).counter).toBe("1 selected");
    // Unknown, not unmet: the prompt falls back to the core's Finish state.
    expect(selectBarCopy({ kind: "toggle", title: prompt.title, min: 1, max: 1, count: 1, target: 6, sumMode: "exact",
      ...synchroSelectionValues(prompt) }).met).toBeNull();
  });
});
