// A summon to the partner's field uses the actor's private source cards.
import { activate, expectNotOffered, expectPrompt, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Seat } from "./seat-kit.js";
const ELF = "Mystical Elf", FILES = "The Kaiju Files", DOGORAN = "Dogoran, the Mad Flame Kaiju";
const GAMECIEL = "Gameciel, the Sea Turtle Kaiju", SOUL = "Common Soul", DOLPHIN = "Neo-Spacian Aqua Dolphin", OX = "Battle Ox";

function source(actor: "p0" | "p1", files: boolean, positive: boolean): Scenario {
  const partner: Seat = actor === "p0" ? "p2" : "p3", card = files ? FILES : SOUL;
  const own = files
    ? { spells: [FILES], deck: positive ? (actor === "p1" ? [ELF, GAMECIEL] : [GAMECIEL]) : [ELF], hand: positive ? [] : ["Pot of Greed"] }
    : { hand: positive ? [SOUL, DOLPHIN] : [SOUL, "Pot of Greed"] };
  const other = files
    ? { monsters: [DOGORAN], deck: positive ? [ELF] : [GAMECIEL] }
    : { monsters: [OX], hand: positive ? [] : [DOLPHIN] };
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS.tag) spec[seat] = { hand: [], deckCount: 20 };
  const drawn = actor === "p1" ? [ELF] : [];
  spec[actor] = {
    ...(files || positive ? { spells: [card] } : {}),
    hand: [...(!files && !positive ? [SOUL] : []), ...drawn, ...(!positive ? [ELF, ELF] : [])],
    grave: positive ? [] : ["Pot of Greed"],
    deckCount: 20 - drawn.length - (positive ? (files ? 1 : 0) : 2),
  };
  spec[partner] = {
    deckCount: 20,
    ...(files
      ? { monsters: [positive ? GAMECIEL : DOGORAN], grave: positive ? [DOGORAN] : [], hand: [] }
      : positive
        ? { monsters: [OX, DOLPHIN], zones: { m0: { card: OX, attack: 2300 } }, hand: [] }
        : { monsters: [OX], hand: [DOLPHIN] }),
  };
  const steps: Step[] = [...turnsBefore("tag", actor)];
  if (positive) steps.push(activate(card, actor));
  else {
    // A real draw changes only the actor's hand. The partner's source stays private.
    steps.push(expectNotOffered("activate", card, actor), activate("Pot of Greed", actor),
      expectPrompt({ by: actor, context: "action" }), expectNotOffered("activate", card, actor));
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
