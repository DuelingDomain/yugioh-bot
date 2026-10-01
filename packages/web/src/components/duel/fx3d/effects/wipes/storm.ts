import { W, bump, easeIn3, easeOut3, ramp, type Color3, type ShakeImpulse, type WipeBuild } from "./common";

/**
 * Harpie's Feather Duster and Heavy Storm (pieces feather-duster and heavy-storm).
 * A gust sweeps from the left to the right across the board. Spell/Trap cards in its way shake, then
 * tear into the wind and are blown away. Heavy Storm (heavy = true) is the strong storm: it hits both
 * Spell/Trap rows, with a lens bulge, clouds and a harder shake.
 *
 * Port of sceneStorm(c, heavy) in .fx-demo/js/scenes.js. The page owns the source card, the page cards
 * that are not victims and the pile, so the cast lift, the sway of other cards and the card landing in
 * the pile are not drawn here (the lift becomes an aura and a ring on the source card).
 */

/** The time (s) the front of the gust starts and ends. The plan uses the same numbers. */
const F0 = 0.5;
const F1 = 1.62;
/** The demo Spell/Trap row heights (world y, up): opponent row and own row. */
const ROW_OPP_FALLBACK = 316;
const ROW_YOU_FALLBACK = -316;
const SLAM_AT = 0.5;

export const buildStorm: WipeBuild = (ctx) => {
  const heavy = ctx.piece === "heavy-storm";
  const r = ctx.rand;
  const P = ctx.post;
  const targets = ctx.victims;
  const D = ctx.duration;
  const { bounds } = ctx;
  const worldW = Math.max(1, bounds.maxX - bounds.minX);

  // The Spell/Trap row heights the gust and the streaks run along.
  const rowY = (side: "you" | "opp"): number => {
    const row = ctx.rows[side].st;
    if (row) return (row.minY + row.maxY) / 2;
    const ys = targets.filter((v) => v.side === side).map((v) => v.y);
    if (ys.length > 0) return ys.reduce((a, b) => a + b, 0) / ys.length;
    return side === "opp" ? ROW_OPP_FALLBACK : ROW_YOU_FALLBACK;
  };
  const targetSide: "you" | "opp" = targets[0]?.side ?? (ctx.ownerSide === "you" ? "opp" : "you");
  const rows = heavy ? [rowY("opp"), rowY("you")] : [rowY(targetSide)];

  // The gust front, in the world units of the demo (so it stays in step with the plan break times).
  const frontUv = (t: number): number => -0.12 + 1.3 * ramp(t, F0, F1);
  const frontX = (t: number): number => frontUv(t) * W - W / 2;
  /** The moment the front reaches a victim: the plan gives take = hit - 0.3. */
  const hitOf = (i: number): number => targets[i].take + 0.3;

  const COL: Color3 = heavy ? [0.5, 0.95, 0.88] : [1, 0.62, 0.85];
  const TINT: Color3 = heavy ? [0.58, 0.8, 0.86] : [1, 0.82, 0.96];
  const fCols: Color3[] = heavy
    ? [[0.82, 1, 0.95], [0.55, 0.9, 0.85], [1, 1, 1]]
    : [[1, 0.62, 0.82], [1, 0.9, 0.96], [0.75, 0.6, 1]];
  // Spawn left of the screen (a wide canvas shows more than the demo board).
  const startX = Math.min(-640, bounds.minX - 80);
  const startXF = Math.min(-660, bounds.minX - 100);

  const streaks = ctx.particles(
    ctx.count(heavy ? 600 : 320),
    () => {
      const row = r() < 0.2 ? (r() * 2 - 1) * 330 : rows[Math.floor(r() * rows.length)] + (r() - 0.5) * 200;
      return {
        p: [startX - r() * 60, row],
        v: [1700 + r() * 1400, (r() - 0.5) * 140 + 70],
        delay: F0 - 0.3 + r() * 1.3,
        life: 0.5 + r() * 0.3,
        size: 90 + r() * 140,
        stretch: 0.12,
        shape: 1,
        col: [...(heavy ? ([0.75, 1, 0.95] as const) : ([1, 0.86, 0.95] as const)), 0.3 + r() * 0.3] as [number, number, number, number],
      };
    },
    { drag: 0.3, P: [0, 0, 0.5, 0.1] },
  );

  const nF = ctx.count(heavy ? 240 : 170);
  const perCard = ctx.count(16);
  const feathers = ctx.particles(
    nF + targets.length * perCard,
    (i) => {
      const burst = i >= nF;
      const tgi = burst ? Math.floor((i - nF) / perCard) : -1;
      const tg = burst ? targets[tgi] : null;
      const fc = fCols[Math.floor(r() * fCols.length)];
      return {
        p: tg ? [tg.x + (r() - 0.5) * 80, tg.y + (r() - 0.5) * 100] : [startXF, rows[Math.floor(r() * rows.length)] + (r() - 0.5) * 240],
        v: tg ? [500 + r() * 800, (r() - 0.15) * 420] : [900 + r() * 900, (r() - 0.5) * 260 + 80],
        delay: tg ? hitOf(tgi) + 0.03 + r() * 0.12 : F0 - 0.1 + r() * 1.2,
        life: 0.9 + r() * 0.7,
        size: 28 + r() * 32,
        rot: r() * 6.28,
        spin: (r() - 0.5) * 12,
        seed: r(),
        shape: 3,
        col: [fc[0], fc[1], fc[2], 0.95],
      };
    },
    { mode: 2, normal: true, G: [0, -140], P: [24, 7, 0.4, 0.08], order: 125 },
  );

  // The shared landing pulse ring would still be lit on the last frame, so the pile rings are drawn here
  // (same look) and fade out before the piece ends.
  const landing = ctx.landing({ pulse: false });
  const pulses = targets.map((v) => (v.pile ? ctx.sprite(ctx.tex.ring, COL) : null));
  const soft = ctx.sprite(ctx.tex.soft, COL);
  // The cast glow on the source card (the page keeps the card itself where it is).
  const aura = ctx.source ? ctx.sprite(ctx.tex.soft, COL) : null;
  const slamRing = ctx.source ? ctx.sprite(ctx.tex.ring, COL) : null;

  const shakes: ShakeImpulse[] = [
    { t: F0, dur: 1.2, amp: heavy ? 6 : 3.5, kind: "swell", freq: 26 },
    { t: F0 - 0.02, dur: 0.25, amp: 3, kind: "decay" },
  ];

  // The gust band is a fixed width of the demo board (0.075 of its width), in uv of this canvas.
  const gustWidthUv = (0.075 * W) / worldW;
  const glowH = heavy ? Math.max(760, bounds.maxY - bounds.minY) : 300;

  return {
    shakes,
    update(t) {
      // Cast: aura and a ring on the source card (the demo lifts and slams it).
      if (ctx.source && aura && slamRing) {
        const lift = easeOut3(ramp(t, 0, 0.22));
        const slam = easeIn3(ramp(t, SLAM_AT, SLAM_AT + 0.09));
        const up = lift * (1 - slam);
        aura.set(ctx.source.x, ctx.source.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(t, SLAM_AT, SLAM_AT + 0.1) * (1 - ramp(t, SLAM_AT + 0.1, SLAM_AT + 0.7)));
        const rr = ramp(t, SLAM_AT + 0.04, SLAM_AT + 0.5);
        slamRing.set(ctx.source.x, ctx.source.y, 90 + 380 * easeOut3(rr), rr > 0 ? (1 - rr) * 0.9 : 0);
      }

      // The sky and the gust.
      const sky = ramp(t, 0.1, 0.6) * (1 - ramp(t, 1.9, D));
      const b = bump(t, F0, 2.0);
      P.uTint.value.setRGB(TINT[0], TINT[1], TINT[2]);
      P.uTintAmt.value = (heavy ? 0.55 : 0.4) * sky;
      P.uDarken.value = (heavy ? 0.3 : 0.12) * sky;
      P.uVig.value = 0.25 + 0.25 * sky;
      P.uClouds.value = heavy ? 0.4 * sky : 0;
      if (t > F0 - 0.12 && t < F1 + 0.3) P.uGust.value.set(ctx.uv(frontX(t), 0)[0], gustWidthUv, heavy ? 0.075 : 0.06);
      if (heavy) {
        P.uLens.value.set(0.6, 0.1 * b, 0.45 * b, 0);
        P.uAberr.value = 0.25 * b;
      }
      soft.set(frontX(t), heavy ? 0 : rows[0], 360, 0.18 * bump(t, F0 - 0.1, F1 + 0.3), glowH);

      streaks.setT(t);
      feathers.setT(t);

      // The victims: they shake as the front comes, then tear into the wind.
      targets.forEach((v, k) => {
        const th = hitOf(k);
        const bt = t - th;
        const ck = v.card;
        const pre = ramp(t, th - 0.3, th);
        ck.pose(v.x + Math.sin(t * 80 + k) * 1.8 * pre * (bt < 0 ? 1 : 0), v.y, 1 + 0.03 * pre);
        ck.u.uRim.value.setRGB(COL[0], COL[1], COL[2]);
        ck.u.uRimAmt.value = pre * 0.5;
        if (bt >= 0) {
          ck.u.uBreak.value = bt;
          ck.u.uStyle.value = 1;
          ck.u.uWind.value.set(1, 0.3);
          ck.u.uGrav.value = 120;
          ck.u.uSpin.value = 13;
          ck.u.uDelaySpan.value = 0.09;
          ck.u.uDelayDir.value.set(1, 0);
          ck.u.uLife.value = 1.0;
        }
      });

      landing.update(t, { col: COL, alpha: 0.5 });
      const pulseFade = 1 - ramp(t, D - 0.15, D);
      targets.forEach((v, k) => {
        const pulse = pulses[k];
        if (!pulse || !v.pile) return;
        const pk = 1 - (t - v.end) / 0.5;
        pulse.set(v.pile.x, v.pile.y, pk > 0 && pk < 1 ? 70 + 240 * (1 - pk) : 0, pk > 0 ? pk * 0.7 * pulseFade : 0);
      });
    },
  };
};
