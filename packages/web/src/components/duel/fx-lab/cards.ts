import type { DuelCardInfo } from "@yugidraft/shared/duels";
import {
  TYPE_CONTINUOUS,
  TYPE_EFFECT,
  TYPE_EQUIP,
  TYPE_FLIP,
  TYPE_FUSION,
  TYPE_LINK,
  TYPE_MONSTER,
  TYPE_NORMAL,
  TYPE_PENDULUM,
  TYPE_QUICKPLAY,
  TYPE_RITUAL,
  TYPE_SPELL,
  TYPE_SYNCHRO,
  TYPE_TRAP,
  TYPE_XYZ,
} from "../constants";
import { ATTRIBUTE } from "../attack-styles";

/**
 * Real cards for the FX lab. Passcodes are the ones the effects key on (signature attacks in
 * attack-styles.ts, set pieces in fx3d/scene-plan.ts), so the lab plays the same code paths as a duel.
 * For a Link monster `level` carries the Link Rating, as the engine view does.
 */
const info = (
  code: number,
  name: string,
  type: number,
  attack: number,
  defense: number,
  level: number,
  attribute: number,
  race: string,
  description = "",
): DuelCardInfo => ({ code, name, description, type, attack, defense, level, attribute, race });

const spell = (code: number, name: string, extra = 0, description = ""): DuelCardInfo =>
  info(code, name, TYPE_SPELL | extra, 0, 0, 0, 0, "", description);
const trap = (code: number, name: string, extra = 0, description = ""): DuelCardInfo =>
  info(code, name, TYPE_TRAP | extra, 0, 0, 0, 0, "", description);

const NORMAL = TYPE_MONSTER | TYPE_NORMAL;
const EFFECT = TYPE_MONSTER | TYPE_EFFECT;

export const CARDS = {
  // Signature attackers
  blueEyes: info(89631139, "Blue-Eyes White Dragon", NORMAL, 3000, 2500, 8, ATTRIBUTE.LIGHT, "Dragon"),
  darkMagician: info(46986414, "Dark Magician", NORMAL, 2500, 2100, 7, ATTRIBUTE.DARK, "Spellcaster"),
  darkMagicianGirl: info(38033121, "Dark Magician Girl", EFFECT, 2000, 1700, 6, ATTRIBUTE.DARK, "Spellcaster"),
  redEyes: info(74677422, "Red-Eyes Black Dragon", NORMAL, 2400, 2000, 7, ATTRIBUTE.DARK, "Dragon"),
  cyberDragon: info(70095154, "Cyber Dragon", EFFECT, 2100, 1600, 5, ATTRIBUTE.LIGHT, "Machine"),
  summonedSkull: info(70781052, "Summoned Skull", NORMAL, 2500, 1200, 6, ATTRIBUTE.DARK, "Fiend"),
  // Name and race attackers
  gaia: info(6368038, "Gaia The Fierce Knight", NORMAL, 2300, 2100, 7, ATTRIBUTE.EARTH, "Warrior"),
  blueSirius: info(32995007, "Celestial Wolf Lord, Blue Sirius", TYPE_MONSTER | TYPE_SYNCHRO, 2400, 1500, 6, ATTRIBUTE.DARK, "Beast"),
  giantSoldier: info(13039848, "Giant Soldier of Stone", NORMAL, 1300, 2000, 3, ATTRIBUTE.EARTH, "Rock"),
  // Small monsters
  celtic: info(91152256, "Celtic Guardian", NORMAL, 1400, 1200, 4, ATTRIBUTE.EARTH, "Warrior"),
  mysticalElf: info(15025844, "Mystical Elf", NORMAL, 800, 2000, 4, ATTRIBUTE.LIGHT, "Spellcaster"),
  harpie: info(76812113, "Harpie Lady", NORMAL, 1300, 1400, 4, ATTRIBUTE.WIND, "Winged Beast"),
  feralImp: info(41392891, "Feral Imp", NORMAL, 1300, 1400, 4, ATTRIBUTE.DARK, "Fiend"),
  sangan: info(26202165, "Sangan", EFFECT, 1000, 600, 3, ATTRIBUTE.DARK, "Fiend"),
  kuriboh: info(40640057, "Kuriboh", EFFECT, 300, 200, 1, ATTRIBUTE.DARK, "Fiend"),
  manEater: info(54652250, "Man-Eater Bug", EFFECT | TYPE_FLIP, 450, 600, 2, ATTRIBUTE.EARTH, "Insect"),
  silverFang: info(90357090, "Silver Fang", NORMAL, 1200, 800, 3, ATTRIBUTE.EARTH, "Beast"),
  // Extra Deck, Ritual and Pendulum monsters
  darkPaladin: info(98502113, "Dark Paladin", TYPE_MONSTER | TYPE_FUSION, 2900, 2400, 8, ATTRIBUTE.DARK, "Spellcaster"),
  ultimateDragon: info(23995347, "Blue-Eyes Ultimate Dragon", TYPE_MONSTER | TYPE_FUSION, 4500, 3800, 12, ATTRIBUTE.LIGHT, "Dragon"),
  stardust: info(44508094, "Stardust Dragon", TYPE_MONSTER | TYPE_SYNCHRO, 2500, 2000, 8, ATTRIBUTE.WIND, "Dragon"),
  utopia: info(84013237, "Number 39: Utopia", TYPE_MONSTER | TYPE_XYZ, 2500, 2000, 4, ATTRIBUTE.LIGHT, "Warrior"),
  decodeTalker: info(1861629, "Decode Talker", TYPE_MONSTER | TYPE_LINK, 2300, 0, 3, ATTRIBUTE.DARK, "Cyberse"),
  blackChaos: info(30208479, "Magician of Black Chaos", TYPE_MONSTER | TYPE_RITUAL, 2800, 2600, 8, ATTRIBUTE.DARK, "Spellcaster"),
  oddEyes: info(16178681, "Odd-Eyes Pendulum Dragon", EFFECT | TYPE_PENDULUM, 2500, 2000, 7, ATTRIBUTE.DARK, "Dragon"),
  // Spells
  darkHole: spell(53129443, "Dark Hole", 0, "Destroy all monsters on the field."),
  raigeki: spell(12580477, "Raigeki", 0, "Destroy all monsters your opponent controls."),
  mst: spell(5318639, "Mystical Space Typhoon", TYPE_QUICKPLAY, "Target 1 Spell/Trap on the field; destroy that target."),
  heavyStorm: spell(19613556, "Heavy Storm", 0, "Destroy all Spells and Traps on the field."),
  monsterReborn: spell(83764718, "Monster Reborn", 0, "Target 1 monster in either GY; Special Summon it."),
  potOfGreed: spell(55144522, "Pot of Greed", 0, "Draw 2 cards."),
  foolishBurial: spell(81439173, "Foolish Burial", 0, "Send 1 monster from your Deck to the GY."),
  polymerization: spell(24094653, "Polymerization", 0, "Fusion Summon 1 Fusion Monster from your Extra Deck."),
  axe: spell(40619825, "Axe of Despair", TYPE_EQUIP, "The equipped monster gains 1000 ATK."),
  swords: spell(72302403, "Swords of Revealing Light", TYPE_CONTINUOUS, "Your opponent's monsters cannot declare an attack."),
  // Traps
  mirrorForce: trap(44095762, "Mirror Force", 0, "When an opponent's monster declares an attack: destroy all your opponent's Attack Position monsters."),
  sakuretsu: trap(56120475, "Sakuretsu Armor", 0, "When an opponent's monster declares an attack: destroy that monster."),
  torrential: trap(53582587, "Torrential Tribute", 0, "When a monster is Summoned: destroy all monsters on the field."),
  bottomless: trap(29401950, "Bottomless Trap Hole", 0, "When your opponent Summons a monster: destroy and banish it."),
  trapHole: trap(4206964, "Trap Hole", 0, "When your opponent Normal or Flip Summons a monster with 1000 or more ATK: destroy it."),
  solemn: trap(41420027, "Solemn Judgment", 0, "Negate the Summon of a monster, or the activation of a Spell/Trap card."),
  magicCylinder: trap(62279055, "Magic Cylinder", 0, "When an opponent's monster declares an attack: negate the attack, then inflict damage."),
} as const satisfies Record<string, DuelCardInfo>;

export type LabCardKey = keyof typeof CARDS;
