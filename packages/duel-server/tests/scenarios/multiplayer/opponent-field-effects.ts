// Live scenarios of the cards whose EFFECT Special Summons a card or tokens to the field of an opponent (OPPONENT_FIELD_EFFECT_SUMMON in
// src/banlists/multiplayer.ts). One table row per card; the generator makes one scenario per format (FFA3, FFA4, Tag) from the row.
// Rules (ADR 0002): an activated effect declares one legal opponent (R-FFA-OPP-ONE); a trigger or response can bind the opponent that caused
// it (R-FFA-OPP-RESPONSE). In Tag a pick offers opposing members only; the partner is never offered.
// Layout of a scenario: FFA3 p0 acts, p1 and p2 are the opponents, p2 is picked (not the first seat, so a default of the core fails).
// FFA4: p1, p2, p3 are the opponents, p3 is picked. Tag: p1 and p3 are the opposing members, p3 is picked, p2 is the partner.
// Every scenario ends with the state of every seat (everySeat). Plain data, also read by scripts/rule-coverage.ts; opponent-field-effects.test.ts
// runs them on a live core (NSEAT_LIVE=1).

import { activate, no, select, expectPickSeats, pickOpponent, type CardEntry, type DuelistExpect, type DuelistSetup, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { everySeat } from "./table-cards.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
type Seat = "p0" | "p1" | "p2" | "p3";

/** The cards of one seat at the end of a scenario (exact), or that a seat gains. */
export interface Zones {
  monsters?: Array<string | number>;
  spells?: Array<string | number>;
  grave?: Array<string | number>;
  banished?: Array<string | number>;
  hand?: Array<string | number>;
  lp?: number;
  /**
   * Tokens on the monster zones. The tokens of one card have different passcodes that the card data does not know, so the board check names
   * one token (when the card data knows one) and counts all the monsters: monsters = the named ones + `count` tokens.
   */
  tokens?: { card?: string | number; count: number };
}

/** Who is who in one format. `others` are the opponents that are not picked, `partner` is the Tag partner of p0. */
export interface Roles {
  format: Format;
  /** The opponents of p0, in seat order. */
  opponents: Seat[];
  /** The opponent that p0 picks. */
  tgt: Seat;
  /** The opponents that are not picked. */
  others: Seat[];
  /** The Tag partner of p0, none in free-for-all. */
  partner?: Seat;
}

export const ROLES: Record<Format, Roles> = {
  ffa3: { format: "ffa3", opponents: ["p1", "p2"], tgt: "p2", others: ["p1"] },
  ffa4: { format: "ffa4", opponents: ["p1", "p2", "p3"], tgt: "p3", others: ["p1", "p2"] },
  tag: { format: "tag", opponents: ["p1", "p3"], tgt: "p3", others: ["p1"], partner: "p2" },
};

export interface EffectSpec {
  code: number;
  name: string;
  /** Lower case slug of the card name for the scenario id. */
  slug: string;
  /** What the card does, for the title: "Special Summons 3 Ojama Tokens". */
  does: string;
  /** Setup of p0. */
  p0: DuelistSetup;
  /** Setup of every opponent. Default: one Mystical Elf. */
  opp?: DuelistSetup;
  /** Setup of the picked opponent instead of `opp`. */
  tgt?: DuelistSetup;
  /** Setup of the Tag partner. Default: one Mystical Elf. */
  partner?: DuelistSetup;
  /** Setup of single seats instead of `opp`, `tgt` and `partner` (seat names of the format). */
  seats?: Partial<Record<Seat, DuelistSetup>>;
  /** End state of single seats instead of the derived one. */
  seatEnd?: Partial<Record<Seat, Zones>> | ((roles: Roles) => Partial<Record<Seat, Zones>>);
  /** The steps up to the opponent pick. They receive the roles of the format. */
  steps: Step[] | ((roles: Roles) => Step[]);
  /** The steps after the pick, for example the answer of a yes/no prompt. */
  then?: Step[] | ((roles: Roles) => Step[]);
  /** The helper adds no pick step: a cause binds the opponent, one opponent is legal, or steps has the pick. */
  noPick?: boolean | ((roles: Roles) => boolean);
  /** The trigger or response binds the opponent that caused it (R-FFA-OPP-RESPONSE). */
  binding?: "event-opponent";
  /** The seat that picks. Default p0. */
  pickBy?: Seat;
  /** The seats offered. Default: all opponents of p0. */
  offered?: (roles: Roles) => Seat[];
  /** End state of p0 (exact zones). A function gets the roles of the format (the life points of Tag differ). */
  p0End: Zones | ((roles: Roles) => Zones);
  /** What the picked opponent gains, added to its setup. */
  gain?: Zones;
  /** End state of the picked opponent instead of setup + gain. */
  tgtEnd?: Zones | ((roles: Roles) => Zones);
  /** End state of the other opponents instead of their setup. */
  othersEnd?: Zones | ((roles: Roles) => Zones);
  /** End state of the Tag partner instead of its setup. */
  partnerEnd?: Zones | ((roles: Roles) => Zones);
  /** Formats of the card. Default all three. */
  formats?: Format[];
  /** The duelists may attack in the first turn (the setup flag of the DSL). */
  attackFirstTurn?: boolean;
}

const names = (entries: Array<CardEntry | null> | undefined): Array<string | number> =>
  (entries ?? []).filter((e): e is CardEntry => e !== null).map((e) => (typeof e === "object" ? e.card : e));


/** Zones of a setup, as the end state when nothing changes. */
const zonesOf = (setup: DuelistSetup): Zones => ({
  monsters: names(setup.monsters),
  spells: [...names(setup.spells), ...(setup.field ? names([setup.field]) : [])],
  grave: [...(setup.grave ?? [])],
  banished: [...(setup.banished ?? [])],
});

const merge = (base: Zones, gain: Zones | undefined): Zones => ({
  monsters: [...(base.monsters ?? []), ...(gain?.monsters ?? [])],
  spells: [...(base.spells ?? []), ...(gain?.spells ?? [])],
  grave: [...(base.grave ?? []), ...(gain?.grave ?? [])],
  banished: [...(base.banished ?? []), ...(gain?.banished ?? [])],
  ...(gain?.tokens ? { tokens: gain.tokens } : {}),
  ...(gain?.hand ? { hand: gain.hand } : {}),
  ...(gain?.lp !== undefined ? { lp: gain.lp } : {}),
});

/** The board check of a seat: a seat with tokens checks the monsters by the named cards and the total count. */
function expectOf(zones: Zones): DuelistExpect {
  const { tokens, monsters, ...rest } = zones;
  if (!tokens) return { ...rest, monsters } as DuelistExpect;
  const named = monsters ?? [];
  return { ...rest, monsters: { include: [...named, ...(tokens.card === undefined ? [] : [tokens.card])], count: named.length + tokens.count } } as DuelistExpect;
}

/** The default monster of the Tag partner. It differs from the Mystical Elf of the opponents, so a prompt that offers the partner monster can name its own. */
export const PARTNER_MONSTER = "Battle Ox";

const FORMAT_LABEL: Record<Format, string> = { ffa3: "FFA3", ffa4: "FFA4", tag: "Tag" };


export function effectScenarios(spec: EffectSpec): Scenario[] {
  return (spec.formats ?? (["ffa3", "ffa4", "tag"] as Format[])).map((format) => {
    const roles = ROLES[format];
    const oppSetup = spec.opp ?? { monsters: [ELF] };
    const tgtSetup = spec.tgt ?? oppSetup;
    const partnerSetup = spec.partner ?? { monsters: [PARTNER_MONSTER] };
    const setup: Record<string, unknown> = { format, ...(spec.attackFirstTurn ? { attackFirstTurn: true } : {}), p0: spec.p0 };
    for (const seat of roles.opponents) setup[seat] = seat === roles.tgt ? tgtSetup : oppSetup;
    if (roles.partner) setup[roles.partner] = partnerSetup;
    for (const [seat, value] of Object.entries(spec.seats ?? {})) if (seat in setup || seat === roles.partner) setup[seat] = value;
    const at = <T>(value: T | ((r: Roles) => T) | undefined): T | undefined => (typeof value === "function" ? (value as (r: Roles) => T)(roles) : value);
    const seatEnd = at(spec.seatEnd) ?? {};
    const seatSpec: Partial<Record<Seat, Zones>> = { p0: at(spec.p0End)! };
    for (const seat of roles.others) seatSpec[seat] = at(spec.othersEnd) ?? zonesOf(oppSetup);
    seatSpec[roles.tgt] = at(spec.tgtEnd) ?? merge(zonesOf(tgtSetup), spec.gain);
    if (roles.partner) seatSpec[roles.partner] = at(spec.partnerEnd) ?? zonesOf(partnerSetup);
    for (const [seat, value] of Object.entries(spec.seats ?? {})) {
      if (seat === roles.tgt) seatSpec[seat] = at(spec.tgtEnd) ?? merge(zonesOf(value), spec.gain);
      else if (seat !== "p0" && !(seat in (seatEnd))) seatSpec[seat as Seat] = zonesOf(value);
    }
    Object.assign(seatSpec, seatEnd);
    const steps = typeof spec.steps === "function" ? spec.steps(roles) : spec.steps;
    const then = typeof spec.then === "function" ? spec.then(roles) : (spec.then ?? []);
    const by = spec.pickBy ?? "p0";
    const noPick = typeof spec.noPick === "function" ? spec.noPick(roles) : spec.noPick;
    const ffaRule = noPick && spec.binding === "event-opponent" ? "R-FFA-OPP-RESPONSE" : "R-FFA-OPP-ONE";
    const pick: Step[] = noPick
      ? []
      : [expectPickSeats((spec.offered ? spec.offered(roles) : roles.opponents) as Seat[], by), pickOpponent(roles.tgt, by)];
    const where = format === "tag" ? "an opposing member" : "the picked opponent";
    return defineScenario({
      id: `opponent-field-effects-${format}-${spec.slug}-goes-to-${format === "tag" ? "an-opposing-member" : "the-picked-opponent"}`,
      title: `${FORMAT_LABEL[format]}: ${spec.name} ${spec.does} on the field of ${where} (${roles.tgt}) only; the other seats are unchanged`,
      source: `${SOURCE} [R-COMMON-OPP-PICK] ${format === "tag" ? "[R-TAG-SHARED-CARDS]" : `[${ffaRule}]`}`,
      rules: format === "tag" ? ["R-COMMON-OPP-PICK", "R-TAG-SHARED-CARDS", "R-TAG-PARTNER"] : ["R-COMMON-OPP-PICK", ffaRule],
      tags: ["multiplayer", "opponent-field-summon", format, `card:${spec.code}`],
      setup: setup as never,
      steps: [...steps, ...pick, ...then, everySeat(format, Object.fromEntries(Object.entries(seatSpec).map(([seat, zones]) => [seat, expectOf(zones)])))],
    }, spec.slug === "ceruli" ? { card: ELF } : {});
  });
}
