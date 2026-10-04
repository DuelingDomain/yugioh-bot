import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { GY, MZ, SZ, edit, ev, link, newBoard, type EventSpec, type LabScenario, type LabScript } from "./board";
import { POS_FACEDOWN_DEFENSE, POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE } from "../constants";
import { CARDS } from "./cards";

const geminiElf: DuelCardInfo = {
  code: 69140098, name: "Gemini Elf", description: "Elf twins that alternate their attacks.",
  attack: 1900, defense: 900, type: 17, level: 4, attribute: 1, race: "Spellcaster",
};
const catsEarTribe: DuelCardInfo = {
  code: 95841282, name: "Cat's Ear Tribe",
  description: "The original ATK of your opponent's monster(s) that battles with this card during his/her turn becomes 200 points during the Damage Step.",
  attack: 200, defense: 100, type: 33, level: 1, attribute: 1, race: "Beast-Warrior",
};
const enemyController: DuelCardInfo = {
  code: 98045062, name: "Enemy Controller", description: "Target 1 face-up monster your opponent controls; change that target's battle position.",
  attack: 0, defense: 0, type: 65538, level: 0, attribute: 0, race: "",
};

function catBattle(boosted: boolean): LabScript {
  const initial = newBoard({}, {}, "battle_start");
  const attacker = boosted ? { ...geminiElf, attack: 2900 } : geminiElf;
  edit.monster(0, 2, attacker)(initial);
  edit.monster(1, 2, catsEarTribe)(initial);
  if (boosted) {
    edit.spell(0, 0, CARDS.axe)(initial);
    initial.seats[0].spells[0]!.equippedTo = MZ(0, 2);
  }
  const why = { cause: "battle" as const, sourceKind: "monster" as const };
  const events: EventSpec[] = [{
    kind: "battle", seat: 0, text: "Damage calculation", zone: MZ(0, 2), target: MZ(1, 2),
    battle: { attacker: { attack: boosted ? 1200 : 200, defense: 900, position: 1 }, target: { attack: 200, defense: 100, position: 1 } },
  }];
  if (boosted) events.push(ev.damage(1, 1000));
  events.push(ev.destroy(1, catsEarTribe, MZ(1, 2), { ...why, sourceCode: geminiElf.code, sourceSeat: 0 }),
    ev.toGrave(1, catsEarTribe, MZ(1, 2), 0, { ...why, sourceCode: geminiElf.code, sourceSeat: 0 }));
  const edits = [edit.monster(1, 2, null), edit.grave(1, catsEarTribe)];
  if (boosted) edits.push(edit.lp(1, 7000));
  else {
    events.push(ev.destroy(0, geminiElf, MZ(0, 2), { ...why, sourceCode: catsEarTribe.code, sourceSeat: 1 }),
      ev.toGrave(0, geminiElf, MZ(0, 2), 0, { ...why, sourceCode: catsEarTribe.code, sourceSeat: 1 }));
    edits.push(edit.monster(0, 2, null), edit.grave(0, geminiElf));
  }
  events.push({ kind: "battle-end", text: "Damage Step ended" });
  return { initial, steps: [{ at: 0, events: [ev.attack(0, MZ(0, 2), MZ(1, 2))] }, { at: 900, events, edits }], tailMs: 4200 };
}

/**
 * The recorded engine batch of an attack on a face-down Man-Eater Bug (FLIP: target 1 monster on the field;
 * destroy it). One snapshot carries all of it: the attack, the flip, the activation, the target, the
 * attacker's destruction, the chain end and the Bug's own death by battle. The board of that snapshot is the
 * final one (both monsters already in the Graveyards), as in a duel.
 * `ownerAttacks`: the viewer (seat 0) attacks the opponent's Bug; otherwise the opponent attacks the viewer's Bug.
 * `bystander`: the Bug's effect marks another monster of the attacker's side, so the attacker survives and the
 * fight resolves after the chain.
 */
function flipEffectBattle(ownerAttacks: boolean, bystander = false): LabScript {
  const bug = CARDS.manEater;
  const dragon = CARDS.cyberDragon;
  const attackerSeat = ownerAttacks ? 0 : 1;
  const flipSeat = 1 - attackerSeat;
  const initial = newBoard({}, {}, "battle_start", attackerSeat);
  edit.monster(attackerSeat, 2, dragon)(initial);
  const victim = bystander ? CARDS.celtic : dragon;
  const victimZone = MZ(attackerSeat, bystander ? 3 : 2);
  if (bystander) edit.monster(attackerSeat, 3, victim)(initial);
  // The viewer knows its own Set card; the opponent's is hidden until it flips.
  if (ownerAttacks) edit.hiddenMonster(flipSeat, 2)(initial);
  else edit.monster(flipSeat, 2, bug, POS_FACEDOWN_DEFENSE)(initial);
  const effect = { cause: "effect" as const, sourceCode: bug.code, sourceKind: "monster" as const, sourceSeat: flipSeat };
  const battle = { cause: "battle" as const, sourceCode: dragon.code, sourceKind: "monster" as const, sourceSeat: attackerSeat };
  const events: EventSpec[] = [
    ev.attack(attackerSeat, MZ(attackerSeat, 2), MZ(flipSeat, 2)),
    ev.position(flipSeat, bug, MZ(flipSeat, 2), POS_FACEDOWN_DEFENSE, POS_FACEUP_DEFENSE, true),
    { kind: "battle", seat: attackerSeat, text: "Damage calculation", zone: MZ(attackerSeat, 2), target: MZ(flipSeat, 2),
      battle: { attacker: { attack: dragon.attack, defense: dragon.defense, position: POS_FACEUP_ATTACK },
        target: { attack: bug.attack, defense: bug.defense, position: POS_FACEUP_DEFENSE } } },
    ev.activate(flipSeat, bug, MZ(flipSeat, 2), 1),
    { kind: "target", seat: flipSeat, chainIndex: 1, text: "Chain Link 1 targets 1 card", targets: [victimZone] },
    ev.chain("chain-resolving", flipSeat, bug, 1),
    { ...ev.toGrave(attackerSeat, victim, victimZone, 0, effect), fromPosition: POS_FACEUP_ATTACK },
    { kind: "target", seat: flipSeat, chainIndex: 1, text: "Chain Link 1 targets 1 card", targets: [GY(attackerSeat, 0)] },
    ev.chain("chain-resolved", flipSeat, bug, 1),
    { ...ev.destroy(attackerSeat, victim, victimZone, effect), fromPosition: POS_FACEUP_ATTACK },
    ev.chainEnd(),
    { ...ev.toGrave(flipSeat, bug, MZ(flipSeat, 2), 0, battle), fromPosition: POS_FACEUP_DEFENSE },
    { ...ev.destroy(flipSeat, bug, MZ(flipSeat, 2), battle), fromPosition: POS_FACEUP_DEFENSE },
    { kind: "battle-end", text: "Damage Step ended" },
  ];
  return {
    initial, tailMs: 6200,
    steps: [{ at: 0, events, edits: [
      ...(bystander ? [edit.monster(attackerSeat, 3, null), edit.grave(attackerSeat, victim)] : [edit.monster(attackerSeat, 2, null), edit.grave(attackerSeat, dragon)]),
      edit.monster(flipSeat, 2, null), edit.grave(flipSeat, bug),
    ] }],
  };
}

export const BATTLE_EFFECT_SCENARIOS: LabScenario[] = [
  {
    id: "battle-flip-effect-attack", category: "Attacks", name: "Man-Eater Bug: attacked, flips, destroys the attacker",
    description: "Cyber Dragon attacks a Set Man-Eater Bug. In order: the attack, the flip, the Bug glows with the chain, the Dragon is marked as the target, the Dragon is destroyed, then the Bug dies in the battle.",
    build: () => flipEffectBattle(true),
  },
  {
    id: "battle-flip-effect-attack-opponent", category: "Attacks", name: "Man-Eater Bug: your Bug is attacked",
    description: "The opponent's Cyber Dragon attacks your Set Man-Eater Bug. The same beats from the other side of the table.",
    build: () => flipEffectBattle(false),
  },
  {
    id: "battle-flip-effect-bystander", category: "Attacks", name: "Man-Eater Bug: flips, destroys another monster",
    description: "Cyber Dragon attacks a Set Man-Eater Bug. The Bug's effect marks Celtic Guardian, not the attacker. In order: the attack, the flip, the chain glow, the mark, Celtic Guardian is destroyed, then the Bug dies in the battle.",
    build: () => flipEffectBattle(true, true),
  },
  {
    id: "battle-enemy-controller-defender", category: "Attacks", name: "Enemy Controller: destroy the turned defender",
    description: "Enemy Controller turns Celtic Guardian sideways. Gemini Elf then attacks; the defender stays sideways through calculation, the break and its departure.",
    build: () => {
      const initial = newBoard({}, {}, "battle_start");
      edit.monster(0, 2, geminiElf)(initial);
      edit.monster(1, 2, CARDS.celtic)(initial);
      edit.spell(0, 0, enemyController)(initial);
      const why = { cause: "battle" as const, sourceCode: geminiElf.code, sourceKind: "monster" as const, sourceSeat: 0 };
      return { initial, tailMs: 4200, steps: [
        { at: 0, events: [ev.activate(0, enemyController, SZ(0, 0), 1)], chain: [link(1, 0, enemyController)] },
        { at: 800, events: [ev.chain("chain-resolving", 0, enemyController, 1),
          ev.position(1, CARDS.celtic, MZ(1, 2), 1, 4), ev.chain("chain-resolved", 0, enemyController, 1),
          ev.move(0, enemyController, SZ(0, 0), { controller: 0, location: 16, sequence: 0 }, "send"), ev.chainEnd()],
          edits: [edit.position(1, 2, 4), edit.spell(0, 0, null), edit.grave(0, enemyController)], chain: [] },
        { at: 2200, events: [ev.attack(0, MZ(0, 2), MZ(1, 2))] },
        { at: 3100, events: [
          { kind: "battle", seat: 0, text: "Damage calculation", zone: MZ(0, 2), target: MZ(1, 2),
            battle: { attacker: { attack: 1900, defense: 900, position: 1 },
              target: { attack: CARDS.celtic.attack, defense: CARDS.celtic.defense, position: 4 } } },
          { ...ev.toGrave(1, CARDS.celtic, MZ(1, 2), 0, why), fromPosition: 4 },
          { ...ev.destroy(1, CARDS.celtic, MZ(1, 2), why), fromPosition: 4 },
          { kind: "battle-end", text: "Damage Step ended" }],
          edits: [edit.monster(1, 2, null), edit.grave(1, CARDS.celtic)] },
      ] };
    },
  },
  {
    id: "battle-cats-ear-tribe", category: "Attacks", name: "Cat's Ear Tribe: temporary 200 ATK",
    description: "Gemini Elf calculates at 200 ATK. Both monsters break, with no LP damage. The calculation values stay visible during the fight.",
    build: () => catBattle(false),
  },
  {
    id: "battle-cats-ear-tribe-equipped", category: "Attacks", name: "Cat's Ear Tribe: original ATK plus equip",
    description: "200 original ATK plus Axe of Despair's 1000. The fight shows 1200 ATK and 1000 damage; the surviving Gemini Elf returns to 2900 ATK.",
    build: () => catBattle(true),
  },
  {
    id: "battle-enemy-controller", category: "Card moves", name: "Enemy Controller: turn the opposing attacker",
    description: "A Battle Phase response changes the opponent's attacking Gemini Elf to Defense Position and stops the attack. No battle damage.",
    build: () => {
      const initial = newBoard({}, {}, "battle_start", 1);
      edit.monster(0, 2, CARDS.celtic)(initial);
      edit.monster(1, 2, geminiElf)(initial);
      edit.setSpell(0, 0, enemyController)(initial);
      return {
        initial, tailMs: 4200,
        steps: [
          { at: 0, events: [ev.attack(1, MZ(1, 2), MZ(0, 2))] },
          { at: 700, events: [ev.activate(0, enemyController, SZ(0, 0), 1)], edits: [edit.spell(0, 0, enemyController)], chain: [link(1, 0, enemyController)] },
          {
            at: 1500, events: [ev.chain("chain-resolving", 0, enemyController, 1),
              ev.position(1, geminiElf, MZ(1, 2), 1, 4), ev.chain("chain-resolved", 0, enemyController, 1),
              ev.move(0, enemyController, SZ(0, 0), { controller: 0, location: 16, sequence: 0 }, "send"), ev.chainEnd()],
            edits: [edit.position(1, 2, 4), edit.spell(0, 0, null), edit.grave(0, enemyController)], chain: [],
          },
        ],
      };
    },
  },
];
