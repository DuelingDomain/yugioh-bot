"use client";

/**
 * The hologram that stands over the chosen card. It is drawn from the card art on the table,
 * so it needs no data beyond the card itself. Hidden on a phone, where the card sheet carries a small one.
 */
import { memo, useLayoutEffect, useRef, useState } from "react";
import { CardImg } from "./card-img";
import { animate, motionOff } from "./motion";
import { statParts, tint, typeParts, type RoomCard } from "./room-model";

export interface HoloTarget {
  card: RoomCard;
  /** The card's element on the table. */
  el: HTMLElement;
  /** Hovering a card that is not the selected one: the hologram only half stands up. */
  partial: boolean;
}

export const MOTES = Array.from({ length: 16 }, (_, i) => {
  const r = (n: number) => ((Math.sin((i + 3) * 91.17 + n * 17.7) * 43758.5453) % 1 + 1) % 1;
  return { left: `${(4 + r(1) * 92).toFixed(1)}%`, d: `${(2.2 + r(2) * 2).toFixed(2)}s`, dl: `${(-r(3) * 3).toFixed(2)}s` };
});

export const Holo = memo(function Holo({ target, stage }: { target: HoloTarget | null; stage: HTMLElement | null }) {
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<RoomCard | null>(null);
  const live = useRef<{ id: number; partial: boolean } | null>(null);

  useLayoutEffect(() => {
    const holo = root.current;
    if (!holo) return;
    if (!target || !stage) {
      if (!holo.hasAttribute("data-on")) return;
      live.current = null;
      if (motionOff()) {
        holo.removeAttribute("data-on");
        return;
      }
      animate(holo, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in" }).then(() => {
        if (!live.current) holo.removeAttribute("data-on");
      });
      return;
    }
    const { card, el, partial } = target;
    const swap = holo.hasAttribute("data-on");
    if (swap && live.current?.id === card.id && live.current.partial === partial) {
      // same card: only follow it if the table moved
    }
    const changed = !(live.current && live.current.id === card.id);
    live.current = { id: card.id, partial };
    if (changed) setShown(card);
    const t = tint(card);
    holo.style.setProperty("--h-hi", t.hi);
    holo.style.setProperty("--h-main", t.main);
    const sr = stage.getBoundingClientRect();
    const face = el.querySelector(".face") ?? el;
    const r = face.getBoundingClientRect();
    const hw = Math.round(Math.min(230, Math.max(170, sr.height * 0.25)));
    const upright = r.bottom - r.width * 1.12 * (86 / 59) - sr.top;
    const standTop = partial ? (r.top - sr.top + upright) / 2 : upright;
    const top = Math.max(10, standTop - 26 - hw - 30);
    const beam = Math.max(16, standTop - (top + hw) + 6);
    let left = r.left + r.width / 2 - sr.left - hw / 2;
    left = Math.max(10, Math.min(sr.width - hw - 10, left));
    holo.style.setProperty("--hw", `${hw}px`);
    holo.style.setProperty("--beam", `${beam}px`);
    holo.style.transform = `translate(${left}px, ${top}px)`;
    holo.style.opacity = "";
    holo.setAttribute("data-on", "");
    if (!changed || motionOff()) return;
    const pf = holo.querySelector(".pf");
    if (swap) {
      animate(pf, [{ opacity: 0.35, filter: "brightness(1.8)" }, { opacity: 1, filter: "none" }], { duration: 200, easing: "ease-out" });
      return;
    }
    animate(holo.querySelector(".beam"), [{ transform: "scaleY(0)", opacity: 0 }, { transform: "scaleY(1)", opacity: 1 }], {
      duration: 220,
      easing: "cubic-bezier(0.2,0.8,0.25,1)",
    });
    animate(
      pf,
      [
        { transform: "translateY(40px) scale(0.55)", opacity: 0 },
        { transform: "translateY(-4px) scale(1.02)", opacity: 1, offset: 0.7 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 420, delay: 80, easing: "cubic-bezier(0.16,1,0.3,1)", fill: "backwards" },
    );
    animate(holo.querySelector(".wipe"), [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], {
      duration: 460,
      delay: 120,
      easing: "cubic-bezier(0.45,0,0.2,1)",
      fill: "backwards",
    });
    animate(holo.querySelector(".plate"), [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
      duration: 260,
      delay: 340,
      fill: "backwards",
    });
  }, [target?.card.id, target?.partial, target?.el, stage, target]);

  const sp = shown ? statParts(shown) : null;
  return (
    <div className="holo" ref={root} aria-hidden="true">
      <div className="portrait">
        <div className="pf">
          {shown ? <CardImg card={shown} large crop /> : <img alt="" />}
          <i className="tint" />
          <i className="scan" />
          <i className="sweep" />
          <i className="rim" />
          <i className="wipe" />
        </div>
      </div>
      <div className="plate">
        <b>{shown?.name}</b>
        <span>{shown ? (sp ? sp.map((x) => x[1]).join(" / ") : typeParts(shown)[0]) : ""}</span>
      </div>
      <div className="beam" />
      <div className="motes">
        {MOTES.map((m, i) => (
          <i key={i} style={{ left: m.left, "--d": m.d, "--dl": m.dl } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
});
