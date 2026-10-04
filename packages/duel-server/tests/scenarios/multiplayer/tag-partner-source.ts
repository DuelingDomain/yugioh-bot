// A summon to the partner's field uses the actor's private source cards.
import { activate, expectNotOffered, expectOffered, expectPrompt, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Seat } from "./seat-kit.js";
const ELF = "Mystical Elf", FILES = "The Kaiju Files", DOGORAN = "Dogoran, the Mad Flame Kaiju";
const GAMECIEL = "Gameciel, the Sea Turtle Kaiju", SOUL = "Common Soul", DOLPHIN = "Neo-Spacian Aqua Dolphin", OX = "Battle Ox";

function source(actor: "p0" | "p1", files: boolean, positive: boolean): Scenario {
  const partner: Seat = actor === "p0" ? "p2" : "p3", card = files ? FILES : SOUL;
  const own = files
    ? { spells: [FILES], deck: positive ? (actor === "p1" ? [ELF, GAMECIEL] : [GAMECIEL]) : [ELF], hand: positive ? [] : ["Pot of Greed"] }
    : { hand: positive ? [SOUL, DOLPHIN] : [SOUL, "Pot of Greed"],
        ...(!positive ? { deck: actor === "p1" ? [ELF, DOLPHIN] : [DOLPHIN] } : {}) };
  const other = files
    ? { monsters: [DOGORAN], deck: positive ? [ELF] : [GAMECIEL] }
    : { monsters: [OX], hand: positive ? [] : [DOLPHIN] };
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS.tag) spec[seat] = { hand: [], deckCount: 20 };
  const drawn = actor === "p1" ? [ELF] : [];
  spec[actor] = {
    spells: [card],
    hand: [...drawn, ...(!positive ? (files ? [ELF, ELF] : [ELF]) : [])],
    grave: positive ? [] : ["Pot of Greed"],
    deckCount: 20 - drawn.length - (positive ? (files ? 1 : 0) : 2),
  };
  spec[partner] = {
    deckCount: 20,
    ...(files
      ? { monsters: [positive ? GAMECIEL : DOGORAN], grave: positive ? [DOGORAN] : [], hand: [] }
      : { monsters: [OX, DOLPHIN], zones: { m0: { card: OX, attack: 2300 } }, hand: positive ? [] : [DOLPHIN] }),
  };
  const steps: Step[] = [...turnsBefore("tag", actor)];
  if (positive) steps.push(activate(card, actor));
  else {
    // The partner's source stays private. Common Soul needs a source in the actor's hand.
    steps.push(expectNotOffered("activate", card, actor), activate("Pot of Greed", actor),
      expectPrompt({ by: actor, context: "action" }));
    if (files) steps.push(expectNotOffered("activate", card, actor));
    else steps.push(everySeat("tag", {
      ...spec,
      [actor]: { ...spec[actor], spells: [], hand: [SOUL, DOLPHIN, ...drawn, ELF] },
      [partner]: { deckCount: 20, monsters: [OX], hand: [DOLPHIN] },
    }), expectOffered("activate", card, actor), activate(card, actor));
  }
  steps.push(expectPrompt({ by: actor, context: "action" }), everySeat("tag", spec));
  return defineScenario({
    id: `tag-partner-source-${files ? 11163040 : 14772491}-${actor}-${positive ? "actor-has-source" : "only-partner-has-source"}`,
    title: `Tag: ${actor} uses its own ${files ? "Deck" : "hand"} for its partner's field`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-TAG-SHARED-CARDS]",
    rules: ["R-COMMON-SEP-FIELDS", "R-TAG-PARTNER", "R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", "tag", "partner", `card:${files ? 11163040 : 14772491}`],
    setup: baseSetup("tag", { [actor]: own, [partner]: other }), steps,
  });
}
const standard = (["p0", "p1"] as const).flatMap((actor) => [true, false].flatMap((files) =>
  [source(actor, files, true), source(actor, files, false)]));
export const TAG_PARTNER_SOURCE_SCENARIOS: Scenario[] = [...standard, ...standard.map(domainVariant)];
