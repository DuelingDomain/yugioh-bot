import { COUNTER_GAP_MS, COUNTER_SCALE, DESTROY_BEAT_MS, hasCounterStrike, type AttackStyleId, type BattleKind, type BattleTiming, type Tint } from "../attack-styles";
import type { FxBattle, FxBreak, FxRect, FxStrike, FxTint, Rgb } from "./types";

/**
 * The fight as the 3D layer plays it. Pure: it turns the fight the DOM layer already resolved
 * (kind, styles, `battleTiming`) into strikes and breaks with exact times. Nothing here decides
 * WHEN things happen: every time comes from `battleTiming`, so the sound, the LP roll, the hold on
 * the destroyed card and the picture all meet at the same moments.
 */

/** How long a broken card's shards need to fall and fade after the break. */
export const SHARD_TAIL_MS = 900;
/** The effect never lives longer than this (the engine stops an effect at 4000 ms). */
export const BATTLE_LIFE_CAP_MS = 3800;

export function hexToRgb(hex: string): Rgb {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0");
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** hi -> accent (the hot part), main -> main, deep -> alt. */
export function fxTintOf(tint: Tint): FxTint {
  return { main: hexToRgb(tint.main), alt: hexToRgb(tint.deep), accent: hexToRgb(tint.hi) };
}

export type PlanSide = {
  /** In the canvas pixel space (y down). */
  rect: FxRect;
  code: number;
  style: AttackStyleId;
  tint: Tint;
  /** Passcode of a signature attack, else null. */
  signature: number | null;
  defense: boolean;
  /** The far player's card: its picture is turned half a circle. */
  turned?: boolean;
};

export type BattlePlanInput = {
  kind: BattleKind;
  timing: BattleTiming;
  attacker: PlanSide;
  /** null on a direct attack. */
  defender: PlanSide | null;
  /** Where the attacker's strike lands: the defender's card, or the LP tally on a direct attack. */
  hit: FxRect;
};

const centre = (r: FxRect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function unit(from: FxRect, to: FxRect): { x: number; y: number } {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 0.5 ? { x: 0, y: 1 } : { x: dx / len, y: dy / len };
}

function breakOf(target: PlanSide, source: PlanSide, atMs: number): FxBreak {
  return {
    rect: target.rect,
    code: target.code,
    defense: target.defense,
    turned: target.turned,
    atMs,
    dir: unit(source.rect, target.rect),
    style: source.style,
    tint: fxTintOf(source.tint),
  };
}

export function planBattle(input: BattlePlanInput): FxBattle {
  const { kind, timing, attacker, defender, hit } = input;
  const strikes: FxStrike[] = [
    {
      style: attacker.style,
      signature: attacker.signature,
      tint: fxTintOf(attacker.tint),
      from: attacker.rect,
      to: hit,
      startMs: 0,
      impactMs: timing.impactMs,
      scale: 1,
      direct: defender == null,
    },
  ];
  const breaks: FxBreak[] = [];
  // The defender strikes back (a lost fight, a tie, a blow that bounced off) after a short pause.
  if (defender && hasCounterStrike(kind)) {
    strikes.push({
      style: defender.style,
      signature: defender.signature,
      tint: fxTintOf(defender.tint),
      from: defender.rect,
      to: attacker.rect,
      startMs: timing.impactMs + COUNTER_GAP_MS,
      impactMs: timing.attackerDamageMs,
      scale: COUNTER_SCALE,
      direct: false,
    });
  }
  if (defender && (kind === "win" || kind === "tie") && timing.targetBreakMs != null) breaks.push(breakOf(defender, attacker, timing.targetBreakMs));
  if (defender && (kind === "lose" || kind === "tie") && timing.attackerBreakMs != null) breaks.push(breakOf(attacker, defender, timing.attackerBreakMs));
  const lastBreak = breaks.reduce((max, entry) => Math.max(max, entry.atMs), 0);
  const totalMs = Math.min(BATTLE_LIFE_CAP_MS, Math.max(timing.totalMs, lastBreak > 0 ? lastBreak + SHARD_TAIL_MS : 0));
  return { strikes, breaks, totalMs };
}

/** The break comes this long after the strike that killed the card lands (mirrors DESTROY_BEAT_MS). */
export const BREAK_AFTER_IMPACT_MS = DESTROY_BEAT_MS;
