import { describe, expect, it } from "vitest";
import type { DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation, OcgType } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";

const CODE = 98045062;
const TEXT = "Take control of the target until the End Phase";
const cards = {
  get: (code: number) => code === CODE ? { code, name: "Enemy Controller", description: "Printed text", type: OcgType.SPELL } : undefined,
  resolveLabel: () => "Activate an effect",
} as unknown as CardDatabase;

const link = () => ({
  index: 1, seat: 0, code: CODE,
  zone: { controller: 0, location: OcgLocation.SZONE, sequence: 0 }, targets: [],
  chosenOptions: [{ index: 1, text: TEXT }, { text: "Change the target's battle position" }],
});

const prompt: DuelPrompt = {
  id: "p1", seat: 1, kind: "choice", title: "Private follow-up", min: 1, max: 1,
  options: [{ id: "opt:0", label: "Private choice" }],
};

function view(views: typeof merged | typeof legacy, chain: merged.StoredChainLink[], viewer: number | null, format: DuelFormat = "1v1") {
  const project = views.projectView as typeof merged.projectView;
  return project({
    lib: {
      duelQueryField: () => ({
        players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }],
        chain: chain.map((entry) => ({ code: entry.code, ...entry.zone, description: 0n })),
      }),
      duelQueryCount: () => 30,
      duelQueryLocation: () => [],
    } as never,
    handle: {} as never, cards, viewer, revision: 1, turn: 1, turnSeat: 0, phase: "main1",
    lp: [8000, 8000, 8000, 8000], prompt, promptSeat: 1, log: [], events: [], chain,
    result: null, reveals: views.createRevealMap(4), mode: "normal", format,
  });
}

describe.each([["merged", merged], ["legacy", legacy]] as const)("%s chosen chain options", (_name, views) => {
  it("shows only the chosen public text to both seats and spectators", () => {
    for (const viewer of [0, 1, null]) {
      const projected = view(views, [link()], viewer);
      expect(projected.chain[0]).toHaveProperty("chosenOptions", link().chosenOptions);
      expect(projected.prompt).toEqual(viewer === 1 ? prompt : null);
      expect(JSON.stringify(projected.chain)).not.toContain("Private choice");
    }
  });

  it("keeps snapshots without chosen options compatible", () => {
    const { chosenOptions: _choices, ...oldLink } = link();
    expect(view(views, [oldLink], null).chain[0]).not.toHaveProperty("chosenOptions");
  });

  it("copies the public choices so a view cannot change chain memory", () => {
    const stored = link();
    const projected = view(views, [stored], 0);
    expect(projected.chain[0]).toHaveProperty("chosenOptions", stored.chosenOptions);
    const choices = (projected.chain[0] as typeof stored).chosenOptions;
    choices[0].text = "Changed";
    choices.push({ text: "Another choice" });
    expect(stored.chosenOptions).toEqual(link().chosenOptions);
  });
});

describe.each(["tag", "ffa3", "ffa4"] as const)("%s chosen chain options", (format) => {
  it("shows the same selected options to every seat and spectators", () => {
    const count = format === "ffa3" ? 3 : 4;
    for (const viewer of [...Array.from({ length: count }, (_, seat) => seat), null]) {
      expect(view(merged, [link()], viewer, format).chain[0]).toHaveProperty("chosenOptions", link().chosenOptions);
    }
  });
});
