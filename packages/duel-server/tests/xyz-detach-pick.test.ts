import { describe, expect, it } from "vitest";
import type { DuelFormat } from "@yugidraft/shared/duels";
import { describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { FIRST, openDetachGame, reachDetach, SECOND, XYZ } from "./support/xyz-detach.js";

// The player pays a detach cost: the engine asks which Xyz material to detach (a card select from the Overlay location,
// min 1 / max 1). Pick the SECOND material and check that exactly that card went to the Graveyard. Real engines: Standard
// and Domain, 1v1 and a table of three.
async function pickSecond(mode: "normal" | "domain", format: DuelFormat): Promise<void> {
  const seats = format === "1v1" ? 2 : 3;
  const game = await openDetachGame(mode, format);
  try {
    const prompt = reachDetach(game, seats);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(prompt.options.map((option) => option.card?.name)).toEqual([FIRST, SECOND]);
    for (const option of prompt.options) expect(option.host?.name).toBe(XYZ);
    const second = prompt.options.find((option) => option.card?.name === SECOND)!;
    game.answer(0, prompt.id, { selected: [second.id] });
    const seat = game.view(0).seats[0];
    expect(seat.graveyard.map((card) => card.name)).toEqual([SECOND]);
    expect(seat.monsters.find((card) => card?.name === XYZ)?.materials?.map((card) => card.name)).toEqual([FIRST]);
  } finally {
    game.close();
  }
}

describeWithCores("Xyz detach pick, Standard 1v1", [needs.standard()], () => {
  it("sends the second material to the Graveyard", () => pickSecond("normal", "1v1"));
});

describeWithCores("Xyz detach pick, Domain 1v1", [needs.domain(), needs.domainScript()], () => {
  it("sends the second material to the Graveyard", () => pickSecond("domain", "1v1"));
});

describeWithCores("Xyz detach pick, Standard table of three", liveNseat, () => {
  it("sends the second material to the Graveyard", () => pickSecond("normal", "ffa3"));
});

describeWithCores("Xyz detach pick, Domain table of three", [liveNseat, ...needs.domainMulti()], () => {
  it("sends the second material to the Graveyard", () => pickSecond("domain", "ffa3"));
});
