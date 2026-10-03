import type { DuelCardInfo, DuelMasterRule } from "@yugidraft/shared/duels";
import { LOCATION_HAND, POS_FACEDOWN_DEFENSE, POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE } from "../constants";
import { ADD_TO_HAND } from "../duel-timing";
import {
  BANISHED,
  DECK,
  EXTRA,
  GY,
  HAND,
  MZ,
  SZ,
  edit,
  ev,
  link,
  newBoard,
  type Edit,
  type EventSpec,
  type LabCategory,
  type LabScenario,
  type LabScript,
  type LabStep,
  type SeatOptions,
} from "./board";
import { CARDS } from "./cards";
import { SERIES_SCENARIOS } from "./series-scenarios";
import { PRIORITY_SCENARIOS } from "./priority-scenarios";
import { BATTLE_EFFECT_SCENARIOS } from "./battle-effect-scenarios";

/**
 * The scenario catalog of the FX lab. Every scenario is a pure builder: it returns a start board and
 * timed steps (engine events plus the board after them), in the shape the duel server sends them.
 * Seat 0 is you (bottom), seat 1 is the opponent (top). Nothing here touches React or the DOM.
 */

const ME = 0;
const OPP = 1;

const C = CARDS;

const myHand: SeatOptions = { hand: [C.sangan, C.kuriboh, C.potOfGreed, C.monsterReborn], deck: 28, extra: [C.darkPaladin, C.stardust, C.utopia] };
const oppHand: SeatOptions = { hand: [null, null, null, null, null], deck: 29, extra: [null, null] };

type Setup = (edits: Edit[]) => void;

/** A board with the given pieces already placed. */
function board(setup: Setup = () => {}, me: SeatOptions = myHand, opp: SeatOptions = oppHand, phase = "main1", turnSeat = ME) {
  const start = newBoard(me, opp, phase, turnSeat);
  const edits: Edit[] = [];
  setup(edits);
  for (const apply of edits) apply(start);
  return start;
}

function script(initial: LabScript["initial"], steps: LabStep[], tailMs: number, extra: Partial<LabScript> = {}): LabScript {
  return { initial, steps, tailMs, ...extra };
}

/* ---------- attacks ---------- */

type Outcome = "direct" | "win" | "lose" | "tie" | "held" | "bounce";

/**
 * One fight. The attack is declared first; the battle resolves 900 ms later, as in a duel (the
 * attack animation starts when damage or a battle destroy arrives).
 */
function attackScript(attacker: DuelCardInfo, defender: DuelCardInfo | null, outcome: Outcome): LabScript {
  const defenderPosition = outcome === "held" || outcome === "bounce" ? POS_FACEUP_DEFENSE : POS_FACEUP_ATTACK;
  const start = board((e) => {
    e.push(edit.monster(ME, 2, attacker));
    if (defender) e.push(edit.monster(OPP, 2, defender, defenderPosition));
    e.push(edit.monster(OPP, 4, C.harpie));
  }, myHand, oppHand, "battle");
  const aZone = MZ(ME, 2);
  const dZone = MZ(OPP, 2);
  const declare: LabStep = { at: 0, events: [ev.attack(ME, aZone, defender ? dZone : undefined)] };
  const events: EventSpec[] = [];
  const edits: Edit[] = [];
  const by = (card: DuelCardInfo) => ({ cause: "battle" as const, sourceCode: card.code, sourceKind: "monster" as const });
  if (outcome === "direct") {
    const dmg = attacker.attack;
    events.push(ev.damage(OPP, dmg));
    edits.push(edit.lp(OPP, 8000 - dmg));
  } else if (defender) {
    if (outcome === "win" || outcome === "tie") {
      const dmg = Math.max(0, attacker.attack - defender.attack);
      if (dmg > 0) {
        events.push(ev.damage(OPP, dmg));
        edits.push(edit.lp(OPP, 8000 - dmg));
      }
      events.push(ev.destroy(OPP, defender, dZone, { ...by(attacker), sourceSeat: ME }), ev.toGrave(OPP, defender, dZone, 0, { ...by(attacker), sourceSeat: ME }));
      edits.push(edit.monster(OPP, 2, null), edit.grave(OPP, defender));
    }
    if (outcome === "lose" || outcome === "tie") {
      const dmg = Math.abs(attacker.attack - defender.attack);
      if (outcome === "lose") {
        events.push(ev.damage(ME, dmg));
        edits.push(edit.lp(ME, 8000 - dmg));
      }
      events.push(ev.destroy(ME, attacker, aZone, { ...by(defender), sourceSeat: OPP }), ev.toGrave(ME, attacker, aZone, 0, { ...by(defender), sourceSeat: OPP }));
      edits.push(edit.monster(ME, 2, null), edit.grave(ME, attacker));
    }
    if (outcome === "bounce") {
      const dmg = Math.max(0, defender.defense - attacker.attack);
      events.push(ev.damage(ME, dmg));
      edits.push(edit.lp(ME, 8000 - dmg));
    }
  }
  const resolve: LabStep = { at: 900, events, edits };
  // A held fight leaves no damage or destroy event; the next phase event closes it as a clash.
  const steps = outcome === "held" ? [declare, { at: 900, events: [ev.phase("Main Phase 2")], edits: [edit.phase("main2")] }] : [declare, resolve];
  return script(start, steps, 3600);
}

const attackScenario = (
  id: string,
  name: string,
  description: string,
  attacker: DuelCardInfo,
  defender: DuelCardInfo | null,
  outcome: Outcome,
): LabScenario => ({ id, category: "Attacks", name, description, build: () => attackScript(attacker, defender, outcome) });

const ATTACKS: LabScenario[] = [
  attackScenario("attack-lightning", "Lightning: Blue-Eyes White Dragon", "A signature attack. Direct hit on the opponent, lightning style, LIGHT tint.", C.blueEyes, null, "direct"),
  attackScenario("attack-arcane", "Arcane: Dark Magician", "A signature attack. Spellcasters fire arcane bolts.", C.darkMagician, C.celtic, "win"),
  attackScenario("attack-arcane-girl", "Arcane: Dark Magician Girl", "Second signature arcane attack, with a different tint.", C.darkMagicianGirl, C.feralImp, "win"),
  attackScenario("attack-flame", "Flame: Red-Eyes Black Dragon", "A signature attack. Fire breath.", C.redEyes, C.silverFang, "win"),
  attackScenario("attack-beam", "Beam: Cyber Dragon", "A signature attack. A straight energy beam.", C.cyberDragon, C.mysticalElf, "win"),
  attackScenario("attack-skull", "Lightning: Summoned Skull", "A signature attack. Lightning on a DARK monster.", C.summonedSkull, C.celtic, "win"),
  attackScenario("attack-slash", "Slash: Gaia The Fierce Knight", "The name rule: knight gives a sword slash.", C.gaia, C.silverFang, "win"),
  attackScenario("attack-claw", "Claw: Celestial Wolf Lord, Blue Sirius", "The name rule: wolf gives claw swipes.", C.blueSirius, C.feralImp, "win"),
  attackScenario("attack-impact", "Impact: Giant Soldier of Stone", "The race rule: Rock gives a heavy impact.", C.giantSoldier, null, "direct"),
  attackScenario("attack-win", "Fight: attacker wins", "ATK higher than the defender. The defender breaks and the Graveyard flight follows.", C.blueEyes, C.celtic, "win"),
  attackScenario("attack-lose", "Fight: attacker loses (counter strike)", "ATK lower. The defender strikes back and the attacker breaks.", C.celtic, C.blueEyes, "lose"),
  attackScenario("attack-tie", "Fight: both monsters break", "Equal ATK. Both break after the counter strike.", C.gaia, C.gaia, "tie"),
  attackScenario("attack-held", "Fight: nobody breaks", "ATK equals DEF of a Defense Position monster. A short clash, no damage.", C.celtic, C.giantSoldier, "held"),
  attackScenario("attack-bounce", "Fight: blow bounces back", "Attacker ATK below the DEF of a Defense Position monster. The attacker takes damage.", C.celtic, C.giantSoldier, "bounce"),
];

/* ---------- chains and trap/spell flows ---------- */

type ChainCard = { info: DuelCardInfo; seat: number; zone: ReturnType<typeof SZ> };

/** The events of one chain of effects: activations, then resolving, effect events and chain end. */
function chainFlow(cards: ChainCard[]): { activations: EventSpec[]; resolveHead: (index: number) => EventSpec[] } {
  const activations = cards.map((card, i) => ev.activate(card.seat, card.info, card.zone, i + 1));
  return { activations, resolveHead: (index) => [ev.chain("chain-resolving", cards[index - 1].seat, cards[index - 1].info, index)] };
}

type SpellDestroy = {
  card: DuelCardInfo;
  /** The zone of the activator: a Spell/Trap zone, or a monster zone for a monster effect. */
  zone: ReturnType<typeof SZ> | ReturnType<typeof MZ>;
  victims: Array<{ seat: number; info: DuelCardInfo; zone: ReturnType<typeof MZ> | ReturnType<typeof SZ> }>;
  kind: "spell" | "trap" | "monster";
  /** "destroy": destroy, then banish (Bottomless Trap Hole). "only": banish with no destroy (Evenly Matched). */
  banish?: "destroy" | "only";
};

/** A spell, trap or monster effect that destroys (or banishes) cards: activate first, then the chain resolves. */
function destroyChain(spec: SpellDestroy, setup: Setup, lead: LabStep[] = [], leadMs = 0, tailMs = 5200): LabScript {
  const activator = spec.zone.controller;
  const fromMonster = spec.kind === "monster";
  const start = board((e) => {
    setup(e);
    if (fromMonster) e.push(edit.monster(activator, spec.zone.sequence, spec.card));
    else e.push(spec.kind === "trap" ? edit.setSpell(activator, spec.zone.sequence, spec.card) : edit.spell(activator, spec.zone.sequence, null));
  });
  const flow = chainFlow([{ info: spec.card, seat: activator, zone: spec.zone }]);
  const effect: EventSpec[] = [];
  const edits: Edit[] = [];
  const graves = new Map<number, number>();
  const banished = new Map<number, number>();
  for (const victim of spec.victims) {
    const grave = graves.get(victim.seat) ?? 0;
    const pile = banished.get(victim.seat) ?? 0;
    const why = { cause: "effect" as const, sourceCode: spec.card.code, sourceKind: spec.kind, sourceSeat: activator };
    const isMonster = victim.zone.location === MZ(0, 0).location;
    if (spec.banish === "only") {
      effect.push(ev.move(victim.seat, victim.info, victim.zone, BANISHED(victim.seat, pile), "banish", why));
      banished.set(victim.seat, pile + 1);
      edits.push(edit.banish(victim.seat, victim.info));
    } else if (spec.banish === "destroy") {
      effect.push(ev.destroy(victim.seat, victim.info, victim.zone, why), ev.move(victim.seat, victim.info, victim.zone, BANISHED(victim.seat, pile), "banish", why));
      banished.set(victim.seat, pile + 1);
      edits.push(edit.banish(victim.seat, victim.info));
    } else {
      effect.push(ev.destroy(victim.seat, victim.info, victim.zone, why), ev.toGrave(victim.seat, victim.info, victim.zone, grave, why));
      graves.set(victim.seat, grave + 1);
      edits.push(edit.grave(victim.seat, victim.info));
    }
    edits.push(isMonster ? edit.monster(victim.seat, victim.zone.sequence, null) : edit.spell(victim.seat, victim.zone.sequence, null));
  }
  if (!fromMonster) {
    // The activated card goes to the Graveyard after it resolves.
    effect.push(ev.toGrave(activator, spec.card, spec.zone, graves.get(activator) ?? 0, {}));
    edits.push(edit.spell(activator, spec.zone.sequence, null), edit.grave(activator, spec.card));
  }
  const base = leadMs;
  const steps: LabStep[] = [
    ...lead,
    {
      at: base,
      events: flow.activations,
      edits: fromMonster ? [] : [edit.spell(activator, spec.zone.sequence, spec.card)],
      chain: [link(1, activator, spec.card)],
    },
    {
      at: base + 1100,
      events: [...flow.resolveHead(1), ...effect, ev.chain("chain-resolved", activator, spec.card, 1), ev.chainEnd()],
      edits,
      chain: [],
    },
  ];
  return script(start, steps, tailMs);
}

/* ---------- field wipes ---------- */

type Victim = SpellDestroy["victims"][number];

/** Zone numbers of n cards in a row of five, centred. */
const SPREAD: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const spread = (n: number): number[] => SPREAD[Math.max(1, Math.min(5, n))].slice(0, n);

const OPP_MONSTERS = [C.blueEyes, C.summonedSkull, C.harpie, C.gaia, C.redEyes];
const MY_MONSTERS = [C.celtic, C.darkMagician, C.cyberDragon, C.silverFang, C.mysticalElf];
const OPP_BACKS = [C.mirrorForce, C.trapHole, C.solemn, C.magicCylinder, C.sakuretsu];
const MY_BACKS = [C.swords, C.solemn, C.bottomless, C.magicCylinder, C.trapHole];

const monsterRow = (seat: number, infos: readonly DuelCardInfo[], seqs: readonly number[] = spread(infos.length)): Victim[] =>
  infos.map((info, i) => ({ seat, info, zone: MZ(seat, seqs[i]) }));
const spellRow = (seat: number, infos: readonly DuelCardInfo[], seqs: readonly number[] = spread(infos.length)): Victim[] =>
  infos.map((info, i) => ({ seat, info, zone: SZ(seat, seqs[i]) }));

/** Puts every victim on the board: monsters face-up, the opponent's Spells and Traps Set (hidden), yours Set (known). */
function place(victims: readonly Victim[]): Setup {
  return (e) => {
    for (const v of victims) {
      const seq = v.zone.sequence;
      if (v.zone.location === MZ(0, 0).location) e.push(edit.monster(v.seat, seq, v.info));
      else if (v.info === C.swords) e.push(edit.spell(v.seat, seq, v.info));
      else e.push(v.seat === OPP ? edit.hiddenSpell(v.seat, seq) : edit.setSpell(v.seat, seq, v.info));
    }
  };
}

const WIPE_TAIL = 6900;

/** A wipe of the field by one spell (or trap) of the activator at `zone`. */
function wipeScenario(
  id: string,
  name: string,
  description: string,
  card: DuelCardInfo,
  kind: "spell" | "trap" | "monster",
  victims: Victim[],
  options: { zone?: SpellDestroy["zone"]; banish?: SpellDestroy["banish"]; extra?: Setup; lead?: LabStep[]; leadMs?: number } = {},
): LabScenario {
  return {
    id,
    category: "Destroy",
    name,
    description,
    build: () =>
      destroyChain(
        { card, zone: options.zone ?? SZ(ME, kind === "monster" ? 2 : 1), kind, victims, banish: options.banish },
        (e) => {
          options.extra?.(e);
          place(victims)(e);
        },
        options.lead,
        options.leadMs,
        WIPE_TAIL + (options.leadMs ?? 0),
      ),
  };
}

const WIPES: LabScenario[] = [
  // Dark Hole: every monster of both sides
  wipeScenario("destroy-dark-hole", "Dark Hole", "Set piece: a black hole opens over the field and every monster of both sides is pulled in. Three.js scene.", C.darkHole, "spell", [
    ...monsterRow(ME, [C.celtic, C.darkMagician], [1, 3]),
    ...monsterRow(OPP, [C.blueEyes, C.summonedSkull, C.harpie], [1, 2, 3]),
  ]),
  wipeScenario("destroy-dark-hole-one", "Dark Hole: one monster", "Dark Hole with a single monster on the whole field. The hole still opens and swallows it.", C.darkHole, "spell", monsterRow(OPP, [C.blueEyes])),
  wipeScenario("destroy-dark-hole-full", "Dark Hole: full board (10 monsters)", "Five monsters on each side. The heaviest Dark Hole load.", C.darkHole, "spell", [...monsterRow(ME, MY_MONSTERS), ...monsterRow(OPP, OPP_MONSTERS)]),
  // Raigeki: the monsters of the opponent
  wipeScenario(
    "destroy-raigeki",
    "Raigeki",
    "Set piece: one giant bolt from the sky strikes every monster of the opponent. Your own monster stays. Three.js scene.",
    C.raigeki,
    "spell",
    monsterRow(OPP, [C.blueEyes, C.summonedSkull, C.harpie], [1, 2, 3]),
    { extra: (e) => e.push(edit.monster(ME, 2, C.darkMagician)) },
  ),
  wipeScenario("destroy-raigeki-one", "Raigeki: one monster", "Raigeki with one monster on the opponent's side.", C.raigeki, "spell", monsterRow(OPP, [C.summonedSkull]), { extra: (e) => e.push(edit.monster(ME, 2, C.darkMagician)) }),
  wipeScenario("destroy-raigeki-full", "Raigeki: five monsters", "A full row of five monsters of the opponent.", C.raigeki, "spell", monsterRow(OPP, OPP_MONSTERS), { extra: (e) => e.push(edit.monster(ME, 2, C.darkMagician)) }),
  // Harpie's Feather Duster: the Spells and Traps of the opponent
  wipeScenario(
    "destroy-feather-duster",
    "Harpie's Feather Duster",
    "Set piece: a flurry of feathers sweeps the Spell and Trap row of the opponent. Your own cards stay. Three.js scene.",
    C.featherDuster,
    "spell",
    spellRow(OPP, [C.mirrorForce, C.trapHole, C.solemn], [1, 2, 3]),
    { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie), edit.setSpell(ME, 3, C.solemn)) },
  ),
  wipeScenario("destroy-feather-duster-one", "Harpie's Feather Duster: one card", "One Set card of the opponent. The feather piece still plays.", C.featherDuster, "spell", spellRow(OPP, [C.mirrorForce]), { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie)) }),
  wipeScenario("destroy-feather-duster-full", "Harpie's Feather Duster: five cards", "A full Spell and Trap row of the opponent.", C.featherDuster, "spell", spellRow(OPP, OPP_BACKS), { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie)) }),
  // Heavy Storm: every Spell and Trap
  wipeScenario(
    "destroy-heavy-storm",
    "Heavy Storm (all Spells and Traps)",
    "Set piece: a storm front crosses the field and tears out the Spells and Traps of both sides. Three.js scene.",
    C.heavyStorm,
    "spell",
    [...spellRow(ME, [C.swords], [3]), ...spellRow(OPP, [C.mirrorForce, C.trapHole, C.solemn], [1, 2, 3])],
    { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie), edit.monster(ME, 2, C.celtic)) },
  ),
  wipeScenario("destroy-heavy-storm-one", "Heavy Storm: one card", "Only one other Spell or Trap on the field.", C.heavyStorm, "spell", spellRow(OPP, [C.mirrorForce]), { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie)) }),
  wipeScenario(
    "destroy-heavy-storm-full",
    "Heavy Storm: full board (9 cards)",
    "Four cards of yours and five of the opponent.",
    C.heavyStorm,
    "spell",
    [...spellRow(ME, MY_BACKS.slice(0, 4), [0, 2, 3, 4]), ...spellRow(OPP, OPP_BACKS)],
    { extra: (e) => e.push(edit.monster(OPP, 2, C.harpie), edit.monster(ME, 2, C.celtic)) },
  ),
  // Banish all
  wipeScenario(
    "destroy-banish-all",
    "Banish all (Evenly Matched)",
    "Set piece: a rift opens and the cards of the opponent are banished. One chain link banishes two or more cards. Three.js scene.",
    C.evenlyMatched,
    "trap",
    [...monsterRow(OPP, [C.blueEyes, C.summonedSkull, C.harpie], [1, 2, 3]), ...spellRow(OPP, [C.mirrorForce], [2])],
    { banish: "only", zone: SZ(ME, 2), extra: (e) => e.push(edit.monster(ME, 2, C.darkMagician)) },
  ),
  wipeScenario("destroy-banish-two", "Banish all: two cards", "The smallest group: two cards banished by one link.", C.evenlyMatched, "trap", monsterRow(OPP, [C.blueEyes, C.summonedSkull]), { banish: "only", zone: SZ(ME, 2) }),
  wipeScenario(
    "destroy-banish-full",
    "Banish all: eight cards of both sides",
    "Five monsters and three Set cards, with one monster of yours.",
    C.evenlyMatched,
    "trap",
    [...monsterRow(OPP, OPP_MONSTERS), ...spellRow(OPP, OPP_BACKS.slice(0, 3), [0, 2, 4]), ...monsterRow(ME, [C.celtic], [0])],
    { banish: "only", zone: SZ(ME, 1) },
  ),
  // Torrential Tribute: every monster after a summon
  {
    id: "destroy-torrential",
    category: "Destroy",
    name: "Torrential Tribute",
    description: "Set piece: a flood tears across the field after the opponent summons, and every monster of both sides is washed away. Three.js scene.",
    build: () => torrentialScript([{ seat: ME, info: C.celtic, zone: MZ(ME, 1) }, { seat: OPP, info: C.summonedSkull, zone: MZ(OPP, 1) }], 3),
  },
  {
    id: "destroy-torrential-one",
    category: "Destroy",
    name: "Torrential Tribute: only the summoned monster",
    description: "An empty field except the monster that was just summoned. One jet of water.",
    build: () => torrentialScript([], 2),
  },
  {
    id: "destroy-torrential-full",
    category: "Destroy",
    name: "Torrential Tribute: full board (10 monsters)",
    description: "Five monsters of yours and five of the opponent, the last one just summoned.",
    build: () => torrentialScript([...monsterRow(ME, MY_MONSTERS).map((v) => ({ ...v })), ...monsterRow(OPP, OPP_MONSTERS.slice(0, 4), [0, 1, 2, 3])], 4),
  },
  // Mass destroy: a card with no set piece that destroys two or more cards
  wipeScenario("destroy-mass", "Mass destroy (Lightning Vortex)", "A spell with no piece of its own that destroys three monsters in one link: the shock ring. Three.js scene.", C.lightningVortex, "spell", monsterRow(OPP, [C.blueEyes, C.summonedSkull, C.harpie], [1, 2, 3])),
  wipeScenario("destroy-mass-two", "Mass destroy: two monsters", "The smallest group: two cards, one link, no named piece.", C.lightningVortex, "spell", monsterRow(OPP, [C.blueEyes, C.summonedSkull])),
  wipeScenario("destroy-mass-full", "Mass destroy: five monsters", "A full row of the opponent.", C.lightningVortex, "spell", monsterRow(OPP, OPP_MONSTERS)),
  wipeScenario(
    "destroy-mass-monster",
    "Mass destroy by a monster effect (mixed cards)",
    "A monster on the field destroys monsters and Set cards of both sides. The ring leaves the monster.",
    C.chaosEmperor,
    "monster",
    [...monsterRow(OPP, [C.blueEyes, C.harpie], [0, 4]), ...spellRow(OPP, [C.mirrorForce, C.trapHole], [1, 3]), ...monsterRow(ME, [C.celtic], [0])],
    { zone: MZ(ME, 2) },
  ),
];

/** Torrential Tribute: the opponent summons into zone `summonZone`, then the trap destroys every monster. */
function torrentialScript(others: Victim[], summonZone: number): LabScript {
  const summoned = C.blueSirius;
  const summonEvents = summonPair(OPP, summoned, HAND(OPP, 0), MZ(OPP, summonZone), "normal");
  const lead: LabStep[] = [{ at: 0, events: summonEvents, edits: [edit.monster(OPP, summonZone, summoned), edit.removeHand(OPP, 0)] }];
  const victims: Victim[] = [...others, { seat: OPP, info: summoned, zone: MZ(OPP, summonZone) }];
  return destroyChain(
    { card: C.torrential, zone: SZ(ME, 2), kind: "trap", victims },
    (e) => place(others)(e),
    lead,
    1400,
    WIPE_TAIL + 1400,
  );
}

type MirrorOptions = {
  /** Attack-position monsters of the attacker that Mirror Force destroys. */
  victims: number;
  /** Defense-position monsters of the attacker that stay. */
  survivors?: number;
  /** "late": the trap resolves after the attack was declared and before it lands (the piece meets that attack). "none": no attack is in the log. */
  attack: "late" | "early" | "none";
  /** The seat that sets the trap. The other seat attacks. */
  caster?: number;
};

/** Mirror Force: the caster Sets it, the other seat attacks, every attack-position monster of the attacker is destroyed. */
function mirrorScenario(id: string, name: string, description: string, o: MirrorOptions): LabScenario {
  const caster = o.caster ?? ME;
  const other = caster === ME ? OPP : ME;
  const survivors = o.survivors ?? 0;
  const pool = other === OPP ? OPP_MONSTERS : MY_MONSTERS;
  const total = o.victims + survivors;
  const seqs = spread(total);
  // the defense-position survivors stand at the edges of the row, the victims between them
  const order = [...seqs].sort((x, y) => Math.abs(y - 2) - Math.abs(x - 2) || x - y);
  const defenseSeqs = new Set(order.slice(0, survivors));
  const victimSeqs = seqs.filter((q) => !defenseSeqs.has(q));
  const attackSeq = victimSeqs[Math.floor(victimSeqs.length / 2)];
  return {
    id,
    category: "Destroy",
    name,
    description,
    build: () => {
      const start = board((e) => {
        e.push(edit.setSpell(caster, 2, C.mirrorForce), edit.monster(caster, 2, caster === ME ? C.celtic : C.blueEyes));
        seqs.forEach((q, i) => e.push(edit.monster(other, q, pool[i % pool.length], defenseSeqs.has(q) ? POS_FACEUP_DEFENSE : POS_FACEUP_ATTACK)));
      }, myHand, oppHand, "battle", other);
      const why = { cause: "effect" as const, sourceCode: C.mirrorForce.code, sourceKind: "trap" as const, sourceSeat: caster };
      const victims = victimSeqs.map((q) => ({ info: pool[seqs.indexOf(q) % pool.length], seq: q }));
      const flow = chainFlow([{ info: C.mirrorForce, seat: caster, zone: SZ(caster, 2) }]);
      const attackAt = o.attack === "none" ? -1 : 0;
      const activateAt = o.attack === "late" ? 300 : o.attack === "early" ? 900 : 200;
      const resolveAt = o.attack === "late" ? 700 : o.attack === "early" ? 2000 : 1300;
      return script(
        start,
        [
          ...(attackAt >= 0 ? [{ at: attackAt, events: [ev.attack(other, MZ(other, attackSeq), MZ(caster, 2))] }] : []),
          { at: activateAt, events: flow.activations, edits: [edit.spell(caster, 2, C.mirrorForce)], chain: [link(1, caster, C.mirrorForce)] },
          {
            at: resolveAt,
            events: [
              ...flow.resolveHead(1),
              ...victims.flatMap((v, i) => [ev.destroy(other, v.info, MZ(other, v.seq), why), ev.toGrave(other, v.info, MZ(other, v.seq), i, why)]),
              ev.toGrave(caster, C.mirrorForce, SZ(caster, 2), 0, {}),
              ev.chain("chain-resolved", caster, C.mirrorForce, 1),
              ev.chainEnd(),
            ],
            edits: [
              ...victims.map((v) => edit.monster(other, v.seq, null)),
              ...victims.map((v) => edit.grave(other, v.info)),
              edit.spell(caster, 2, null),
              edit.grave(caster, C.mirrorForce),
            ],
            chain: [],
          },
        ],
        resolveAt + 4000,
      );
    },
  };
}

const MIRROR_SCENARIOS: LabScenario[] = [
  mirrorScenario("destroy-mirror-force", "Mirror Force", "Set piece: a prism wall reflects the attack and shatters the attackers. Three.js scene.", { victims: 3, attack: "early" }),
  mirrorScenario("destroy-mirror-force-one", "Mirror Force: one attacker", "One attack-position monster. The wall and the beams still play.", { victims: 1, attack: "early" }),
  mirrorScenario("destroy-mirror-force-full", "Mirror Force: five attackers", "A full row of five attack-position monsters.", { victims: 5, attack: "early" }),
  mirrorScenario("destroy-mirror-force-defense", "Mirror Force: defense monsters stay", "Three attack-position monsters break; two defense-position monsters at the edges stay on the board.", { victims: 3, survivors: 2, attack: "early" }),
  mirrorScenario("destroy-mirror-force-one-defense", "Mirror Force: one attacker, two defenders", "One attack-position monster breaks; two defense-position monsters stay.", { victims: 1, survivors: 2, attack: "early" }),
  mirrorScenario("destroy-mirror-force-incoming", "Mirror Force: meets the attack", "The trap resolves while the attack is still on its way. The wall is up when the attack lands and the scene draws no bolt of its own.", { victims: 3, survivors: 1, attack: "late" }),
  mirrorScenario("destroy-mirror-force-incoming-one", "Mirror Force: meets the attack, one attacker", "One attacker and an attack still on its way.", { victims: 1, attack: "late" }),
  mirrorScenario("destroy-mirror-force-no-attack", "Mirror Force: no attack in the log", "No attack is declared first, so the scene uses its own bolt.", { victims: 3, attack: "none" }),
  mirrorScenario("destroy-mirror-force-opp", "Mirror Force: the opponent casts", "The opponent Sets Mirror Force and your monsters break. The wall stands on the opponent's side.", { victims: 3, survivors: 1, attack: "early", caster: OPP }),
  mirrorScenario("destroy-mirror-force-opp-full", "Mirror Force: the opponent casts, five attackers", "Five of your attack-position monsters break under the opponent's wall.", { victims: 5, attack: "early", caster: OPP }),
];


/** Actual server order, including destroy markers deferred until after the resolving link. */
function destructionSequence(source: DuelCardInfo, trap: boolean, victims: Victim[]): LabScript {
  const sourceZone = SZ(ME, 1);
  const initial = board((edits) => {
    if (trap) edits.push(edit.setSpell(ME, 1, source));
    for (const victim of victims) edits.push(victim.zone.location === MZ(0, 0).location
      ? edit.monster(victim.seat, victim.zone.sequence, victim.info) : edit.setSpell(victim.seat, victim.zone.sequence, victim.info));
  }, { ...myHand, hand: trap ? myHand.hand : [source, ...myHand.hand!] });
  const why = { cause: "effect" as const, sourceCode: source.code, sourceKind: trap ? "trap" as const : "spell" as const, sourceSeat: ME };
  const events: EventSpec[] = [];
  const edits: Edit[] = [];
  const graves = new Map<number, number>();
  if (!trap) { events.push(ev.move(ME, source, HAND(ME, 0), sourceZone, "activate")); edits.push(edit.removeHand(ME, 0)); }
  events.push(ev.activate(ME, source, sourceZone, 1), ev.chain("chain-resolving", ME, source, 1));
  for (const victim of victims) {
    const index = graves.get(victim.seat) ?? 0;
    events.push(ev.toGrave(victim.seat, victim.info, victim.zone, index, why));
    graves.set(victim.seat, index + 1);
    edits.push(edit.grave(victim.seat, victim.info), victim.zone.location === MZ(0, 0).location
      ? edit.monster(victim.seat, victim.zone.sequence, null) : edit.spell(victim.seat, victim.zone.sequence, null));
  }
  events.push(ev.chain("chain-resolved", ME, source, 1), ...victims.map((v) => ev.destroy(v.seat, v.info, v.zone, why)),
    ev.move(ME, source, sourceZone, GY(ME, graves.get(ME) ?? 0), "send"), ev.chainEnd());
  edits.push(edit.spell(ME, 1, null), edit.grave(ME, source));
  const sangan = victims.find((v) => v.info.code === C.sangan.code);
  if (sangan) {
    events.push(ev.activate(sangan.seat, C.sangan, GY(sangan.seat, 0), 1), ev.chain("chain-resolving", sangan.seat, C.sangan, 1),
      ev.move(sangan.seat, C.kuriboh, DECK(sangan.seat), HAND(sangan.seat, initial.seats[sangan.seat].hand.length), "other", { addedToHand: true }),
      ev.chain("chain-resolved", sangan.seat, C.sangan, 1), ev.chainEnd());
    edits.push(edit.addHand(sangan.seat, C.kuriboh));
  } else {
    events.push(ev.draw(ME, C.kuriboh, initial.seats[ME].hand.length - 1));
    edits.push(edit.addHand(ME, C.kuriboh));
  }
  return script(initial, [{ at: 0, events, edits, chain: [] }], 12000);
}

const DESTROY: LabScenario[] = [
  {
    id: "spell-destroy-sequence", category: "Destroy", name: "Spell: activate, destroy, send, trigger",
    description: "One engine batch: MST enters from the hand and activates, the target breaks and reaches the GY, then MST reaches the GY before a later draw.",
    build: () => destructionSequence(C.mst, false, [{ seat: OPP, info: C.mirrorForce, zone: SZ(OPP, 2) }]),
  },
  {
    id: "trap-destroy-sequence", category: "Destroy", name: "Set trap: flip, destroy, send, search",
    description: "A Set Sakuretsu Armor flips and activates fully, destroys Sangan, and reaches the GY before Sangan's search is presented.",
    build: () => destructionSequence(C.sakuretsu, true, [{ seat: OPP, info: C.sangan, zone: MZ(OPP, 2) }]),
  },
  {
    id: "mass-destroy-sequence", category: "Destroy", name: "Mass destruction: all breaks before flights",
    description: "Dark Hole activates from the hand. Both fields break before any GY streak, then Dark Hole goes to the GY and Sangan searches.",
    build: () => destructionSequence(C.darkHole, false, [
      { seat: ME, info: C.sangan, zone: MZ(ME, 2) },
      ...[C.celtic, C.harpie, C.blueEyes].map((info, i) => ({ seat: OPP, info, zone: MZ(OPP, i + 1) })),
    ]),
  },
  ...WIPES,
  {
    id: "destroy-mst",
    category: "Destroy",
    name: "Mystical Space Typhoon (generic spell piece)",
    description: "A spell with no set piece. The plain spell sigil and the break-up of the Set card.",
    build: () =>
      destroyChain(
        { card: C.mst, zone: SZ(ME, 1), kind: "spell", victims: [{ seat: OPP, info: C.mirrorForce, zone: SZ(OPP, 2) }] },
        (e) => e.push(edit.hiddenSpell(OPP, 2), edit.monster(OPP, 2, C.harpie)),
      ),
  },
  ...MIRROR_SCENARIOS,
  {
    id: "destroy-sakuretsu",
    category: "Destroy",
    name: "Sakuretsu Armor",
    description: "Set piece: an armour slams into the attacker and explodes. Three.js scene.",
    build: () => {
      const start = board((e) => {
        e.push(edit.setSpell(ME, 2, C.sakuretsu), edit.monster(ME, 2, C.celtic), edit.monster(OPP, 2, C.blueEyes));
      }, myHand, oppHand, "battle", OPP);
      const why = { cause: "effect" as const, sourceCode: C.sakuretsu.code, sourceKind: "trap" as const, sourceSeat: ME };
      const flow = chainFlow([{ info: C.sakuretsu, seat: ME, zone: SZ(ME, 2) }]);
      return script(
        start,
        [
          { at: 0, events: [ev.attack(OPP, MZ(OPP, 2), MZ(ME, 2))] },
          { at: 900, events: flow.activations, edits: [edit.spell(ME, 2, C.sakuretsu)], chain: [link(1, ME, C.sakuretsu)] },
          {
            at: 2000,
            events: [
              ...flow.resolveHead(1),
              ev.destroy(OPP, C.blueEyes, MZ(OPP, 2), why),
              ev.toGrave(OPP, C.blueEyes, MZ(OPP, 2), 0, why),
              ev.toGrave(ME, C.sakuretsu, SZ(ME, 2), 0, {}),
              ev.chain("chain-resolved", ME, C.sakuretsu, 1),
              ev.chainEnd(),
            ],
            edits: [edit.monster(OPP, 2, null), edit.grave(OPP, C.blueEyes), edit.spell(ME, 2, null), edit.grave(ME, C.sakuretsu)],
            chain: [],
          },
        ],
        4800,
      );
    },
  },
  {
    id: "destroy-bottomless",
    category: "Destroy",
    name: "Bottomless Trap Hole",
    description: "Set piece: the floor falls away under a summoned monster, which is banished. Three.js scene.",
    build: () =>
      script(
        board((e) => e.push(edit.setSpell(ME, 2, C.bottomless), edit.monster(OPP, 2, C.blueSirius))),
        (() => {
          const why = { cause: "effect" as const, sourceCode: C.bottomless.code, sourceKind: "trap" as const, sourceSeat: ME };
          const flow = chainFlow([{ info: C.bottomless, seat: ME, zone: SZ(ME, 2) }]);
          return [
            { at: 0, events: flow.activations, edits: [edit.spell(ME, 2, C.bottomless)], chain: [link(1, ME, C.bottomless)] },
            {
              at: 1100,
              events: [
                ...flow.resolveHead(1),
                ev.destroy(OPP, C.blueSirius, MZ(OPP, 2), why),
                ev.move(OPP, C.blueSirius, MZ(OPP, 2), BANISHED(OPP, 0), "banish", why),
                ev.toGrave(ME, C.bottomless, SZ(ME, 2), 0, {}),
                ev.chain("chain-resolved", ME, C.bottomless, 1),
                ev.chainEnd(),
              ],
              edits: [edit.monster(OPP, 2, null), edit.banish(OPP, C.blueSirius), edit.spell(ME, 2, null), edit.grave(ME, C.bottomless)],
              chain: [],
            },
          ] satisfies LabStep[];
        })(),
        4800,
      ),
  },
  {
    id: "destroy-trap-hole",
    category: "Destroy",
    name: "Trap Hole",
    description: "Set piece: a pit opens under the monster that was just summoned. Three.js scene.",
    build: () => {
      const why = { cause: "effect" as const, sourceCode: C.trapHole.code, sourceKind: "trap" as const, sourceSeat: ME };
      const flow = chainFlow([{ info: C.trapHole, seat: ME, zone: SZ(ME, 2) }]);
      return script(
        board((e) => e.push(edit.setSpell(ME, 2, C.trapHole), edit.monster(OPP, 3, C.harpie)), myHand, { ...oppHand, hand: [C.summonedSkull, null, null, null] }, "main1", OPP),
        [
          {
            at: 0,
            events: summonPair(OPP, C.summonedSkull, HAND(OPP, 0), MZ(OPP, 2), "tribute"),
            edits: [edit.monster(OPP, 2, C.summonedSkull), edit.removeHand(OPP, 0)],
          },
          { at: 1400, events: flow.activations, edits: [edit.spell(ME, 2, C.trapHole)], chain: [link(1, ME, C.trapHole)] },
          {
            at: 2500,
            events: [
              ...flow.resolveHead(1),
              ev.destroy(OPP, C.summonedSkull, MZ(OPP, 2), why),
              ev.toGrave(OPP, C.summonedSkull, MZ(OPP, 2), 0, why),
              ev.toGrave(ME, C.trapHole, SZ(ME, 2), 0, {}),
              ev.chain("chain-resolved", ME, C.trapHole, 1),
              ev.chainEnd(),
            ],
            edits: [edit.monster(OPP, 2, null), edit.grave(OPP, C.summonedSkull), edit.spell(ME, 2, null), edit.grave(ME, C.trapHole)],
            chain: [],
          },
        ],
        4500,
      );
    },
  },
  {
    id: "destroy-trap-generic",
    category: "Destroy",
    name: "Destroyed by a trap (generic trap piece)",
    description: "A trap with no set piece of its own: the glyph and chain rattle, then the break-up.",
    build: () =>
      destroyChain(
        { card: C.magicCylinder, zone: SZ(ME, 2), kind: "trap", victims: [{ seat: OPP, info: C.summonedSkull, zone: MZ(OPP, 2) }] },
        (e) => e.push(edit.monster(OPP, 2, C.summonedSkull)),
      ),
  },
  {
    id: "destroy-monster-effect",
    category: "Destroy",
    name: "Destroyed by a monster effect",
    description: "A monster that destroys a card by its effect: the travelling mark and the break-up.",
    build: () => {
      const why = { cause: "effect" as const, sourceCode: C.cyberDragon.code, sourceKind: "monster" as const, sourceSeat: ME };
      const flow = chainFlow([{ info: C.cyberDragon, seat: ME, zone: MZ(ME, 2) }]);
      return script(
        board((e) => e.push(edit.monster(ME, 2, C.cyberDragon), edit.monster(OPP, 2, C.summonedSkull))),
        [
          { at: 0, events: flow.activations, chain: [link(1, ME, C.cyberDragon)] },
          {
            at: 1100,
            events: [
              ...flow.resolveHead(1),
              ev.destroy(OPP, C.summonedSkull, MZ(OPP, 2), why),
              ev.toGrave(OPP, C.summonedSkull, MZ(OPP, 2), 0, why),
              ev.chain("chain-resolved", ME, C.cyberDragon, 1),
              ev.chainEnd(),
            ],
            edits: [edit.monster(OPP, 2, null), edit.grave(OPP, C.summonedSkull)],
            chain: [],
          },
        ],
        4200,
      );
    },
  },
  {
    id: "destroy-rule",
    category: "Destroy",
    name: "Plain break-up (game rule)",
    description: "A destroy with no card cause. No set piece; the card breaks and goes to the Graveyard.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(OPP, 2, C.celtic))),
        [
          {
            at: 0,
            events: [ev.destroy(OPP, C.celtic, MZ(OPP, 2), { cause: "rule" }), ev.toGrave(OPP, C.celtic, MZ(OPP, 2), 0, {})],
            edits: [edit.monster(OPP, 2, null), edit.grave(OPP, C.celtic)],
          },
        ],
        2800,
      ),
  },
];

/* ---------- summons ---------- */

/** The events of a summon the way the server sends them: the move from the origin, then the summon. */
function summonPair(
  seat: number,
  info: DuelCardInfo,
  from: ReturnType<typeof HAND>,
  zone: ReturnType<typeof MZ>,
  kind: NonNullable<EventSpec["summonKind"]>,
): EventSpec[] {
  return [ev.move(seat, info, from, zone, "summon"), ev.summon(seat, info, zone, kind)];
}

function summonScenario(
  id: string,
  name: string,
  description: string,
  info: DuelCardInfo,
  kind: NonNullable<EventSpec["summonKind"]>,
  options: { from?: "hand" | "extra"; tribute?: DuelCardInfo; position?: number } = {},
): LabScenario {
  return {
    id,
    category: "Summons",
    name,
    description,
    build: () => {
      const fromExtra = options.from === "extra";
      const handIndex = 0;
      const start = board(
        (e) => {
          if (options.tribute) e.push(edit.monster(ME, 3, options.tribute));
          e.push(edit.monster(OPP, 2, C.celtic));
        },
        { ...myHand, hand: [info, ...(myHand.hand ?? [])], extra: fromExtra ? [info, ...(myHand.extra ?? [])] : myHand.extra },
        oppHand,
      );
      const origin = fromExtra ? EXTRA(ME, 0) : HAND(ME, handIndex);
      const events: EventSpec[] = [];
      const edits: Edit[] = [];
      if (options.tribute) {
        events.push(ev.toGrave(ME, options.tribute, MZ(ME, 3), 0, {}));
        edits.push(edit.monster(ME, 3, null), edit.grave(ME, options.tribute));
      }
      events.push(...summonPair(ME, info, origin, MZ(ME, 2), kind));
      edits.push(edit.monster(ME, 2, info, options.position ?? POS_FACEUP_ATTACK), fromExtra ? edit.removeExtra(ME, 0) : edit.removeHand(ME, handIndex));
      return script(start, [{ at: 0, events, edits }], 3600);
    },
  };
}

const SUMMONS: LabScenario[] = [
  summonScenario("summon-normal", "Normal Summon", "A small monster from the hand. The plain arrival and the banner with the card portrait.", C.celtic, "normal"),
  summonScenario("summon-tribute-heavy", "Tribute Summon (heavy, 2500 ATK or more)", "A tribute for a strong monster. The heavy arrival: hologram and shake.", C.summonedSkull, "tribute", { tribute: C.feralImp }),
  summonScenario("summon-heavy-level", "Heavy Summon: Blue-Eyes White Dragon", "A level 7 or more monster counts as heavy, with the tribute.", C.blueEyes, "tribute", { tribute: C.sangan }),
  summonScenario("summon-special", "Special Summon", "A Special Summon from the hand.", C.cyberDragon, "special"),
  summonScenario("summon-flip", "Flip Summon", "A face-down monster turned face-up by a Flip Summon.", C.manEater, "flip"),
  summonScenario("summon-fusion", "Fusion Summon", "A Fusion Monster from the Extra Deck.", C.darkPaladin, "fusion", { from: "extra" }),
  summonScenario("summon-synchro", "Synchro Summon", "A Synchro Monster from the Extra Deck.", C.stardust, "synchro", { from: "extra" }),
  summonScenario("summon-xyz", "Xyz Summon", "An Xyz Monster from the Extra Deck.", C.utopia, "xyz", { from: "extra" }),
  summonScenario("summon-link", "Link Summon", "A Link Monster. The Link Rating 3 counts as heavy.", C.decodeTalker, "link", { from: "extra" }),
  summonScenario("summon-ritual", "Ritual Summon", "A Ritual Monster from the hand.", C.blackChaos, "ritual"),
  summonScenario("summon-pendulum", "Pendulum Summon", "A Pendulum Summon.", C.oddEyes, "pendulum"),
  summonScenario("summon-ultimate", "Fusion Summon (4500 ATK)", "The strongest arrival: a very heavy Fusion Monster.", C.ultimateDragon, "fusion", { from: "extra" }),
];

/* ---------- card moves ---------- */

function moveScenario(
  id: string,
  name: string,
  description: string,
  build: () => LabScript,
): LabScenario {
  return { id, category: "Card moves", name, description, build };
}

const MOVES: LabScenario[] = [
  moveScenario("move-draw", "Draw a card", "A card flies from the Deck to the hand.", () =>
    script(
      board(),
      [{ at: 0, events: [ev.draw(ME, C.heavyStorm, 4)], edits: [edit.drawFromDeck(ME), edit.addHand(ME, C.heavyStorm)] }],
      2600,
    ),
  ),
  moveScenario("move-draw-two", "Draw two cards", "Two draws in one batch, one after the other.", () =>
    script(
      board(),
      [
        {
          at: 0,
          events: [ev.draw(ME, C.polymerization, 4), ev.draw(ME, C.mst, 5)],
          edits: [edit.drawFromDeck(ME, 2), edit.addHand(ME, C.polymerization), edit.addHand(ME, C.mst)],
        },
      ],
      3200,
    ),
  ),
  moveScenario("move-draw-discard", "Draw and discard the same card", "One engine batch draws a card, then discards that same card. The draw finishes before its Graveyard flight begins.", () =>
    script(
      board(),
      [{
        at: 0,
        events: [
          { ...ev.draw(ME, C.heavyStorm, 4), handId: "departed-lab-draw-discard" },
          ev.move(ME, C.heavyStorm, HAND(ME, 4), GY(ME, 0), "discard"),
        ],
        edits: [edit.drawFromDeck(ME), edit.addHand(ME, C.heavyStorm), edit.removeHand(ME, 4), edit.grave(ME, C.heavyStorm)],
      }],
      3200,
    ),
  ),
  moveScenario("move-opp-draw", "Opponent draws", "The opponent draws a card you cannot see.", () =>
    script(board(), [{ at: 0, events: [ev.draw(OPP, null, 5)], edits: [edit.drawFromDeck(OPP), edit.addHand(OPP, null)] }], 2600),
  ),
  moveScenario("move-added-search", "Added to hand: search from the Deck", "A card effect searches the Deck. The card shows in the \"Added to hand\" showcase first.", () => {
    const flow = chainFlow([{ info: C.sangan, seat: ME, zone: MZ(ME, 2) }]);
    return script(
      board((e) => e.push(edit.monster(ME, 2, C.sangan))),
      [
        { at: 0, events: flow.activations, chain: [link(1, ME, C.sangan)] },
        {
          at: 1100,
          events: [
            ...flow.resolveHead(1),
            ev.addToHand(ME, C.cyberDragon, DECK(ME), HAND(ME, 4)),
            ev.chain("chain-resolved", ME, C.sangan, 1),
            ev.chainEnd(),
          ],
          edits: [edit.drawFromDeck(ME), edit.addHand(ME, C.cyberDragon)],
          chain: [],
        },
      ],
      4800,
    );
  }),
  moveScenario("move-added-discard", "Added to hand, then discarded", "One engine batch adds a searched card, then discards that same card. Its showcase and hand flight finish before its Graveyard flight begins.", () =>
    script(
      board(),
      [{
        at: 0,
        events: [
          { ...ev.addToHand(ME, C.cyberDragon, DECK(ME), HAND(ME, 4)), handId: "departed-lab-added-discard" },
          ev.move(ME, C.cyberDragon, HAND(ME, 4), GY(ME, 0), "discard"),
        ],
        edits: [edit.drawFromDeck(ME), edit.addHand(ME, C.cyberDragon), edit.removeHand(ME, 4), edit.grave(ME, C.cyberDragon)],
      }],
      4000,
    ),
  ),
  moveScenario("move-hand-order", "Hand order: engine slots", "A search appends to the hand, then a later engine shuffle moves its landing slot during flight and its glow after landing. A discard closes the gap. An opponent search appends and shuffles in one engine batch; its anonymous arrival still resolves to the appended sleeve.", () => {
    const initial = board();
    for (const seat of initial.seats) seat.hand.forEach((card, i) => { card.handId = `lab-${seat.seat}-${i}`; });
    const arrival = "lab-added";
    const flightStart = ADD_TO_HAND.riseMs + ADD_TO_HAND.holdMs;
    const landing = flightStart + ADD_TO_HAND.flyMs;
    return script(initial, [
      { at: 0, events: [{ ...ev.addToHand(ME, C.cyberDragon, DECK(ME), HAND(ME, 4)), handId: arrival }],
        edits: [edit.drawFromDeck(ME), edit.addHand(ME, C.cyberDragon), (b) => {
          const hand = b.seats[ME].hand;
          hand[4].handId = arrival;
        }] },
      // A later SHUFFLE_HAND batch changes query order without rewriting the original MOVE slot.
      { at: flightStart + ADD_TO_HAND.flyMs / 2, edits: [(b) => {
        const hand = b.seats[ME].hand;
        b.seats[ME].hand = [hand[3], hand[4], hand[0], hand[2], hand[1]];
        b.seats[ME].hand.forEach((c, i) => { c.sequence = i; });
      }] },
      { at: landing + 100, edits: [(b) => {
        const hand = b.seats[ME].hand;
        hand.splice(3, 0, hand.splice(1, 1)[0]);
        hand.forEach((c, i) => { c.sequence = i; });
      }] },
      { at: 3200, events: [ev.move(ME, C.cyberDragon, HAND(ME, 3), GY(ME, 0), "discard")],
        edits: [edit.removeHand(ME, 3), edit.grave(ME, C.cyberDragon)] },
      { at: 5000, events: [{ ...ev.addToHand(OPP, null, DECK(OPP), HAND(OPP, 5)), handId: "sleeve-11" }],
        edits: [edit.drawFromDeck(OPP), edit.addHand(OPP, null), (b) => {
          const hand = b.seats[OPP].hand;
          // MOVE appends, then SHUFFLE_HAND runs in the same batch. This audience's
          // queried sleeves keep their order and the arrival still names the live sleeve.
          hand[5].handId = "sleeve-11";
          b.seats[OPP].hand = hand.map((sleeve) => ({ ...sleeve }));
        }] },
      { at: 5000 + flightStart + ADD_TO_HAND.flyMs / 2, edits: [(b) => {
        // The public SHUFFLE_HAND snapshot refreshes sleeves in engine slots. The hidden
        // permutation is private, so neither card codes nor sleeve IDs follow it.
        b.seats[OPP].hand = b.seats[OPP].hand.map((sleeve) => ({ ...sleeve }));
        }] },
    ], 4000);
  }),
  moveScenario("move-added-salvage", "Added to hand: salvage from the Graveyard", "A monster comes back from the Graveyard to the hand.", () => {
    const flow = chainFlow([{ info: C.potOfGreed, seat: ME, zone: SZ(ME, 2) }]);
    return script(
      board((e) => e.push(edit.spell(ME, 2, C.potOfGreed), edit.grave(ME, C.darkMagician))),
      [
        { at: 0, events: flow.activations, chain: [link(1, ME, C.potOfGreed)] },
        {
          at: 1100,
          events: [
            ...flow.resolveHead(1),
            ev.addToHand(ME, C.darkMagician, GY(ME, 0), HAND(ME, 4)),
            ev.chain("chain-resolved", ME, C.potOfGreed, 1),
            ev.chainEnd(),
          ],
          edits: [edit.removeGrave(ME, 0), edit.addHand(ME, C.darkMagician)],
          chain: [],
        },
      ],
      4800,
    );
  }),
  moveScenario("move-added-bounce", "Return to hand: bounce from the field", "A monster on the field returns to the hand.", () =>
    script(
      board((e) => e.push(edit.monster(ME, 2, C.celtic))),
      [{ at: 0, events: [ev.move(ME, C.celtic, MZ(ME, 2), HAND(ME, 4), "return", { addedToHand: true })], edits: [edit.monster(ME, 2, null), edit.addHand(ME, C.celtic)] }],
      3600,
    ),
  ),
  moveScenario("move-opp-added", "Opponent adds a card to the hand", "A search by the opponent. You see only a card back.", () =>
    script(
      board(),
      [{ at: 0, events: [{ ...ev.addToHand(OPP, null, DECK(OPP), HAND(OPP, 5)), handId: "sleeve-11" }],
        edits: [edit.drawFromDeck(OPP), edit.addHand(OPP, null), (b) => {
          // The append and concealed SHUFFLE_HAND share one projected engine snapshot.
          b.seats[OPP].hand[5].handId = "sleeve-11";
          b.seats[OPP].hand = b.seats[OPP].hand.map((sleeve) => ({ ...sleeve }));
        }] }],
      3200,
    ),
  ),
  moveScenario("move-discard", "Discard from hand to the Graveyard", "A card flies from the hand to the Graveyard.", () =>
    script(
      board(),
      [{ at: 0, events: [ev.move(ME, C.kuriboh, HAND(ME, 1), GY(ME, 0), "discard")], edits: [edit.removeHand(ME, 1), edit.grave(ME, C.kuriboh)] }],
      2800,
    ),
  ),
  moveScenario("move-send", "Send from the Deck to the Graveyard", "Foolish Burial: a card goes from the Deck to the Graveyard.", () =>
    script(
      board(),
      [{ at: 0, events: [ev.move(ME, C.sangan, DECK(ME), GY(ME, 0), "send")], edits: [edit.drawFromDeck(ME), edit.grave(ME, C.sangan)] }],
      2800,
    ),
  ),
  moveScenario("move-banish", "Banish", "A card from the Graveyard is banished.", () =>
    script(
      board((e) => e.push(edit.grave(OPP, C.blueEyes))),
      [{ at: 0, events: [ev.move(OPP, C.blueEyes, GY(OPP, 0), BANISHED(OPP, 0), "banish")], edits: [edit.removeGrave(OPP, 0), edit.banish(OPP, C.blueEyes)] }],
      2800,
    ),
  ),
  moveScenario("move-set-monster", "Set a monster", "A monster Set face-down in Defense Position.", () =>
    script(
      board(),
      [
        {
          at: 0,
          events: [ev.move(ME, C.sangan, HAND(ME, 0), MZ(ME, 2), "set", { faceDown: true }), ev.set(ME, C.sangan, MZ(ME, 2))],
          edits: [edit.removeHand(ME, 0), edit.monster(ME, 2, C.sangan, POS_FACEDOWN_DEFENSE)],
        },
      ],
      3000,
    ),
  ),
  moveScenario("move-set-trap", "Set a Spell or Trap", "A card Set face-down in the Spell and Trap zone.", () =>
    script(
      board(),
      [
        {
          at: 0,
          events: [ev.move(ME, C.potOfGreed, HAND(ME, 2), SZ(ME, 1), "set", { faceDown: true }), ev.set(ME, C.potOfGreed, SZ(ME, 1))],
          edits: [edit.removeHand(ME, 2), edit.setSpell(ME, 1, C.potOfGreed)],
        },
      ],
      3000,
    ),
  ),
  moveScenario("move-opp-set", "Opponent sets a card", "The opponent Sets a card. You see a card back.", () =>
    script(
      board(),
      [
        {
          at: 0,
          events: [ev.move(OPP, null, HAND(OPP, 0), SZ(OPP, 2), "set", { faceDown: true }), ev.set(OPP, C.mirrorForce, SZ(OPP, 2))],
          edits: [edit.removeHand(OPP, 0), edit.hiddenSpell(OPP, 2)],
        },
      ],
      3000,
    ),
  ),
  moveScenario("move-flip", "Flip a Set monster face-up", "A face-down monster is flipped face-up (position event with the flip flag).", () =>
    script(
      board((e) => e.push(edit.monster(ME, 2, C.manEater, POS_FACEDOWN_DEFENSE))),
      [
        {
          at: 0,
          events: [ev.position(ME, C.manEater, MZ(ME, 2), POS_FACEDOWN_DEFENSE, POS_FACEUP_DEFENSE, true)],
          edits: [edit.position(ME, 2, POS_FACEUP_DEFENSE)],
        },
      ],
      2800,
    ),
  ),
  moveScenario("move-position", "Change battle position", "Attack Position to Defense Position.", () =>
    script(
      board((e) => e.push(edit.monster(ME, 2, C.celtic))),
      [
        {
          at: 0,
          events: [ev.position(ME, C.celtic, MZ(ME, 2), POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE)],
          edits: [edit.position(ME, 2, POS_FACEUP_DEFENSE)],
        },
      ],
      2400,
    ),
  ),
  moveScenario("move-extra", "Return to the Extra Deck", "A card returns from the field to the Extra Deck.", () =>
    script(
      board((e) => e.push(edit.monster(ME, 2, C.stardust))),
      [
        {
          at: 0,
          events: [ev.move(ME, C.stardust, MZ(ME, 2), EXTRA(ME, 3), "return")],
          edits: [edit.monster(ME, 2, null), (b) => { b.seats[ME].extra.push({ controller: ME, location: EXTRA(ME, 3).location, sequence: 3, position: POS_FACEDOWN_DEFENSE }); b.seats[ME].extraCount += 1; }],
        },
      ],
      2800,
    ),
  ),
];

/* ---------- chain ---------- */

function chainScenario(id: string, name: string, description: string, links: number, negateAt?: number): LabScenario {
  return {
    id,
    category: "Chain",
    name,
    description,
    build: () => {
      const cards: ChainCard[] = [
        { info: C.mst, seat: OPP, zone: SZ(OPP, 1) },
        { info: C.solemn, seat: ME, zone: SZ(ME, 2) },
        { info: C.magicCylinder, seat: OPP, zone: SZ(OPP, 3) },
      ].slice(0, links);
      const start = board((e) => {
        e.push(edit.setSpell(ME, 2, C.solemn), edit.hiddenSpell(OPP, 1), edit.hiddenSpell(OPP, 3));
        e.push(edit.monster(ME, 2, C.celtic), edit.monster(OPP, 2, C.harpie));
      });
      const flow = chainFlow(cards);
      const steps: LabStep[] = [];
      const snapshot = (n: number) => cards.slice(0, n).map((card, i) => link(i + 1, card.seat, card.info));
      cards.forEach((card, i) => {
        steps.push({
          at: i * 1300,
          events: [flow.activations[i]],
          edits: [card.seat === OPP ? edit.spell(OPP, card.zone.sequence, card.info) : edit.spell(ME, card.zone.sequence, card.info)],
          chain: snapshot(i + 1),
        });
      });
      // The whole resolution arrives as one batch, last link first.
      const events: EventSpec[] = [];
      for (let index = links; index >= 1; index -= 1) {
        const card = cards[index - 1];
        events.push(...flow.resolveHead(index));
        events.push(ev.chain(negateAt === index ? "chain-negated" : "chain-resolved", card.seat, card.info, index));
      }
      events.push(ev.chainEnd());
      steps.push({ at: links * 1300 + 600, events, chain: [] });
      return script(start, steps, 2000 + links * 1500);
    },
  };
}

const CHAIN: LabScenario[] = [
  chainScenario("chain-one", "One link", "A single activation: badge, resolving pulse and clear.", 1),
  chainScenario("chain-two", "Chain of two", "Two links. The last link resolves first.", 2),
  chainScenario("chain-three", "Chain of three", "Three links, the full resolution beat by beat.", 3),
  chainScenario("chain-negated", "Negated link", "Link 1 is negated: slash on the badge and the Negated banner.", 2, 1),
];

/* ---------- LP ---------- */

function lpScenario(id: string, name: string, description: string, build: () => LabScript): LabScenario {
  return { id, category: "LP", name, description, build };
}

const LP: LabScenario[] = [
  lpScenario("lp-battle", "Battle damage to the opponent", "The LP number rolls down and the plate takes a hit.", () =>
    script(board(), [{ at: 0, events: [ev.damage(OPP, 1800)], edits: [edit.lp(OPP, 6200)] }], 2800),
  ),
  lpScenario("lp-effect", "Effect damage to you", "Damage from a card effect on your own plate.", () =>
    script(board(), [{ at: 0, events: [ev.damage(ME, 1000, "effect")], edits: [edit.lp(ME, 7000)] }], 2800),
  ),
  lpScenario("lp-cost", "Pay LP as a cost", "A cost is paid. The plate drops by half.", () =>
    script(board(), [{ at: 0, events: [ev.damage(ME, 4000, "cost")], edits: [edit.lp(ME, 4000)] }], 2800),
  ),
  lpScenario("lp-big", "Big hit to low LP", "A large hit that leaves very few LP: the danger state.", () =>
    script(board(), [{ at: 0, events: [ev.damage(OPP, 7500, "effect")], edits: [edit.lp(OPP, 500)] }], 3200),
  ),
  lpScenario("lp-gain", "LP gain", "LP goes up with no event. The number rolls up.", () =>
    script(board((e) => e.push(edit.lp(ME, 3000))), [{ at: 0, edits: [edit.lp(ME, 5000)] }], 2600),
  ),
  lpScenario("lp-zero", "Zero LP", "The plate drops to zero.", () =>
    script(board((e) => e.push(edit.lp(OPP, 1200))), [{ at: 0, events: [ev.damage(OPP, 1200, "effect")], edits: [edit.lp(OPP, 0)] }], 3000),
  ),
];

/* ---------- banners ---------- */

function bannerScenario(id: string, name: string, description: string, build: () => LabScript): LabScenario {
  return { id, category: "Banners", name, description, build };
}

const BANNERS: LabScenario[] = [
  bannerScenario("banner-spell", "Activate a Spell", "The activation banner with the card portrait and its text.", () => {
    const flow = chainFlow([{ info: C.polymerization, seat: ME, zone: SZ(ME, 2) }]);
    return script(
      board(),
      [
        {
          at: 0,
          events: flow.activations,
          edits: [edit.spell(ME, 2, C.polymerization)],
          chain: [link(1, ME, C.polymerization)],
        },
        {
          at: 1200,
          events: [...flow.resolveHead(1), ev.chain("chain-resolved", ME, C.polymerization, 1), ev.chainEnd()],
          edits: [edit.spell(ME, 2, null), edit.grave(ME, C.polymerization)],
          chain: [],
        },
      ],
      3600,
    );
  }),
  bannerScenario("banner-trap", "Activate a Trap", "The activation banner of a Set trap that flips up.", () => {
    const flow = chainFlow([{ info: C.solemn, seat: OPP, zone: SZ(OPP, 2) }]);
    return script(
      board((e) => e.push(edit.hiddenSpell(OPP, 2))),
      [
        { at: 0, events: flow.activations, edits: [edit.spell(OPP, 2, C.solemn)], chain: [link(1, OPP, C.solemn)] },
        {
          at: 1200,
          events: [...flow.resolveHead(1), ev.chain("chain-resolved", OPP, C.solemn, 1), ev.chainEnd()],
          edits: [edit.spell(OPP, 2, null), edit.grave(OPP, C.solemn)],
          chain: [],
        },
      ],
      3600,
    );
  }),
  bannerScenario("banner-monster", "Monster effect", "The activation banner of a monster effect.", () => {
    const flow = chainFlow([{ info: C.sangan, seat: ME, zone: MZ(ME, 2) }]);
    return script(
      board((e) => e.push(edit.monster(ME, 2, C.sangan))),
      [
        { at: 0, events: flow.activations, chain: [link(1, ME, C.sangan)] },
        { at: 1200, events: [...flow.resolveHead(1), ev.chain("chain-resolved", ME, C.sangan, 1), ev.chainEnd()], chain: [] },
      ],
      3600,
    );
  }),
  bannerScenario("banner-negated", "Negated banner", "A chain link is negated. The Negated banner shows with the slash.", () => {
    const flow = chainFlow([
      { info: C.polymerization, seat: OPP, zone: SZ(OPP, 1) },
      { info: C.solemn, seat: ME, zone: SZ(ME, 2) },
    ]);
    return script(
      board((e) => e.push(edit.setSpell(ME, 2, C.solemn), edit.hiddenSpell(OPP, 1))),
      [
        { at: 0, events: [flow.activations[0]], edits: [edit.spell(OPP, 1, C.polymerization)], chain: [link(1, OPP, C.polymerization)] },
        {
          at: 1300,
          events: [flow.activations[1]],
          edits: [edit.spell(ME, 2, C.solemn)],
          chain: [link(1, OPP, C.polymerization), link(2, ME, C.solemn)],
        },
        {
          at: 2600,
          events: [
            ...flow.resolveHead(2),
            ev.chain("chain-resolved", ME, C.solemn, 2),
            ...flow.resolveHead(1),
            ev.chain("chain-negated", OPP, C.polymerization, 1),
            ev.chainEnd(),
          ],
          chain: [],
        },
      ],
      6000,
    );
  }),
  bannerScenario("banner-phase", "Phase ribbon", "The ribbon that names a new phase.", () =>
    script(board(), [{ at: 0, events: [ev.phase("Battle Phase")], edits: [edit.phase("battle")] }, { at: 2200, events: [ev.phase("Main Phase 2")], edits: [edit.phase("main2")] }], 3400),
  ),
  bannerScenario("banner-set", "Set banner", "The banner of a Set card, with a card back.", () =>
    script(
      board(),
      [
        {
          at: 0,
          events: [ev.move(ME, C.potOfGreed, HAND(ME, 2), SZ(ME, 1), "set", { faceDown: true }), ev.set(ME, C.potOfGreed, SZ(ME, 1))],
          edits: [edit.removeHand(ME, 2), edit.setSpell(ME, 1, C.potOfGreed)],
        },
      ],
      3000,
    ),
  ),
];

/* ---------- board states ---------- */

/** The "discard 2" pick bar over a board with hand cards to pick; `selected` are the option ids shown as picked. */
function selectScenario(id: string, name: string, description: string, selected: string[], interactive = false): LabScenario {
  const hand = [C.sangan, C.kuriboh, C.potOfGreed, C.monsterReborn];
  return {
    id,
    category: "Board states",
    name,
    description,
    build: () =>
      script(board((e) => e.push(edit.monster(ME, 2, C.celtic), edit.monster(OPP, 2, C.harpie))), [], 2400, {
        legalKeys: hand.map((_, index) => `0:${LOCATION_HAND}:${index}`),
        prompt: {
          selected,
          interactive,
          prompt: {
            id: "lab-select",
            seat: ME,
            kind: "cards",
            title: "Select the card(s) to discard",
            min: 2,
            max: 2,
            options: hand.map((card, index) => ({
              id: `card:${index}`,
              label: card.name,
              card,
              controller: ME,
              location: LOCATION_HAND,
              sequence: index,
            })),
          },
        },
      }),
  };
}

/** A field as a given Master Rule draws it: Extra Monster Zones from MR4, Pendulum Zones from MR3 (apart under MR3). */
function fieldRuleScenario(rule: DuelMasterRule, name: string, description: string): LabScenario {
  return {
    id: `state-field-mr${rule}`,
    category: "Board states",
    name,
    description,
    build: () =>
      script(
        board((e) => {
          e.push(edit.monster(ME, 1, C.celtic), edit.monster(ME, 3, C.blueEyes), edit.monster(OPP, 2, C.harpie), edit.setSpell(ME, 2, C.solemn), edit.hiddenSpell(OPP, 3));
          if (rule >= 4) e.push(edit.monster(ME, 5, C.decodeTalker), edit.monster(OPP, 5, C.decodeTalker));
          if (rule === 3) e.push(edit.spell(ME, 6, C.oddEyes), edit.spell(OPP, 7, C.oddEyes));
          if (rule >= 4) e.push(edit.spell(ME, 0, C.oddEyes), edit.spell(OPP, 4, C.oddEyes));
        }),
        [],
        2400,
        { masterRule: rule },
      ),
  };
}

const STATES: LabScenario[] = [
  {
    id: "state-equip",
    category: "Board states",
    name: "Equip: link and attach",
    description: "An Equip Spell attaches to a monster. The line between the two cards and the equip chip.",
    build: () => {
      const flow = chainFlow([{ info: C.axe, seat: ME, zone: SZ(ME, 2) }]);
      return script(
        board((e) => e.push(edit.monster(ME, 2, C.celtic), edit.monster(OPP, 2, C.harpie))),
        [
          { at: 0, events: flow.activations, edits: [edit.spell(ME, 2, C.axe)], chain: [link(1, ME, C.axe)] },
          {
            at: 1200,
            events: [...flow.resolveHead(1), ev.equip(ME, SZ(ME, 2), MZ(ME, 2)), ev.chain("chain-resolved", ME, C.axe, 1), ev.chainEnd()],
            edits: [edit.equipTo(ME, 2, MZ(ME, 2))],
            chain: [],
          },
        ],
        4200,
      );
    },
  },
  {
    id: "state-equip-still",
    category: "Board states",
    name: "Equip: standing link",
    description: "A board that already has an equip link. The line is drawn with no event.",
    build: () =>
      script(board((e) => e.push(edit.monster(ME, 2, C.celtic), edit.spell(ME, 2, C.axe), edit.equipTo(ME, 2, MZ(ME, 2)))), [], 2400),
  },
  {
    id: "state-usable",
    category: "Board states",
    name: "Glow on usable cards",
    description: "Cards with a legal action glow: a monster, a Spell in the hand and a Set trap.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(ME, 2, C.celtic), edit.setSpell(ME, 1, C.solemn))),
        [],
        2400,
        { legalKeys: ["0:2:0", "0:2:1", "0:4:2", "0:8:1"] },
      ),
  },
  {
    id: "state-aim",
    category: "Board states",
    name: "Attack aim arrow",
    description: "The arrow BattleFx draws while you choose an attack target: preview, aim and locked.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(ME, 2, C.blueEyes), edit.monster(OPP, 2, C.celtic), edit.monster(OPP, 4, C.harpie)), myHand, oppHand, "battle"),
        [],
        2400,
        { aim: { mode: "aim", from: "0:4:2", to: { zones: ["1:4:2"] } } },
      ),
  },
  {
    id: "state-aim-prompt",
    category: "Board states",
    name: "Aim arrow under a prompt",
    description: "The Battle Step response bar while an attack is aimed. The bar draws above the arrow; the arrow still shows over the board.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(ME, 2, C.blueEyes), edit.monster(OPP, 2, C.celtic), edit.monster(OPP, 4, C.harpie)), myHand, oppHand, "battle"),
        [],
        2400,
        {
          aim: { mode: "locked", from: "0:4:2", to: { zones: ["1:4:4"] } },
          prompt: {
            battleStep: "battle",
            prompt: {
              id: "lab-prompt",
              seat: ME,
              kind: "choice",
              title: "Activate its effect?",
              cancelable: true,
              context: { type: "chain", forced: false },
              options: [{ id: "card:0", label: "Blue-Eyes Spirit Dragon", card: C.blueSpirit }],
            },
          },
        },
      ),
  },
  selectScenario("state-select-discard", "Select prompt: discard 2", "The on-board pick bar with nothing picked yet. Confirm is off.", []),
  selectScenario(
    "state-select-discard-try",
    "Select prompt: discard 2, try it",
    "Click the hand cards to pick two. Hover and leave: a card is large only under the pointer, also after a click. A third card shakes with a hint; click a picked card to undo it.",
    [],
    true,
  ),
  selectScenario("state-select-discard-done", "Select prompt: discard 2, done", "The same bar with 2 of 2 picked. Confirm is the gold button.", ["card:0", "card:2"]),
  {
    id: "state-aim-direct",
    category: "Board states",
    name: "Attack aim arrow: direct",
    description: "The arrow points at the LP plate for a direct attack.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(ME, 2, C.blueEyes)), myHand, oppHand, "battle"),
        [],
        2400,
        { aim: { mode: "locked", from: "0:4:2", to: { lpSeat: OPP } } },
      ),
  },
  {
    id: "state-master-return",
    category: "Board states",
    name: "Deck Master returns",
    description: "A Domain duel: the Deck Master goes back to its zone from the Graveyard.",
    build: () =>
      script(
        board((e) => e.push(edit.grave(ME, C.darkMagician), edit.deckMaster(ME, C.darkMagician, { inZone: false, returns: 0, nextCost: 1000 }), edit.deckMaster(OPP, C.blueEyes, { inZone: true, returns: 0, nextCost: 1000 }))),
        [{ at: 0, edits: [edit.removeGrave(ME, 0), edit.deckMaster(ME, C.darkMagician, { inZone: true, returns: 1, nextCost: 2000 })] }],
        3600,
        { domain: true },
      ),
  },
  {
    id: "state-result-win",
    category: "Board states",
    name: "Result screen: you win",
    description: "The result screen reveal after the last damage.",
    build: () =>
      script(
        board((e) => e.push(edit.monster(ME, 2, C.blueEyes), edit.lp(OPP, 2000)), myHand, oppHand, "battle"),
        [
          { at: 0, events: [ev.attack(ME, MZ(ME, 2))] },
          { at: 900, events: [ev.damage(OPP, 2000)], edits: [edit.lp(OPP, 0)] },
          { at: 4200, result: { winnerSeat: ME, reason: "Life points reached 0" } },
        ],
        4000,
      ),
  },
  {
    id: "state-result-loss",
    category: "Board states",
    name: "Result screen: you lose",
    description: "The result screen reveal when the opponent wins.",
    build: () =>
      script(
        board((e) => e.push(edit.lp(ME, 1500))),
        [
          { at: 0, events: [ev.damage(ME, 1500, "effect")], edits: [edit.lp(ME, 0)] },
          { at: 2800, result: { winnerSeat: OPP, reason: "Life points reached 0" } },
        ],
        4000,
      ),
  },
  {
    id: "state-result-draw",
    category: "Board states",
    name: "Result screen: draw",
    description: "The result screen when the duel ends with no winner.",
    build: () => script(board(), [{ at: 0, result: { winnerSeat: null, reason: "Both players ran out of time" } }], 3600),
  },

  fieldRuleScenario(5, "Master Rule 5: Extra Monster Zones", "Two Extra Monster Zones between the fields (a Link monster each) and the Pendulum Zones in the outer Spell/Trap Zones."),
  fieldRuleScenario(3, "Master Rule 3: no Extra Monster Zones", "No Extra Monster Zones. The two Pendulum Zones are separate zones beside each field, so the board is wider."),
  fieldRuleScenario(1, "Master Rule 1: plain field", "No Extra Monster Zones and no Pendulum Zones: five monster zones, five Spell/Trap Zones and a Field Zone."),
];

/* ---------- catalog ---------- */

export const LAB_CATEGORIES: readonly LabCategory[] = ["Attacks", "Destroy", "Summons", "Card moves", "Chain", "LP", "Banners", "Board states", "Match"];

export const LAB_SCENARIOS: readonly LabScenario[] = [...BATTLE_EFFECT_SCENARIOS, ...ATTACKS, ...DESTROY, ...SUMMONS, ...MOVES, ...CHAIN, ...LP, ...BANNERS, ...STATES, ...PRIORITY_SCENARIOS, ...SERIES_SCENARIOS];

export function scenariosIn(category: LabCategory): LabScenario[] {
  return LAB_SCENARIOS.filter((scenario) => scenario.category === category);
}

export function findScenario(id: string): LabScenario | undefined {
  return LAB_SCENARIOS.find((scenario) => scenario.id === id);
}
