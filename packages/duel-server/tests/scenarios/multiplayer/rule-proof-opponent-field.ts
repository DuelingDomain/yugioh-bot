import { activate, pickOpponent, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function clearField(format: Format, actor: Seat, spells: boolean): Scenario {
  const card = spells ? "Harpie's Feather Duster" : "Raigeki";
  // R-COMMON-OPP-ONE: only the declared opponent loses its one-sided field cards.
  const opponent = SEATS[format].find((seat) => seat !== actor)!;
  const setup: Scenario["setup"] = { format };
  for (const seat of SEATS[format]) setup[seat] = {
    monsters: ["Mystical Elf"], spells: [{ card: "Dark Hole", pos: "set" }], hand: seat === actor ? [card] : [],
  };
  return defineScenario({ id: `rule-proof-${format}-all-opposing-${spells ? "spells" : "monsters"}-${actor}`,
    title: `${format}: ${actor} clears the declared opponent's ${spells ? "Set Spell" : "monster"} with ${card}`,
    source: `${SOURCE} [R-COMMON-OPP-ONE]`, rules: ["R-COMMON-OPP-ONE"],
    tags: ["multiplayer", format, spells ? "card:18144506" : "card:12580477"], setup,
    steps: [...turnsBefore(format, actor), activate(card, actor), ...(format !== "tag" ? [pickOpponent(opponent, actor)] : []), everySeat(format, Object.fromEntries(SEATS[format].map((seat, i) => {
      const ownTeam = format === "tag" ? seat === actor || seat === PARTNER[actor] : seat !== opponent;
      const drawn = i > 0 && i <= SEATS[format].indexOf(actor);
      return [seat, { hand: drawn ? ["Mystical Elf"] : [], deckCount: drawn ? 19 : 20,
        monsters: spells || ownTeam ? ["Mystical Elf"] : [], spells: !spells || ownTeam ? ["Dark Hole"] : [],
        grave: [...(seat === actor ? [card] : []), ...(!ownTeam ? [spells ? "Dark Hole" : "Mystical Elf"] : [])] }];
    })))],
  });
}
export const OPPONENT_FIELD_DOMAIN_PROOF_SCENARIOS = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) =>
  (["p0", format === "ffa3" ? "p2" : "p3"] as Seat[]).flatMap((actor) => [false, true].map((spells) => domainVariant(clearField(format, actor, spells)))));
