import { describe, expect, it } from "vitest";
import { selectBarCopy, type BarCopyInput } from "@/components/duel/select-bar-copy";

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
    const out = copy({ kind: "toggle", title: "Select the card(s) to use as Synchro Material", min: 2, max: 2, count: 1, toggling: true });
    expect(out.kind).toBe("materials");
    expect(out.title).toBe("Select materials");
    expect(out.detail).toBe("Synchro material");
    expect(out.sub).toBe("Synchro material · Pick 2 · 1/2 selected");
    expect(copy({ title: "Select the card(s) to be used as Xyz material" }).detail).toBe("Xyz material");
    expect(copy({ title: "Select the card(s) to use as material" }).detail).toBeNull();
  });

  it("calls a discard Discard N", () => {
    expect(copy({ title: "Select the card(s) to discard", min: 2, max: 2 }).title).toBe("Discard 2");
    expect(copy({ title: "Select the card(s) to discard", min: 1, max: 1 }).title).toBe("Discard 1");
    expect(copy({ title: "Select the card(s) to discard", min: 0, max: 3 }).title).toBe("Discard cards");
  });

  it("calls a tribute Tribute N", () => {
    expect(copy({ kind: "tribute", title: "Select tribute(s)", min: 2, max: 3 }).title).toBe("Tribute 2");
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
  it("reads Pick 1 for a pick answered at once", () => {
    expect(copy({ min: 1, max: 1 }).progress).toBe("Pick 1");
  });

  it("counts a pick that needs steps", () => {
    expect(copy({ min: 2, max: 2, count: 0 }).progress).toBe("Pick 2 · 0/2 selected");
    expect(copy({ min: 2, max: 2, count: 1 }).progress).toBe("Pick 2 · 1/2 selected");
    expect(copy({ kind: "toggle", toggling: true, min: 1, max: 1, count: 0 }).progress).toBe("Pick 1 · 0/1 selected");
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

  it("counts tributes", () => {
    expect(copy({ kind: "tribute", min: 2, max: 3, count: 1 }).progress).toBe("1 selected");
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
