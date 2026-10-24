import type { DuelCard, DuelCardHint, DuelEngineView, DuelProtectionCategory } from "@yugidraft/shared/duels";
import { isFacedown, POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE, TYPE_FIELD, TYPE_SPELL, TYPE_XYZ } from "../../constants";
import { cardAt, FIELD, MZ, SZ, TABLE_CARDS, type TableFixtureSet } from "./common";

/** A hint in the engine's wire shape; ids only need to differ inside one card. */
function hint(id: number, text: string, ...categories: DuelProtectionCategory[]): DuelCardHint {
  return { descriptionId: String(1_000_000 + id), text, categories };
}

/** The Dracombatant case: three immunities, one hint with two categories, and a plain status line. */
const DRACOMBATANT: DuelCardHint[] = [
  hint(1, "Unaffected by Spell effects", "unaffected-spells"),
  hint(2, "Unaffected by your opponent's Trap effects", "unaffected-traps"),
  hint(3, "Cannot be destroyed by battle or card effects", "cannot-be-destroyed-by-battle", "cannot-be-destroyed-by-effects"),
  hint(4, "Cannot be targeted by your opponent's card effects", "cannot-be-targeted"),
  hint(5, "Your opponent cannot attack other monsters", "cannot-be-attacked"),
  hint(6, "Cannot attack this turn", "status"),
];

/** Six long hints on one card (Jinzo): the drawer must show the whole list and the whole effect text without a scroll at 1366 x 768. */
const LONG_HINTS: DuelCardHint[] = [
  hint(21, "Unaffected by the effects of Spell Cards, except those that are activated by the controller of this card", "unaffected-spells"),
  hint(22, "Cannot be destroyed by battle or by card effects while you control another face-up monster", "cannot-be-destroyed-by-battle", "cannot-be-destroyed-by-effects"),
  hint(23, "Cannot be targeted by card effects your opponent controls, including Quick-Play Spells and Trap Cards", "cannot-be-targeted"),
  hint(24, "Your opponent cannot attack any other monster you control while this card is on the field", "cannot-be-attacked"),
  hint(25, "Unaffected by your opponent's Trap effects that were activated during the Battle Phase of this turn", "unaffected-traps"),
  hint(26, "This card cannot attack during the turn it was Special Summoned, and cannot change its battle position", "status"),
];

/** One decoration per occupied Monster Zone, in order: every seat shows the same mix. */
const DECORATIONS: ReadonlyArray<(card: DuelCard) => DuelCard> = [
  // Many protections: the rail must fold ("+N") on a small card.
  (card) => ({ ...card, hints: DRACOMBATANT }),
  // A primary counter, a generic family counter, a card-specific one and an unknown id (a legacy board): the stack folds past 3 types.
  (card) => ({ ...card, counters: [{ type: 0x1, count: 3 }, { type: 0x1b, count: 2 }, { type: 0x7, count: 1 }, { type: 0x7fff, count: 12 }] }),
  // Negated, with a protection and a counter so the rail and the stack share the card.
  (card) => ({ ...card, negated: true, hints: [hint(7, "Unaffected by Monster effects", "unaffected-monsters")], counters: [{ type: 0x100e, count: 120 }] }),
  // Current stats differ from the printed ones. Jinzo (the long-text card) gets six long hints, one protection otherwise.
  (card) => ({
    ...card,
    baseAttack: (card.attack ?? 0) + 700,
    baseDefense: Math.max(0, (card.defense ?? 0) - 300),
    hints: card.code === TABLE_CARDS.jinzo.code ? LONG_HINTS : [hint(8, "Cannot be destroyed by battle", "cannot-be-destroyed-by-battle")],
    counters: [{ type: 0x1009, count: 1 }],
  }),
  // An Xyz with materials, two protections and three counter types: it is also the monster an Equip Spell is attached to (see below).
  (card) => ({
    ...card,
    type: (card.type ?? 0) | TYPE_XYZ,
    materials: [cardAt(TABLE_CARDS.stardust, MZ(card.controller, card.sequence), POS_FACEUP_ATTACK), cardAt(TABLE_CARDS.blueSpirit, MZ(card.controller, card.sequence), POS_FACEUP_ATTACK)],
    hints: [hint(9, "Unaffected by other cards' effects", "unaffected-effects"), hint(10, "Cannot be targeted by card effects", "cannot-be-targeted")],
    counters: [{ type: 0x1, count: 2 }, { type: 0x1b, count: 4 }, { type: 0x7, count: 1 }],
  }),
];

/** Umi: the Field Spell that carries counters in the fixtures. */
const FIELD_SPELL = { code: 22702055, name: "Umi", description: "All Fish, Sea Serpent, Thunder, and Aqua monsters on the field gain 200 ATK/DEF.", type: TYPE_SPELL | TYPE_FIELD, attack: 0, defense: 0, level: 0, attribute: 0, race: "" } as const;

/** The monsters a thin field is filled with (the 1v1 fixtures hold one or two per side): Attack and Defense, so both card shapes carry badges. */
const FILL = [TABLE_CARDS.blueEyes, TABLE_CARDS.jinzo, TABLE_CARDS.envoy, TABLE_CARDS.jinzo, TABLE_CARDS.blueEyes] as const;

/** The same engine view with the face-up monsters of every seat decorated (see DECORATIONS). A seat with fewer than 4 monsters gets 5 zones filled first. */
export function withCardStatusEngine(engine: DuelEngineView): DuelEngineView {
  const seats = engine.seats.map((view) => {
    let next = 0;
    const filled = view.monsters.slice(0, 5).filter(Boolean).length < 4 && !view.eliminated;
    const row = filled
      ? view.monsters.map((card, sequence) => (sequence < 5 && !card ? cardAt(FILL[sequence], MZ(view.seat, sequence), sequence % 2 === 1 ? POS_FACEUP_DEFENSE : POS_FACEUP_ATTACK) : card))
      : view.monsters;
    let equipHost: number | null = null;
    const monsters = row.map((card, sequence) => {
      if (!card || card.code == null || isFacedown(card.position)) return card;
      const index = next % DECORATIONS.length;
      next += 1;
      if (index === DECORATIONS.length - 1 && equipHost == null) equipHost = sequence;
      return DECORATIONS[index](card);
    });
    if (view.eliminated) return { ...view, monsters };
    // Spells and Traps: an Equip Spell on the Xyz, a Continuous Spell with counters and a protection, and a Field Spell with counters.
    const spells = [...view.spells];
    if (equipHost != null && !spells[0]) {
      const axe = cardAt(TABLE_CARDS.axe, SZ(view.seat, 0), POS_FACEUP_ATTACK);
      axe.equippedTo = MZ(view.seat, equipHost);
      spells[0] = axe;
    }
    if (!spells[1]) spells[1] = { ...cardAt(TABLE_CARDS.swords, SZ(view.seat, 1), POS_FACEUP_ATTACK), counters: [{ type: 0x1, count: 3 }], hints: [hint(11, "Cannot be destroyed by card effects", "cannot-be-destroyed-by-effects")] };
    if (!spells[5]) spells[5] = { ...cardAt(FIELD_SPELL, FIELD(view.seat), POS_FACEUP_ATTACK), counters: [{ type: 0x1, count: 12 }, { type: 0x1b, count: 2 }] };
    return { ...view, monsters, spells };
  });
  return { ...engine, seats };
}

/**
 * `?status=1` on a table preview: the face-up monsters of every seat carry protections, counters, a negated mark
 * and base stats, so the badges can be checked on each mode, seat angle and size.
 */
export function withCardStatus(set: TableFixtureSet): TableFixtureSet {
  type State = TableFixtureSet["states"][keyof TableFixtureSet["states"]];
  const decorate = (state: State): State => (state.room.engine ? { ...state, room: { ...state.room, engine: withCardStatusEngine(state.room.engine) } } : state);
  const states = Object.fromEntries(Object.entries(set.states).map(([id, state]) => [id, decorate(state)])) as unknown as TableFixtureSet["states"];
  const extra = set.extra ? Object.fromEntries(Object.entries(set.extra).map(([id, state]) => [id, decorate(state)])) : undefined;
  return { ...set, states, extra };
}
