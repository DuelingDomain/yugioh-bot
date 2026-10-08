import { activate, choose, defineScenario, expectNotOffered, expectOffered, expectPickOptions, expectPrompt, normalSummon, select, setCard, specialSummon, yes, zone, type Scenario, type Step } from "../../support/dsl.js";
import { everySeat, SEATS, turnsBefore, type Seat } from "./seat-kit.js";

const ELF = "Mystical Elf", SPIDER = "Link Spider", IMDUK = "Imduk the World Chalice Dragon";
const KNIGHT = "Mekk-Knight Purple Nightfall", SPELL = "Dark Hole";
const across = (seat: Seat): Seat => `p${Number(seat[1]) ^ 1}` as Seat;
const partner = (seat: Seat): Seat => `p${Number(seat[1]) ^ 2}` as Seat;
const slots = (seq: number, card: string) => Array.from({ length: seq + 1 }, (_, i) => i === seq ? card : null);
function scenario(id: string, rule: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `tag-facing-${id}`, title: `Tag: ${id.replaceAll("-", " ")}`,
    source: `ADR 0002 [${rule}], owner decision 2026-10-07; Konami Tag rules and rulebook v1.4 Player positioning`,
    rules: [rule], tags: ["multiplayer", "tag", "facing"], setup: { ...setup, format: "tag" }, steps });
}
function columns(actor: Seat, facing: boolean, mate = false): Scenario {
  const other = mate ? partner(actor) : facing ? across(actor) : across(partner(actor));
  return scenario(`columns-${actor}-${mate ? "partner" : facing ? "facing" : "non-facing"}`, "R-TAG-FACING", {
    [actor]: { hand: [KNIGHT, SPELL] },
    [other]: { monsters: slots(3, ELF) },
  }, [...turnsBefore("tag", actor), setCard(SPELL,actor), zone(actor,"s1",actor),
    ...(facing ? [expectOffered("specialSummon", KNIGHT, actor), specialSummon(KNIGHT, actor)] : [expectNotOffered("specialSummon", KNIGHT, actor)]),
    everySeat("tag", { [actor]: { monsters: facing ? [KNIGHT] : [], spells: [SPELL], zones: { m1: facing ? KNIGHT : null, s1: SPELL } }, [other]: { monsters: [ELF], zones: { m3: ELF } } }),
  ]);
}
function sharedEmz(actor: Seat, facing: boolean): Scenario {
  const other = facing ? across(actor) : across(partner(actor));
  return scenario(`emz-${actor}-${facing ? "facing" : "non-facing"}`, "R-TAG-FACING", {
    [actor]: { monsters: [ELF], extra: [SPIDER] }, [other]: { monsters: slots(6, SPIDER) },
  }, [...turnsBefore("tag", actor), specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
    ...(facing ? [] : [expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Extra Monster Zone (right)" }], actor), zone(actor, "emz0", actor)]),
    expectPrompt({ by: actor, context: "action" }),
    everySeat("tag", { [actor]: { monsters: [SPIDER], grave: [ELF], zones: { emz0: facing ? null : SPIDER, emz1: facing ? SPIDER : null } }, [other]: { monsters: [SPIDER], zones: { emz1: SPIDER } } }),
  ]);
}
function arrows(actor: Seat): Scenario {
  const other = across(actor);
  return scenario(`link-arrow-${actor}`, "R-TAG-FACING", {
    [actor]: { monsters: [ELF], extra: [SPIDER] }, [other]: { monsters: slots(5, IMDUK) },
  }, [...turnsBefore("tag", actor), specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
    expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Monster Zone 4" }], actor), zone(actor, "m3", actor),
    everySeat("tag", { [actor]: { monsters: [SPIDER], grave: [ELF], zones: { m3: SPIDER, emz0: null, emz1: null } }, [other]: { monsters: [IMDUK], zones: { emz0: IMDUK } } }),
  ]);
}
function fieldSpell(actor: Seat, setting: boolean, oldSet: boolean): Scenario {
  const mate = partner(actor), front = across(actor), side = across(mate);
  return scenario(`field-${actor}-${setting ? "set" : "activate"}-replaces-${oldSet ? "set" : "faceup"}-partner`, "R-TAG-FIELD", {
    [actor]: { hand: ["Sogen"] }, [mate]: { field: { card: "Mountain", pos: oldSet ? "set" : "up" } },
    [front]: { field: "Umi" }, [side]: {},
  }, [...turnsBefore("tag", actor), setting ? setCard("Sogen", actor) : activate("Sogen", actor),
    everySeat("tag", { [actor]: { spells: ["Sogen"], zones: { f: { card: "Sogen", pos: setting ? "set" : "up" } } },
      [mate]: { grave: ["Mountain"], zones: { f: null } }, [front]: { spells: ["Umi"], zones: { f: "Umi" } } }),
  ]);
}
// Partner materials remain legal, but the partner's departing monster is not linked.
function firewallDeparture(actor: Seat, local: boolean): Scenario {
  const material = local ? actor : partner(actor);
  return scenario(`firewall-${actor}-${local ? "local" : "partner"}-material-departs`, "R-TAG-FACING", {
    [actor]: { hand: ["Backup Secretary"], monsters: local ? [null, ELF, null, null, null, "Firewall Dragon"] : slots(5, "Firewall Dragon"), extra: [SPIDER] },
    ...(!local ? { [material]: { monsters: slots(1, ELF) } } : {}),
  }, [...turnsBefore("tag", actor), specialSummon(SPIDER, actor), select({ card: ELF, owner: material }),
    ...(local ? [yes(actor)] : []),
    expectPrompt({ by: actor, context: "action" }),
    everySeat("tag", { [actor]: { monsters: ["Firewall Dragon", SPIDER, ...(local ? ["Backup Secretary"] : [])],
      hand: local ? { exclude: ["Backup Secretary"] } : { include: ["Backup Secretary"] },
      grave: local ? [ELF] : [], zones: { emz0: "Firewall Dragon", m1: SPIDER } },
      ...(!local ? { [material]: { grave: [ELF] } } : {}) }),
  ]);
}
function firewallOpponentDeparture(actor: Seat, facing: boolean): Scenario {
  const other=facing ? across(actor) : across(partner(actor));
  return scenario(`firewall-${actor}-${facing ? "facing" : "non-facing"}-tribute-departs`, "R-TAG-FACING", {
    [actor]: {hand: ["Backup Secretary"], monsters: slots(5,"Firewall Dragon")},
    [other]: {hand: ["Summoned Skull"], monsters: slots(3,ELF)},
  }, [...turnsBefore("tag",other), normalSummon("Summoned Skull",other), select({card: ELF,owner: other}),
    ...(facing ? [yes(actor)] : []), expectPrompt({by: other,context: "action"}),
    everySeat("tag", {[actor]: {monsters: ["Firewall Dragon", ...(facing ? ["Backup Secretary"] : [])],
      hand: facing ? {exclude: ["Backup Secretary"]} : {include: ["Backup Secretary"]}, zones: {emz0: "Firewall Dragon"}},
      [other]: {monsters: ["Summoned Skull"], grave: [ELF]}}),
  ]);
}
function metaverse(actor: Seat): Scenario {
  const mate=partner(actor);
  return scenario(`field-${actor}-metaverse-places-over-partner`, "R-TAG-FIELD", {
    [actor]: { spells: [{card: "Metaverse", pos: "set"}], deck: ["Sogen"] }, [mate]: { field: "Mountain" },
  }, [...turnsBefore("tag", actor), activate("Metaverse",actor),
    // Its effect places and activates the selected Field Spell. A singleton selection is automatic.
    choose("Activate it",actor), expectPrompt({by: actor, context: "action"}),
    everySeat("tag", {[actor]: {spells: ["Sogen"], grave: ["Metaverse"], zones: {f: "Sogen"}}, [mate]: {grave: ["Mountain"], zones: {f: null}}}),
  ]);
}
export const TAG_FACING_RULE_SCENARIOS: Scenario[] = SEATS.tag.flatMap((actor) => [
  firewallDeparture(actor, true), firewallDeparture(actor, false), ...(actor === "p0" ? [metaverse(actor)] : []),
  ...(["p0","p2"].includes(actor) ? [firewallOpponentDeparture(actor,true),firewallOpponentDeparture(actor,false)] : []),
  columns(actor, true), columns(actor, false), columns(actor, false, true), sharedEmz(actor, true), sharedEmz(actor, false), arrows(actor),
  ...[false, true].flatMap((setting) => [false, true].map((oldSet) => fieldSpell(actor, setting, oldSet))),
]);
