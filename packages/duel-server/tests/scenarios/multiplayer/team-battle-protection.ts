import { opponentSeatsOf, seatCountFor, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { activate, attack, defineScenario, endTurn, expectBoard, expectOffered, pickOpponent, yes, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const CARDS = [
  { code: 14146794, name: "Donyoribo @Ignister", target: "Doshin @Ignister", damage: 1600 },
  { code: 37780349, name: "Destiny HERO - Dynatag", target: "direct", damage: 1700 },
  { code: 54569495, name: "Marincess Crown Tail", target: "Silver Fang", damage: 500 },
  { code: 60953118, name: "Arcana Force XIV - Temperance", target: "direct", damage: 1700 },
  { code: 63009228, name: "Rescue Interlacer", target: "Protron", damage: 1600 },
];

function protection(card: typeof CARDS[number], format: DuelFormat, mode: DuelMode, owner: number, other: boolean, enemyBattle = false): Scenario {
  const count = seatCountFor(format);
  const attacker = enemyBattle ? owner : opponentSeatsOf(format, owner)[0]!;
  const defender = enemyBattle ? opponentSeatsOf(format, owner)[0]! : other ? (owner + 2) % count : owner;
  const allied = !enemyBattle && (!other || format === "tag");
  const crown = card.code === 54569495;
  const dynatag = card.code === 37780349;
  const initialLp = format === "tag" ? 16000 : 8000;
  const setup: Scenario["setup"] = { format, mode, attackFirstTurn: true, skipOpeningDraw: true };
  for (let seat = 0; seat < count; seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: "Mystical Elf" } : {};
  setup[SEATS[owner]!]!.hand = crown ? [card.name, "Marincess Sea Horse"] : [card.name];
  setup[SEATS[attacker]!]!.monsters = ["Axe Raider"];
  if (card.target !== "direct") setup[SEATS[defender]!]!.monsters = [card.target];
  const steps: Step[] = Array.from({ length: attacker }, (_, seat) => endTurn(SEATS[seat]!));
  steps.push(attack("Axe Raider", card.target, SEATS[attacker]!), ...(count > 2 && card.target === "direct" ? [pickOpponent(SEATS[defender]!, SEATS[attacker]!)] : []));
  // Crown Tail can summon during another player's battle, but only protects its own LP in FFA.
  if (allied || crown) {
    steps.push(expectOffered("activate", { card: card.name, from: "hand" }, SEATS[owner]!), activate(card.name, SEATS[owner]!));
  }
  const board: Parameters<typeof expectBoard>[0] = {};
  for (let seat = 0; seat < count; seat++) {
    const protectedTeam = format === "tag" ? seat % 2 === owner % 2 : seat === owner;
    const damagedTeam = format === "tag" ? seat % 2 === defender % 2 : seat === defender;
    const burn = allied && dynatag ? (format === "tag" ? 2000 : 1000) : 0;
    board[SEATS[seat]!] = { lp: initialLp - burn - (damagedTeam ? crown && protectedTeam ? card.damage / 2 : allied ? 0 : card.damage : 0) };
  }
  board[SEATS[owner]!] = { ...board[SEATS[owner]!],
    hand: { [allied || crown ? "exclude" : "include"]: [card.name] },
    grave: { [allied && !crown ? "include" : "exclude"]: [card.name] },
    ...(crown ? { monsters: enemyBattle ? ["Axe Raider", card.name] : [card.name], grave: { include: ["Marincess Sea Horse"] } } : {}),
  };
  if (card.target !== "direct") board[SEATS[defender]!] = { ...board[SEATS[defender]!], grave: { ...board[SEATS[defender]!]!.grave as object, include: [...(defender === owner ? crown ? ["Marincess Sea Horse"] : [card.name] : []), card.target] } };
  steps.push(expectBoard(board));
  return defineScenario({ id: `team-battle-protection-${card.code}-${mode}-${format}-p${owner}-${enemyBattle ? "enemy" : other ? "other" : "self"}`,
    title: `${card.name}: ${format} ${enemyBattle ? "enemy team" : other ? "other seat" : "own seat"} battle damage outcome`,
    source: `card-scripts/official/c${card.code}.lua`, rules: format === "tag" ? ["R-TAG-TEAM-DAMAGE"] : [],
    tags: ["multiplayer", "hand-effects", `card:${card.code}`, format, mode], setup, steps });
}

export const TEAM_BATTLE_PROTECTION_SCENARIOS = CARDS.flatMap(card => (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    (format === "tag" ? [0, 1, 2, 3] : [0]).flatMap(owner => [protection(card, format, mode, owner, false),
      ...(format !== "1v1" ? [protection(card, format, mode, owner, true)] : []),
      ...(format === "tag" ? [protection(card, format, mode, owner, true, true)] : [])]))));

// The grave effect must compare the actual partner damage, not the holder's zero damage.
function crownGrave(format: DuelFormat, mode: DuelMode, owner: number, other: boolean, attackPoints: 1700 | 3000): Scenario {
  const count = seatCountFor(format);
  const attacker = opponentSeatsOf(format, owner)[0]!;
  const defender = other ? (owner + 2) % count : owner;
  const crown = "Marincess Crown Tail";
  const monster = attackPoints === 1700 ? "Axe Raider" : "Blue-Eyes White Dragon";
  const setup: Scenario["setup"] = { format, mode, attackFirstTurn: true, skipOpeningDraw: true };
  for (let seat = 0; seat < count; seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: "Mystical Elf" } : {};
  setup[SEATS[owner]!]!.grave = [crown, "Marincess Coral Anemone"];
  setup[SEATS[attacker]!]!.monsters = [monster];
  const steps: Step[] = Array.from({ length: attacker }, (_, seat) => endTurn(SEATS[seat]!));
  steps.push(attack(monster, "direct", SEATS[attacker]!), ...(count > 2 ? [pickOpponent(SEATS[defender]!, SEATS[attacker]!)] : []),
    yes(SEATS[owner]!));
  const protectedDamage = attackPoints <= 2000 && (!other || format === "tag");
  const board: Parameters<typeof expectBoard>[0] = {};
  for (let seat = 0; seat < count; seat++) {
    const hit = format === "tag" ? seat % 2 === defender % 2 : seat === defender;
    board[SEATS[seat]!] = { lp: (format === "tag" ? 16000 : 8000) - (hit && !protectedDamage ? attackPoints : 0) };
  }
  board[SEATS[owner]!] = { ...board[SEATS[owner]!], banished: [crown], grave: ["Marincess Coral Anemone"] };
  steps.push(expectBoard(board));
  return defineScenario({ id: `team-battle-protection-crown-grave-${mode}-${format}-p${owner}-${other ? "other" : "self"}-${attackPoints}`,
    title: `Crown Tail grave effect: ${attackPoints} damage against a 2000 threshold`,
    source: "card-scripts/official/c54569495.lua", rules: format === "tag" ? ["R-TAG-TEAM-DAMAGE"] : [],
    tags: ["multiplayer", "card:54569495", format, mode], setup, steps });
}

TEAM_BATTLE_PROTECTION_SCENARIOS.push(...(["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    (format === "tag" ? [0, 1, 2, 3] : [0]).flatMap(owner => ([1700, 3000] as const).flatMap(damage =>
      [crownGrave(format, mode, owner, false, damage), ...(format !== "1v1" ? [crownGrave(format, mode, owner, true, damage)] : [])])))));
