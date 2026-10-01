import { easeIn3, easeOut3, decay, H, ramp, type Color3, type WipeBuild } from "./common";

/**
 * Mass destroy (piece mass-destroy): one chain link destroys two or more cards and no named piece fits.
 * A shock ring leaves the source card, and every card breaks when the ring reaches it.
 * Port of the demo `sceneShock`. Victim times (take, gone, land, end) come from the plan:
 * the hit time of a card is `gone - 1.15` (the demo `tb`). The source card is not moved (the page owns it);
 * its lift and slam are shown as the aura and the slam ring.
 */
const SPEED = 1000;
const TR = 0.5;
const HOLD = 1.15;
const SPARKS = 60;

export const buildShock: WipeBuild = (ctx) => {
  const P = ctx.post;
  const r = ctx.rand;
  const D = ctx.duration;
  const S = ctx.source ?? { x: 0, y: 0 };
  const main = ctx.scene.tint.main;
  const COL: Color3 = [main[0], main[1], main[2]];
  const victims = ctx.victims;
  const info = victims.map((v) => {
    const d = Math.hypot(v.x - S.x, v.y - S.y);
    return { v, d, tb: v.gone - HOLD };
  });
  const tMax = Math.max(TR + 0.5, ...info.map((o) => o.tb));

  // source: aura and slam ring (the card itself stays on the page)
  const aura = ctx.sprite(ctx.tex.soft, COL);
  const slam = ctx.sprite(ctx.tex.ring, COL);

  const hits = info.map((o) => ({
    o,
    ring: ctx.sprite(ctx.tex.ring, [1, 0.8, 0.45]),
    glow: ctx.sprite(ctx.tex.soft, [1, 0.75, 0.35]),
  }));
  const per = ctx.count(SPARKS);
  const sparks = ctx.particles(
    info.length * per + 1,
    (i) => {
      const o = info[Math.floor(i / per)];
      if (!o) return { p: [0, 0], delay: 99, life: 1 };
      const a = r() * 6.28;
      const sp = 120 + r() * 520;
      return {
        p: [o.v.x, o.v.y],
        v: [Math.cos(a) * sp, Math.sin(a) * sp],
        delay: o.tb + 0.06 + r() * 0.04,
        life: 0.4 + r() * 0.6,
        size: 8 + r() * 14,
        stretch: 0.7,
        shape: 1,
        col: r() < 0.5 ? [1, 0.7, 0.25, 1] : [1, 0.95, 0.7, 1],
      };
    },
    { drag: 1.4, G: [0, -700] },
  );
  const dust = ctx.particles(
    ctx.count(60) + info.length * 10,
    (i) => {
      const o = info[i % Math.max(1, info.length)];
      const e = o ? { x: o.v.x, y: o.v.y } : { x: 0, y: 0 };
      const tb = o ? o.tb : 1;
      const a = r() * 6.28;
      return {
        p: [e.x, e.y],
        v: [Math.cos(a) * 80, Math.sin(a) * 60 + 20],
        delay: tb + 0.08,
        life: 0.9 + r() * 0.6,
        size: 40 + r() * 50,
        col: [0.18, 0.12, 0.08, 0.5],
      };
    },
    { normal: true, drag: 1.6, P: [0, 0, 1, 0.2], order: 100 },
  );
  const flash = ctx.sprite(ctx.tex.soft, [1, 0.8, 0.45]);
  const land = ctx.landing();

  const shakes = [{ t: TR, dur: 0.6, amp: 14, kind: "decay" as const, freq: 36 }].concat(
    info.map((o) => ({ t: o.tb, dur: 0.2, amp: 6, kind: "decay" as const, freq: 60 })),
  );

  const [su, sv] = ctx.uv(S.x, S.y);

  return {
    shakes,
    update(t) {
      // the source: aura and slam ring (castSource without moving the card)
      const tS = TR;
      const lift = easeOut3(ramp(t, 0, 0.22));
      const slamK = easeIn3(ramp(t, tS, tS + 0.09));
      const up = lift * (1 - slamK);
      aura.set(S.x, S.y, 330 * (0.5 + up), 0.75 * up + 0.35 * ramp(t, tS, tS + 0.1) * (1 - ramp(t, tS + 0.1, tS + 0.7)));
      const rk = ramp(t, tS + 0.04, tS + 0.5);
      slam.set(S.x, S.y, 90 + 380 * easeOut3(rk), rk > 0 ? (1 - rk) * 0.9 : 0);

      const warm = ramp(t, 0.3, 0.7) * (1 - ramp(t, tMax + 0.5, D));
      P.uTint.value.setRGB(1, 0.86, 0.66);
      P.uTintAmt.value = 0.3 * warm;
      P.uDarken.value = 0.12 * warm;
      P.uVig.value = 0.25 + 0.15 * warm;
      const tr = t - TR;
      let fl = 0.55 * decay(t, TR + 0.02, 0.1) * (t >= TR ? 1 : 0);
      if (tr >= 0) {
        const rad = (SPEED * tr) / H;
        const w = 0.045 + 0.05 * tr;
        const k = ramp(tr, 0, 1.4);
        P.uShock.value.set(su, sv, rad, w);
        P.uShock2.value.set(0.04 * (1 - k), 1.4 * (1 - k), 0);
        P.uShockCol.value.setRGB(1, 0.72, 0.3);
      }
      hits.forEach((h) => {
        const dt = t - h.o.tb;
        fl = Math.max(fl, dt >= 0 ? 0.18 * Math.exp(-dt / 0.06) : 0);
        h.ring.set(h.o.v.x, h.o.v.y, 30 + 280 * easeOut3(ramp(dt, 0, 0.35)), dt >= 0 && dt < 0.35 ? 0.9 * (1 - dt / 0.35) : 0);
        h.glow.set(h.o.v.x, h.o.v.y, 280, dt >= 0 ? 0.9 * Math.exp(-dt / 0.1) : 0);
      });
      P.uFlash.value.set(1, 0.86, 0.55, fl);
      P.uAberr.value = Math.min(1, fl * 1.6);
      flash.set(S.x, S.y, 900, 0.7 * decay(t, TR, 0.12) * (t >= TR ? 1 : 0));
      sparks.setT(t);
      dust.setT(t);

      info.forEach((o) => {
        const ck = o.v.card;
        const dt = t - o.tb;
        const near = Math.exp(-Math.pow((o.d - SPEED * tr) / 90, 2)) * (tr > 0 ? 1 : 0);
        if (dt > HOLD) {
          ck.mesh.visible = false;
          return;
        }
        ck.u.uFlashCol.value.setRGB(1, 0.92, 0.7);
        ck.u.uFlash.value = dt >= 0 && dt < 0.08 ? 1 - dt / 0.08 : 0;
        ck.u.uRim.value.setRGB(COL[0], COL[1], COL[2]);
        ck.u.uRimAmt.value = near * 0.8;
        ck.pose(o.v.x, o.v.y, 1 + 0.05 * near);
        if (dt >= 0.07) {
          ck.u.uBreak.value = dt - 0.07;
          ck.u.uKick.value.set(S.x, S.y);
          ck.u.uPow.value = 1.35;
          ck.u.uGrav.value = 700;
          ck.u.uLife.value = 1.0;
          ck.u.uSpin.value = 15;
          ck.u.uStyle.value = 0;
        }
      });
      land.update(t, { alpha: 0.5, col: COL });
    },
  };
};
