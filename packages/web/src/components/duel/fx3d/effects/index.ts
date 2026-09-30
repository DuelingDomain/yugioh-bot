import type { Fx3dEffectId } from "../types";
import { compose, Rig, type FxFactory } from "./base";
import { burst, flash, pillar, shockwave } from "./parts";
import { battleEffect } from "./battle";
import { sceneEffect } from "./scene";
import { summonFactory } from "./summon";

/** A ground ripple with a ring and a flash; the building block of every impact. */
const shockwaveEffect: FxFactory = (env, request) => {
  const rig = new Rig(env, request);
  const u = rig.h;
  const size = Math.min(Math.max(env.view.w, env.view.h) * 1.4, u * (4 + 3.5 * rig.strength));
  return compose(
    rig,
    [flash(rig, { at: 0, dur: 0.3, size: u * 2.4, color: rig.tint.accent, peak: 0.8 }), shockwave(rig, { at: 0, dur: 0.6, size, color: rig.tint.main })],
    700,
  );
};

/** A radial burst of sparks. */
const burstEffect: FxFactory = (env, request) => {
  const rig = new Rig(env, request);
  const { main, alt, accent } = rig.tint;
  return compose(
    rig,
    [
      flash(rig, { at: 0, dur: 0.3, size: rig.h * 2, color: accent, peak: 0.8 }),
      burst(rig, { at: 0, count: 48, speed: [160, 520], life: [0.35, 0.8], size: [8, 22], colors: [main, alt, accent], radius: rig.h * 0.2 }),
    ],
    900,
  );
};

/** A column of light through the zone. */
const pillarEffect: FxFactory = (env, request) => {
  const rig = new Rig(env, request);
  const { main, alt } = rig.tint;
  return compose(
    rig,
    [pillar(rig, { start: 0, grow: 0.25, end: 0.5, fade: 0.9, width: rig.h * 1.1, height: Math.min(env.view.h * 1.4, rig.h * 6), color: main, color2: alt })],
    1000,
  );
};

export const EFFECTS: Record<Fx3dEffectId, FxFactory> = {
  "summon:fusion": summonFactory("fusion"),
  "summon:synchro": summonFactory("synchro"),
  "summon:xyz": summonFactory("xyz"),
  "summon:link": summonFactory("link"),
  "summon:ritual": summonFactory("ritual"),
  "summon:pendulum": summonFactory("pendulum"),
  "summon:heavy": summonFactory("heavy"),
  shockwave: shockwaveEffect,
  burst: burstEffect,
  pillar: pillarEffect,
  battle: battleEffect,
  scene: sceneEffect,
};
