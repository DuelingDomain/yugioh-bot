import { expect, it } from "vitest";
import { defineScenarioWithFfaFirstDraw } from "./scenarios/multiplayer/ffa-first-draw.js";
import { expectBoard, type Scenario } from "./support/dsl.js";
import { domainVariant } from "./scenarios/multiplayer/domain-variants.js";

it.each((["1v1", "tag", "ffa3", "ffa4"] as const).flatMap((format) =>
  (["normal", "domain"] as const).flatMap((mode) =>
    ([1, 2, 3, 4, 5] as const).map((masterRule) => ({ format, mode, masterRule }))),
))("$mode MR$masterRule $format fixture follows the first-turn draw rule", ({ format, mode, masterRule }) => {
  const input: Scenario = { id: "draw-applicability", title: "First draw", source: "Owner decision 2026-10-02",
    tags: [], setup: { format, mode, masterRule, p0: { hand: [], deck: ["Silver Fang"] } },
    steps: [expectBoard({ p0: { hand: [], deckCount: 20 } })] };
  const result = defineScenarioWithFfaFirstDraw(input);
  const draws = mode === "domain" ? format !== "1v1" : masterRule <= 2;
  expect(result.steps[0]).toEqual(expectBoard({ p0: { hand: draws ? ["Mystical Elf"] : [], deckCount: draws ? 19 : 20 } }));
  expect(result.setup.p0?.deck).toEqual(draws ? ["Mystical Elf", "Silver Fang"] : ["Silver Fang"]);
});

it("keeps a custom draw card and destination when a Standard fixture becomes Domain", () => {
  const base = defineScenarioWithFfaFirstDraw({ id: "custom-draw", title: "Custom draw", source: "Owner decision",
    tags: [], setup: { format: "ffa3", p0: { deck: ["Silver Fang"] } },
    steps: [expectBoard({ p0: { hand: [], grave: [], deckCount: 20 } })],
  }, { card: "Beaver Warrior", destination: "grave" });
  expect(base.steps[0]).toEqual(expectBoard({ p0: { hand: [], grave: [], deckCount: 20 } }));
  const variant = domainVariant(base);
  expect(variant.setup.p0?.deck).toEqual(["Beaver Warrior", "Silver Fang"]);
  expect(variant.steps[0]).toEqual(expectBoard({ p0: { hand: [], grave: ["Beaver Warrior"], deckCount: 19 } }));
});
