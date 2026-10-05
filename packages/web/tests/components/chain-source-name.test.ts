import { describe, expect, it } from "vitest";
import { projectChainNames } from "@/components/duel/chain-state";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";

describe("chain source names from the viewer's projection", () => {
  const engine = FFA4_FIXTURES.states["chain-2"].room.engine!;

  it("uses the visible card's name instead of a zone label", () => {
    const card = engine.seats[0].monsters.find((card) => card?.name)!;
    const chain = [{ index: 1, seat: 0, code: card.code, name: "Monster zone 1", zone: card }];
    expect(projectChainNames(chain, engine.seats)[0].name).toBe("Dark Magician");
  });

  it("keeps an unseen face-down card neutral, without resolving its code", () => {
    const seats = structuredClone(engine.seats);
    seats[1].spells[1] = { controller: 1, location: 8, sequence: 1, position: 8 };
    const chain = [{ index: 1, seat: 1, name: "Spell & Trap zone 2", zone: { controller: 1, location: 8, sequence: 1 } }];
    expect(projectChainNames(chain, seats)[0].name).toBeUndefined();
    expect(JSON.stringify(projectChainNames(chain, seats))).not.toContain("Mirror Force");
  });

  it("can name the viewer's own face-down source when its identity is present", () => {
    const seats = structuredClone(engine.seats);
    seats[0].spells[1] = { controller: 0, location: 8, sequence: 1, position: 8, code: 44095762, name: "Mirror Force" };
    const link = { index: 1, seat: 0, code: 44095762, zone: { controller: 0, location: 8, sequence: 1 } };
    expect(projectChainNames([link], seats)[0].name).toBe("Mirror Force");
  });

  it("does not borrow the name of a replacement card in the old zone", () => {
    const card = engine.seats[0].monsters.find((card) => card?.name)!;
    expect(projectChainNames([{ index: 1, seat: 0, code: 999, zone: card }], engine.seats)[0].name).toBeUndefined();
  });

  it("retains a public activation name after the source leaves the field", () => {
    expect(projectChainNames([{ index: 1, seat: 1, code: 5318639, name: "Mystical Space Typhoon" }], engine.seats)[0].name).toBe("Mystical Space Typhoon");
  });
});
