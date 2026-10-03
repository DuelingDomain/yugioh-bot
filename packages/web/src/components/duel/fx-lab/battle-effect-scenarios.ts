import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { MZ, SZ, edit, ev, link, newBoard, type EventSpec, type LabScenario, type LabScript } from "./board";
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

export const BATTLE_EFFECT_SCENARIOS: LabScenario[] = [
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
