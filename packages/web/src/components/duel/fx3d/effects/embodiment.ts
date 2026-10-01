import type * as THREE from "three";
import { artCropUv, artWindowOnCard, ART_CENTER_DROP, portraitTarget } from "../coords";
import { lerp, mulberry32, pulse, ramp } from "../ease";
import { embodimentAt, type Summon3dTimeline } from "../timeline";
import { particles } from "./parts";
import { setColor, type FxPart, type Rig } from "./base";

/**
 * The embodiment: the art of the summoned card rises out of the zone, opens into a large hologram
 * over the field, hangs there for a beat, and shrinks back into the card as it lands. The picture
 * is the art window of the card image (see ART_BOX), drawn on a quad with a rim of light, a dark
 * back panel that drifts against it (parallax) and motes that circle it.
 */
export function embodiment(rig: Rig, tl: Summon3dTimeline): FxPart {
  const view = rig.env.view;
  const card = rig.request.rect;
  const start = artWindowOnCard(card);
  const goal = portraitTarget(card, view);
  // The card's turn from upright: a sideways card turns a quarter, the far player's card (picture upside
  // down on screen) half a circle; both together make three quarters (written as a quarter the other way).
  const far = rig.request.side === "opp";
  const cw = far ? (rig.request.defense ? -Math.PI / 2 : Math.PI) : rig.request.defense ? Math.PI / 2 : 0;
  const code = rig.request.artCode ?? 0;
  const [u0, v0, u1, v1] = artCropUv();
  const { main, accent } = rig.tint;
  const rim: [number, number, number] = [
    Math.min(1, main[0] * 0.7 + accent[0] * 0.3),
    Math.min(1, main[1] * 0.7 + accent[1] * 0.3),
    Math.min(1, main[2] * 0.7 + accent[2] * 0.3),
  ];

  // Back panel first, then the glow behind it, then the picture, so each draws over the last.
  const back = rig.mesh("portrait", { w: goal.size, h: goal.size });
  const glow = rig.mesh("glow", { w: goal.size * 1.9 });
  const front = rig.mesh("portrait", { w: goal.size, h: goal.size });
  for (const mesh of [back, front]) {
    setColor(mesh.material.uniforms.uRim, rim);
    mesh.visible = false;
  }
  glow.visible = false;
  setColor(glow.material.uniforms.uColor, main);
  glow.material.uniforms.uPow.value = 1.7;
  front.material.uniforms.uCrop.value.set(u0, v0, u1, v1);
  back.material.uniforms.uHasTex.value = 0;
  // The portrait starts with whatever art has arrived (even none) and takes the sharper image when it lands.
  let bound: THREE.Texture | null = null;

  const rand = mulberry32((rig.request.seed ?? 1) * 104729);
  const orbit = particles(rig, 34, { shape: "star", swirl: [1.5, 0, 0, 0.6], shrink: 0, alpha: () => 1 }, (add, n) => {
    for (let i = 0; i < n; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = goal.size * (0.58 + rand() * 0.16);
      add({ x: Math.cos(a) * r, y: Math.sin(a) * r, birth: 0, life: tl.total / 1000, size: 5 + rand() * 7, seed: rand(), color: i % 3 === 0 ? rig.tint.accent : main, weight: 0.8 });
    }
  });
  const motes = orbit.points;

  const place = (mesh: THREE.Object3D, x: number, y: number, size: number, rot: number) => {
    mesh.position.set(x, y, 0);
    mesh.scale.set(size, size, 1);
    mesh.rotation.z = rot;
  };

  return {
    update(sec) {
      const { stage, grow } = embodimentAt(tl, sec * 1000);
      orbit.update(sec);
      const on = stage === "rise" || stage === "hold" || stage === "shrink";
      front.visible = on;
      back.visible = on;
      glow.visible = on;
      motes.visible = on;
      if (!on) return;
      const texture = code > 0 ? rig.env.art.peek(code) : null;
      if (texture && texture !== bound) {
        front.material.uniforms.uTex.value = texture;
        front.material.uniforms.uHasTex.value = 1;
        bound = texture;
      }
      // From the card's art window to the open portrait; a sideways card turns upright on the way up.
      const turn = cw * (1 - grow);
      const drop = ART_CENTER_DROP * card.h;
      const cardX = card.x + card.w / 2 - drop * Math.sin(turn);
      const cardY = card.y + card.h / 2 + drop * Math.cos(turn);
      const hold = stage === "hold" ? 1 : ramp(grow, 0.8, 1);
      const floatY = Math.sin(sec * 3.1) * goal.size * 0.012 * hold;
      const x = lerp(cardX, goal.cx, grow);
      const y = view.h - lerp(cardY, goal.cy, grow) + floatY;
      const size = lerp(start.size, goal.size, grow);
      const tiltY = Math.sin(sec * 1.9) * 0.1 * hold;
      const tiltX = Math.cos(sec * 1.4) * 0.05 * hold;

      place(front, x, y, size, -turn);
      front.rotation.y = tiltY;
      front.rotation.x = tiltX;
      // The back panel is a little bigger and slides against the tilt: depth.
      place(back, x - tiltY * size * 0.22, y + tiltX * size * 0.22, size * 1.09, -turn);
      back.rotation.y = tiltY * 0.6;
      back.rotation.x = tiltX * 0.6;
      place(glow, x, y, size * 1.9, 0);

      const alpha = ramp(grow, 0, 0.12);
      const landing = stage === "shrink" ? ramp(sec * 1000, tl.handOver - 90, tl.handOver) : 0;
      front.material.uniforms.uAlpha.value = alpha;
      front.material.uniforms.uReveal.value = 0.02 + 1.04 * ramp(grow, 0, 0.9);
      front.material.uniforms.uTime.value = sec;
      front.material.uniforms.uFlash.value = pulse(landing, 0, 0.7, 1) * 0.35;
      back.material.uniforms.uAlpha.value = alpha * 0.55;
      back.material.uniforms.uReveal.value = 1.1;
      back.material.uniforms.uTime.value = sec;
      glow.material.uniforms.uAlpha.value = alpha * (0.42 + 0.2 * Math.sin(sec * 5) * hold) * (1 + landing * 0.6);
      motes.position.set(x, y, 0);
      motes.scale.setScalar(size / goal.size);
    },
  };
}
