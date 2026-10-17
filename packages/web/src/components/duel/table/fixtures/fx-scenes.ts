import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { BANISHED, edit, ev, GY, MZ, SZ, type Edit, type EventSpec, type LabStep } from "../../fx-lab/board";
import { TABLE_CARDS as C } from "./common";

/**
 * `fx-<card>-<caster>[-<target>]`: a full-field effect on a multi-seat table preview (`?scene=fx-raigeki-0-1`). The first
 * step lays the same board on every seat (three monsters, two Set cards), the second activates the card and destroys
 * (or banishes) the cards it hits, as the engine sends them: one batch with the chain link resolving. The caster is the
 * seat that activates, the target the one opponent a one-opponent card (Raigeki, Feather Duster, Evenly Matched) hits.
 */
export type FxSceneId = `fx-${"raigeki" | "darkhole" | "torrential" | "heavystorm" | "feather" | "mirror" | "banish" | "vortex"}-${0 | 1 | 2 | 3}${"" | `-${0 | 1 | 2 | 3}`}`;

export const FX_SCENE = /^fx-(raigeki|darkhole|torrential|heavystorm|feather|mirror|banish|vortex)-([0-3])(?:-([0-3]))?$/;

type Spec = {
  card: DuelCardInfo;
  kind: "spell" | "trap";
  /** Which cards are hit: the monsters or the Spells and Traps, of the target seat or of every seat. */
  hits: "monsters" | "spells";
  scope: "target" | "all";
  banish?: boolean;
};

const SPECS: Record<string, Spec> = {
  raigeki: { card: C.raigeki, kind: "spell", hits: "monsters", scope: "target" },
  darkhole: { card: C.darkHole, kind: "spell", hits: "monsters", scope: "all" },
  torrential: { card: C.torrential, kind: "trap", hits: "monsters", scope: "all" },
  heavystorm: { card: C.heavyStorm, kind: "spell", hits: "spells", scope: "all" },
  feather: { card: C.featherDuster, kind: "spell", hits: "spells", scope: "target" },
  mirror: { card: C.mirrorForce, kind: "trap", hits: "monsters", scope: "target" },
  banish: { card: C.evenlyMatched, kind: "trap", hits: "monsters", scope: "target", banish: true },
  vortex: { card: C.lightningVortex, kind: "spell", hits: "monsters", scope: "target" },
};

const MONSTERS = [C.blueEyes, C.summonedSkull, C.harpie, C.redEyes, C.gaia];
const MONSTER_SEQ = [1, 2, 3];
const SPELL_SEQ = [0, 3];
const SPELL_CARDS = [C.mirrorForce, C.trapHole];

export function fxSceneSteps(id: string, seatCount: number): LabStep[] {
  const match = FX_SCENE.exec(id);
  if (!match) return [];
  const spec = SPECS[match[1]];
  const caster = Number(match[2]);
  const target = match[3] != null ? Number(match[3]) : (caster + 1) % seatCount;
  const seats = Array.from({ length: seatCount }, (_, seat) => seat);
  const set: Edit[] = [];
  for (const seat of seats) {
    MONSTER_SEQ.forEach((sequence, i) => set.push(edit.monster(seat, sequence, MONSTERS[(seat + i) % MONSTERS.length])));
    SPELL_SEQ.forEach((sequence, i) => set.push(edit.setSpell(seat, sequence, SPELL_CARDS[i % SPELL_CARDS.length])));
  }
  const sourceZone = SZ(caster, 1);
  set.push(spec.kind === "trap" ? edit.setSpell(caster, 1, spec.card) : edit.spell(caster, 1, spec.card));

  const why = { cause: "effect" as const, sourceCode: spec.card.code, sourceKind: spec.kind, sourceSeat: caster };
  const hitSeats = spec.scope === "all" ? seats : [target];
  const events: EventSpec[] = [];
  const edits: Edit[] = [];
  const piles = new Map<number, number>();
  const offer = match[1] === "mirror" ? [{ seat: target, sequences: MONSTER_SEQ }] : hitSeats.map((seat) => ({ seat, sequences: spec.hits === "monsters" ? MONSTER_SEQ : SPELL_SEQ }));
  events.push(ev.activate(caster, spec.card, sourceZone, 1), ev.chain("chain-resolving", caster, spec.card, 1));
  const hit: Array<{ seat: number; info: DuelCardInfo; zone: ReturnType<typeof MZ> }> = [];
  for (const { seat, sequences } of offer) {
    sequences.forEach((sequence, i) => {
      const info = spec.hits === "monsters" ? MONSTERS[(seat + i) % MONSTERS.length] : SPELL_CARDS[i % SPELL_CARDS.length];
      hit.push({ seat, info, zone: spec.hits === "monsters" ? MZ(seat, sequence) : SZ(seat, sequence) });
    });
  }
  for (const victim of hit) {
    const index = piles.get(victim.seat) ?? 0;
    piles.set(victim.seat, index + 1);
    if (spec.banish) {
      events.push(ev.move(victim.seat, victim.info, victim.zone, BANISHED(victim.seat, index), "banish", why));
      edits.push(edit.banish(victim.seat, victim.info));
    } else {
      events.push(ev.toGrave(victim.seat, victim.info, victim.zone, index, why));
      edits.push(edit.grave(victim.seat, victim.info));
    }
    edits.push(spec.hits === "monsters" ? edit.monster(victim.seat, victim.zone.sequence, null) : edit.spell(victim.seat, victim.zone.sequence, null));
  }
  events.push(ev.chain("chain-resolved", caster, spec.card, 1));
  if (!spec.banish) for (const victim of hit) events.push(ev.destroy(victim.seat, victim.info, victim.zone, why));
  events.push(ev.move(caster, spec.card, sourceZone, GY(caster, piles.get(caster) ?? 0), "send"), ev.chainEnd());
  edits.push(edit.spell(caster, 1, null), edit.grave(caster, spec.card));
  const lead: EventSpec[] = match[1] === "mirror" ? [ev.attack(target, MZ(target, 2), MZ(caster, 2))] : [];
  return [
    { at: 0, edits: set },
    ...(lead.length > 0 ? [{ at: 500, events: lead }] : []),
    { at: 1200, events, edits, chain: [] },
  ];
}
