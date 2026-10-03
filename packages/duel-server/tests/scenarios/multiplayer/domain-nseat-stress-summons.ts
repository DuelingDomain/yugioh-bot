import { activate, endTurn, expectNotOffered, expectOffered, expectPrompt, normalSummon, select, setCard, specialSummon, type Scenario } from "../../support/dsl.js";
import { turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { stressBoard as board, stressScenario as scenario, stressSetup as setup, STRESS_MASTERS as MASTERS } from "./domain-nseat-stress.js";

const OUT = { inZone: false, returns: 0, nextCost: 0 };
const ROLES: Array<[Format, Seat]> = [["ffa3", "p2"], ["ffa4", "p3"], ["tag", "p2"], ["tag", "p3"]];
const SCALES = ["Stargazer Magician", "Timegazer Magician"] as const;
export const DOMAIN_NSEAT_STRESS_SUMMONS: Scenario[] = [];
for (const [format, seat] of ROLES) {
  const before = turnsBefore(format, seat);
  DOMAIN_NSEAT_STRESS_SUMMONS.push(
    scenario(format, `monster-set-by-${seat}`, {
      setup: setup(format),
      steps: [...before, expectOffered("set", { card: MASTERS[seat], from: "dmz" }, seat), setCard({ card: MASTERS[seat], from: "dmz" }, seat),
        expectNotOffered("normalSummon", "Mystical Elf", seat),
        board(format, { [seat]: { monsters: [MASTERS[seat]], zones: { m0: { card: MASTERS[seat], pos: "facedown" } }, deckMaster: OUT } })],
    }),
    scenario(format, `fusion-master-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Gaia the Dragon Champion", hand: ["Polymerization", "Fusion Conscription"], monsters: ["Gaia The Fierce Knight", "Curse of Dragon"], deck: ["Mystical Elf", "Curse of Dragon"] } }),
      // A type-only Extra Deck filter stays blind to the zone. The proper Fusion procedure can see it.
      steps: [...before, expectNotOffered("activate", "Fusion Conscription", seat), activate("Polymerization", seat), select("Gaia The Fierce Knight", "Curse of Dragon"),
        board(format, { [seat]: { monsters: ["Gaia the Dragon Champion"], grave: ["Polymerization", "Gaia The Fierce Knight", "Curse of Dragon"], deckMaster: OUT } })],
    }),
    scenario(format, `synchro-master-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Stardust Dragon", monsters: ["The Magical King of Dimension Zeta", "Axe Raider"] } }),
      steps: [...before, specialSummon({ card: "Stardust Dragon", from: "dmz" }, seat), select("The Magical King of Dimension Zeta", "Axe Raider"),
        board(format, { [seat]: { monsters: ["Stardust Dragon"], grave: ["The Magical King of Dimension Zeta", "Axe Raider"], deckMaster: OUT } })],
    }),
    scenario(format, `xyz-master-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Number 39: Utopia", monsters: ["Celtic Guardian", "Axe Raider"] } }),
      steps: [...before, specialSummon({ card: "Number 39: Utopia", from: "dmz" }, seat), select("Celtic Guardian", "Axe Raider"),
        board(format, { [seat]: { monsters: ["Number 39: Utopia"], zones: { m0: { card: "Number 39: Utopia", materials: 2 } }, deckMaster: OUT } })],
    }),
    scenario(format, `ritual-master-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Demise, King of Armageddon", hand: ["Advanced Ritual Art"], deck: ["Mystical Elf", "Blue-Eyes White Dragon"] } }),
      steps: [...before, activate("Advanced Ritual Art", seat),
        // R-FFA-OPP-ONE: own Ritual material checks do not declare an opponent.
        expectPrompt({ kind: "sum", by: seat }),
        select("Blue-Eyes White Dragon"),
        board(format, { [seat]: { monsters: ["Demise, King of Armageddon"], grave: ["Advanced Ritual Art", "Blue-Eyes White Dragon"], deckMaster: OUT } })],
    }),
    ...["Axe Raider", "Flash Knight"].map((master) => scenario(format, `pendulum-${master === "Axe Raider" ? "normal" : "pendulum"}-master-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: master, pendulum: [...SCALES] } }),
      steps: [...before, specialSummon({ card: SCALES[0], from: "szone" }, seat), select(master),
        board(format, { [seat]: { monsters: [master], spells: [...SCALES], deckMaster: OUT } })],
    })),
    scenario(format, `extra-pendulum-master-cannot-pendulum-summon-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Odd-Eyes Rebellion Dragon", pendulum: [...SCALES] } }),
      steps: [...before, expectNotOffered("activate", { card: "Odd-Eyes Rebellion Dragon", from: "dmz" }, seat),
        specialSummon({ card: SCALES[0], from: "szone" }, seat), expectNotOffered("choice", "Odd-Eyes Rebellion Dragon", seat), select("Mystical Elf"),
        board(format, { [seat]: { monsters: ["Mystical Elf"], spells: [...SCALES] } })],
    }),
    scenario(format, `zone-master-cannot-be-fusion-material-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Gaia The Fierce Knight", hand: ["Polymerization"], monsters: ["Curse of Dragon"], extra: ["Gaia the Dragon Champion"] } }),
      steps: [...before, expectNotOffered("activate", "Polymerization", seat), endTurn(seat),
        board(format, { [seat]: { monsters: ["Curse of Dragon"] } })],
    }),
    scenario(format, `field-master-as-xyz-material-blocks-recall-by-${seat}`, {
      setup: setup(format, { [seat]: { deckMaster: "Axe Raider", monsters: ["Celtic Guardian"], extra: ["Number 39: Utopia"] } }),
      steps: [...before, normalSummon({ card: "Axe Raider", from: "dmz" }, seat), specialSummon("Number 39: Utopia", seat), select("Celtic Guardian", "Axe Raider"),
        expectPrompt({ by: seat, context: "action" }),
        board(format, { [seat]: { monsters: ["Number 39: Utopia"], zones: { m0: { card: "Number 39: Utopia", materials: 2 } }, deckMaster: OUT } })],
    }),
  );
}
